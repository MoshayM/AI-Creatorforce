import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { setAICacheAdapter, type AICacheAdapter } from '@cf/shared';

/**
 * API-side implementation of AICacheAdapter (Phase 5 Wave 2 §6 cache-first).
 *
 * Redis availability is not a hard dependency: every get/set call is wrapped in
 * a try/catch so a Redis failure never surfaces as an AI call failure.
 * Kill-switch: set AI_RESPONSE_CACHE_ENABLED=false to prevent registration.
 */
@Injectable()
export class AiCacheAdapter implements AICacheAdapter, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiCacheAdapter.name);
  private readonly redis: Redis;
  private available = true;
  /** Rate-limit warn logs to at most once every 60 s per failure type. */
  private lastWarnAt = 0;

  constructor() {
    this.redis = new Redis({
      host: process.env['REDIS_HOST'] ?? '127.0.0.1',
      port: Number(process.env['REDIS_PORT'] ?? 6379),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', () => { this.available = false; });
    this.redis.on('ready', () => { this.available = true; });
  }

  onModuleInit(): void {
    setAICacheAdapter(this);
  }

  async onModuleDestroy(): Promise<void> {
    setAICacheAdapter(null);
    await this.redis.quit().catch(() => undefined);
  }

  async get(key: string): Promise<string | null> {
    if (!this.available) return null;
    try {
      return await this.redis.get(key);
    } catch (err) {
      this.rateLimitedWarn(`cache get error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.available) return;
    try {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.rateLimitedWarn(`cache set error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private rateLimitedWarn(msg: string): void {
    const now = Date.now();
    if (now - this.lastWarnAt > 60_000) {
      this.logger.warn(msg);
      this.lastWarnAt = now;
    }
  }
}
