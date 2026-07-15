import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
  OnModuleDestroy,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import type { Request } from 'express';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSecs: number;
  /** Bucket name so different routes don't share a counter. */
  bucket: string;
}

/**
 * Declare a per-client rate limit on a route. Enforced by RateLimitGuard.
 * Example: `@RateLimit({ bucket: 'login', limit: 10, windowSecs: 60 })`
 */
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, opts);

/**
 * Redis-backed fixed-window rate limiter — multi-pod safe (all instances share
 * the same counter), unlike an in-memory Map. Keyed by bucket + client IP.
 * Redis being down FAILS OPEN (allows the request) so an outage can't lock
 * users out of auth; the limiter is a brute-force speed bump, not the security
 * boundary (password hashing + JWT verification are).
 */
@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly redis: Redis;
  private available = true;

  constructor(private readonly reflector: Reflector) {
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

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!opts) return true;
    if (!this.available) return true; // fail open when Redis is unreachable

    const req = context.switchToHttp().getRequest<Request>();
    const ip = (req.ip ?? req.socket?.remoteAddress ?? 'unknown').replace(/[^\w.:]/g, '_');
    const key = `ratelimit:${opts.bucket}:${ip}`;

    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, opts.windowSecs);
      }
      if (count > opts.limit) {
        const ttl = await this.redis.ttl(key);
        throw new HttpException(
          {
            message: `Too many requests — try again in ${ttl > 0 ? ttl : opts.windowSecs}s.`,
            code: 'RATE_LIMITED',
            retryable: true,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis command error mid-flight — fail open, don't lock users out.
      this.logger.warn(`Rate limiter degraded (allowing request): ${err instanceof Error ? err.message : String(err)}`);
      return true;
    }
  }
}
