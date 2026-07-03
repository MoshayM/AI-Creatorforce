import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { callAIStructured, type AIProgressEvent } from '@cf/shared';
import { ComplianceResultSchema, mustPassCompliance, type ComplianceResult } from '@cf/shared';
import { createHash } from 'crypto';

const COMPLIANCE_SYSTEM = `You are a strict YouTube content compliance auditor.
Analyze content for policy violations across all categories below.
Be thorough and conservative. A score below 70 means NOT passed.
BLOCK severity flags mean the content CANNOT be published regardless of score.

IMPORTANT — use ONLY these exact enum values (no synonyms, no variations):

flag.category must be one of:
  COPYRIGHT | MISINFORMATION | HATE_SPEECH | VIOLENCE | ADULT_CONTENT | SPAM | IMPERSONATION | PRIVACY | ADVERTISER_FRIENDLY

flag.severity must be one of:
  INFO | WARNING | CRITICAL | BLOCK

Respond only with valid JSON matching the schema exactly.`;

// ── Compliance Result Cache ───────────────────────────────────────────────────
// Caches deterministic compliance results to avoid duplicate API calls.
// Key: SHA-256 of normalized content. TTL: configurable via COMPLIANCE_CACHE_TTL_MS (default 24h).

interface CacheEntry {
  result: ComplianceResult;
  expiresAt: number;
  hitCount: number;
}

const cache = new Map<string, CacheEntry>();

function cacheTtlMs(): number {
  const v = parseInt(process.env['COMPLIANCE_CACHE_TTL_MS'] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 86_400_000; // 24 h
}

function cacheKey(content: { title: string; script: string; description?: string; tags?: string[] }): string {
  const normalized = JSON.stringify({
    title: content.title.trim().toLowerCase(),
    script: content.script.trim().toLowerCase(),
    description: (content.description ?? '').trim().toLowerCase(),
    tags: (content.tags ?? []).map((t) => t.trim().toLowerCase()).sort(),
  });
  return createHash('sha256').update(normalized).digest('hex');
}

function getFromCache(key: string): ComplianceResult | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  entry.hitCount++;
  return entry.result;
}

function setInCache(key: string, result: ComplianceResult): void {
  cache.set(key, { result, expiresAt: Date.now() + cacheTtlMs(), hitCount: 0 });
  // Evict oldest entries if cache grows beyond 500 items
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export type ComplianceProgressCallback = (event: AIProgressEvent) => void;

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  async check(
    content: { title: string; script: string; description?: string; tags?: string[] },
    onProgress?: ComplianceProgressCallback,
  ): Promise<ComplianceResult> {
    const key = cacheKey(content);
    const cached = getFromCache(key);
    if (cached) {
      this.logger.log(`[compliance:cache-hit] key=${key.slice(0, 8)} score=${cached.score} passed=${cached.passed}`);
      return cached;
    }

    this.logger.log(`[compliance:cache-miss] key=${key.slice(0, 8)} — calling AI`);

    const result = await callAIStructured(
      [{
        role: 'user',
        content: [
          'Perform a full compliance audit of this YouTube video content:',
          '',
          `Title: ${content.title}`,
          '',
          `Script:\n${content.script}`,
          '',
          `Description: ${content.description ?? 'N/A'}`,
          '',
          `Tags: ${content.tags?.join(', ') ?? 'N/A'}`,
          '',
          'Respond with EXACTLY this JSON structure (no extra text, no markdown, no code fences):',
          '{"passed":true,"score":85,"flags":[{"category":"ADVERTISER_FRIENDLY","severity":"INFO","description":"Flag description","excerpt":"Optional relevant excerpt"}],"reviewerAI":"compliance-auditor-v1","summary":"Overall compliance summary"}',
        ].join('\n'),
      }],
      ComplianceResultSchema,
      { systemPrompt: COMPLIANCE_SYSTEM, maxTokens: 2048, onProgress },
    );

    setInCache(key, result);
    this.logger.log(`[compliance:done] score=${result.score} passed=${result.passed} flags=${result.flags.length} cached_for=${Math.round(cacheTtlMs() / 3600000)}h`);

    return result;
  }

  async enforce(
    content: Parameters<ComplianceService['check']>[0],
    onProgress?: ComplianceProgressCallback,
  ): Promise<ComplianceResult> {
    const result = await this.check(content, onProgress);
    try {
      mustPassCompliance(result);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return result;
  }

  /** Invalidate a specific cache entry (e.g., after script is edited). */
  invalidate(content: Parameters<ComplianceService['check']>[0]): boolean {
    const key = cacheKey(content);
    return cache.delete(key);
  }

  /** Returns cache statistics for monitoring. */
  cacheStats(): { size: number; keys: string[] } {
    return { size: cache.size, keys: [...cache.keys()].map((k) => k.slice(0, 8)) };
  }
}
