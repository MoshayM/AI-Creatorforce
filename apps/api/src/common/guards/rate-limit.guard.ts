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
import type { JwtPayload } from '../decorators/current-user.decorator';

export const RATE_LIMIT_KEY = 'rate_limit';
export const TIER_RATE_LIMIT_KEY = 'tier_rate_limit';

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSecs: number;
  /** Bucket name so different routes don't share a counter. */
  bucket: string;
}

export interface TierLimits {
  bucket: string;
  windowSecs: number;
  /** Requests per window for each plan. Missing plans fall back to `default`. */
  limits: {
    FREE?: number;
    STARTER?: number;
    PRO?: number;
    AGENCY?: number;
    default: number;
  };
}

/**
 * Declare a per-client rate limit on a route. Enforced by RateLimitGuard.
 * Example: `@RateLimit({ bucket: 'login', limit: 10, windowSecs: 60 })`
 */
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, opts);

/**
 * Declare a per-subscription-tier rate limit on a route. Enforced by RateLimitGuard.
 * Keyed by userId when authenticated, or IP when unauthenticated.
 * Example: `@TierRateLimit({ bucket: 'copilot-chat', windowSecs: 3600, limits: { FREE: 20, PRO: 200, default: 20 } })`
 */
export const TierRateLimit = (opts: TierLimits) => SetMetadata(TIER_RATE_LIMIT_KEY, opts);

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
    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();

    const opts = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (opts) {
      if (!this.available) return true;
      const ip = (req.ip ?? req.socket?.remoteAddress ?? 'unknown').replace(/[^\w.:]/g, '_');
      const key = `ratelimit:${opts.bucket}:${ip}`;
      await this.enforceWindow(key, opts.limit, opts.windowSecs);
    }

    const tierOpts = this.reflector.getAllAndOverride<TierLimits>(TIER_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (tierOpts) {
      if (!this.available) return true;
      const user = req.user;
      const plan = user?.plan ?? 'FREE';
      const limit =
        (tierOpts.limits as Record<string, number | undefined>)[plan] ??
        tierOpts.limits.default;
      const keyId = user?.sub
        ? `tierratelimit:${tierOpts.bucket}:${user.sub}`
        : `tierratelimit:${tierOpts.bucket}:${(req.ip ?? req.socket?.remoteAddress ?? 'unknown').replace(/[^\w.:]/g, '_')}`;
      await this.enforceWindow(keyId, limit, tierOpts.windowSecs);
    }

    return true;
  }

  private async enforceWindow(key: string, limit: number, windowSecs: number): Promise<void> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, windowSecs);
      }
      if (count > limit) {
        const ttl = await this.redis.ttl(key);
        throw new HttpException(
          {
            message: `Too many requests — try again in ${ttl > 0 ? ttl : windowSecs}s.`,
            code: 'RATE_LIMITED',
            retryable: true,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Rate limiter degraded (allowing request): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
