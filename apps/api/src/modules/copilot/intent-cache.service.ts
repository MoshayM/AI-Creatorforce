import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { CopilotDecision } from '@cf/shared';

/**
 * Token Governor §12/§18 (Ai-video edit.md): phrase→intent cache.
 *
 * Repeated commands ("what's pending for my review?", "list my projects")
 * resolve to the same intent without an LLM call. Safety rules:
 *  - Only decisions that CARRY a command are cached (pure conversation is
 *    context-dependent and stays live).
 *  - A decision is cacheable only if the command references no ids, or every
 *    id it references appears verbatim in the user's phrase — so a cached
 *    intent can never smuggle a stale id into a different conversation.
 *  - Confirmation turns (pendingCommand set) are never cached or served
 *    from cache; the gate always runs live.
 *  - Cache hits still pass through the EXPENSIVE_ACTIONS confirmation gate
 *    and re-execute against live data — only the LLM interpretation is reused.
 */
@Injectable()
export class IntentCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(IntentCacheService.name);
  private readonly redis: Redis;
  private available = true;
  private static readonly TTL_SECONDS = 7 * 24 * 60 * 60;
  private static readonly PREFIX = 'copilot:intent:v1:';

  constructor() {
    this.redis = new Redis({
      host: process.env['REDIS_HOST'] ?? '127.0.0.1',
      port: Number(process.env['REDIS_PORT'] ?? 6379),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    // Cache is an optimization — Redis being down must never break chat
    this.redis.on('error', () => { this.available = false; });
    this.redis.on('ready', () => { this.available = true; });
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  private key(phrase: string): string {
    const normalized = phrase.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    return IntentCacheService.PREFIX + createHash('sha256').update(normalized).digest('hex');
  }

  async get(phrase: string): Promise<CopilotDecision | null> {
    if (!this.available || !phrase.trim()) return null;
    try {
      const raw = await this.redis.get(this.key(phrase));
      if (!raw) return null;
      await this.redis.expire(this.key(phrase), IntentCacheService.TTL_SECONDS).catch(() => undefined);
      return JSON.parse(raw) as CopilotDecision;
    } catch {
      return null;
    }
  }

  /** Store the decision if (and only if) it is safe to replay for this phrase. */
  async maybeStore(phrase: string, decision: CopilotDecision): Promise<void> {
    if (!this.available || !this.isCacheable(phrase, decision)) return;
    try {
      await this.redis.set(this.key(phrase), JSON.stringify(decision), 'EX', IntentCacheService.TTL_SECONDS);
    } catch { /* cache write failures are invisible to the user */ }
  }

  isCacheable(phrase: string, decision: CopilotDecision): boolean {
    if (!decision.command) return false;
    // Every id-like param (cuids are 25 chars) must be spoken/typed verbatim
    // in the phrase, otherwise the mapping is conversation-specific.
    for (const [k, v] of Object.entries(decision.command)) {
      if (k === 'action') continue;
      if (typeof v === 'string' && v.length >= 20 && !phrase.includes(v)) return false;
    }
    return true;
  }
}
