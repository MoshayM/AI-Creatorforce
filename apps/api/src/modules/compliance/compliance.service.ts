import { Injectable, BadRequestException, Logger, OnModuleDestroy } from '@nestjs/common';
import { callAIStructured, type AIProgressEvent } from '@cf/shared';
import { ComplianceResultSchema, mustPassCompliance, type ComplianceResult } from '@cf/shared';
import Redis from 'ioredis';
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

// ── Service ───────────────────────────────────────────────────────────────────

export type ComplianceProgressCallback = (event: AIProgressEvent) => void;

@Injectable()
export class ComplianceService implements OnModuleDestroy {
  private readonly logger = new Logger(ComplianceService.name);
  // In-memory layer: instance-scoped (the service is a Nest singleton, so
  // caching still spans requests) — a module-level Map leaked results across
  // test instances and made enforce() read a stale pass instead of the
  // current AI verdict. Also the only layer in tests and when Redis is down.
  private readonly cache = new Map<string, CacheEntry>();
  // Redis layer: shared across instances so multi-pod deployments don't pay
  // for the same compliance audit twice. Purely a cost optimization — the
  // gate itself (mustPassCompliance) re-runs on every enforce(), cached or
  // not. Disabled under test for the same isolation reason as above.
  private readonly redis: Redis | null;
  private redisAvailable = true;

  constructor() {
    if (process.env['NODE_ENV'] === 'test') {
      this.redis = null;
    } else {
      this.redis = new Redis({
        host: process.env['REDIS_HOST'] ?? '127.0.0.1',
        port: Number(process.env['REDIS_PORT'] ?? 6379),
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      });
      this.redis.on('error', () => { this.redisAvailable = false; });
      this.redis.on('ready', () => { this.redisAvailable = true; });
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  private redisKey(key: string): string {
    return `compliance:result:${key}`;
  }

  private async getFromRedis(key: string): Promise<ComplianceResult | null> {
    if (!this.redis || !this.redisAvailable) return null;
    try {
      const raw = await this.redis.get(this.redisKey(key));
      if (!raw) return null;
      // Golden rule 7: never trust a stored blob — a corrupted or
      // schema-drifted entry is a cache miss, not a verdict.
      return ComplianceResultSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private async getFromCache(key: string): Promise<ComplianceResult | null> {
    const shared = await this.getFromRedis(key);
    if (shared) return shared;

    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    entry.hitCount++;
    return entry.result;
  }

  private async setInCache(key: string, result: ComplianceResult): Promise<void> {
    this.cache.set(key, { result, expiresAt: Date.now() + cacheTtlMs(), hitCount: 0 });
    // Evict oldest entries if cache grows beyond 500 items
    if (this.cache.size > 500) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    if (this.redis && this.redisAvailable) {
      try {
        await this.redis.set(this.redisKey(key), JSON.stringify(result), 'PX', cacheTtlMs());
      } catch {
        // Redis write failure only loses the shared layer — in-memory has it.
      }
    }
  }

  async check(
    content: { title: string; script: string; description?: string; tags?: string[] },
    onProgress?: ComplianceProgressCallback,
  ): Promise<ComplianceResult> {
    const key = cacheKey(content);
    const cached = await this.getFromCache(key);
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

    await this.setInCache(key, result);
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

  /** Invalidate a specific cache entry (e.g., after script is edited) in both layers. */
  async invalidate(content: Parameters<ComplianceService['check']>[0]): Promise<boolean> {
    const key = cacheKey(content);
    const hadLocal = this.cache.delete(key);
    let hadShared = false;
    if (this.redis && this.redisAvailable) {
      try {
        hadShared = (await this.redis.del(this.redisKey(key))) > 0;
      } catch { /* shared layer unreachable — local entry is gone either way */ }
    }
    return hadLocal || hadShared;
  }

  /** Returns in-memory cache statistics for monitoring (local layer only). */
  cacheStats(): { size: number; keys: string[] } {
    return { size: this.cache.size, keys: [...this.cache.keys()].map((k) => k.slice(0, 8)) };
  }
}
