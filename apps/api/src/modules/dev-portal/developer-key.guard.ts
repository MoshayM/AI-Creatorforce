import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { Request } from 'express';
import { DevPortalService } from './dev-portal.service';
import { scopeAllows } from './dev-portal.utils';

// ── Metadata key ───────────────────────────────────────────────────────────────

export const REQUIRE_SCOPE_KEY = 'require_dev_scope';

/** Decorator that marks a route as requiring a specific developer API scope. */
export function RequireScope(scope: string): MethodDecorator & ClassDecorator {
  // SetMetadata produces exactly the decorator type Nest's Reflector reads.
  return SetMetadata(REQUIRE_SCOPE_KEY, scope);
}

export const PAID_ACTION_KEY = 'dev_paid_action';

/**
 * Marks a dev-API route as a paid AI action (Wave 18, risk R-12): the guard
 * rejects sandbox keys before the handler runs, so a new paid route can't
 * forget the check — it declares intent instead of re-implementing it.
 */
export function PaidAction(): MethodDecorator & ClassDecorator {
  return SetMetadata(PAID_ACTION_KEY, true);
}

// ── Redis-backed sliding-window rate limiter ───────────────────────────────────

const RATE_WINDOW_MS = 60_000;

/**
 * Atomic sliding window on a sorted set: evict entries older than the window,
 * count what remains, admit + record only if under the limit. Running as one
 * Lua script means concurrent requests across pods can't both slip past the
 * limit between the count and the insert.
 *
 * KEYS[1] = ratelimit key, ARGV = [nowMs, windowMs, limit, member]
 * Returns 1 if admitted, 0 if rate-limited.
 */
const SLIDING_WINDOW_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

// ── Guard ──────────────────────────────────────────────────────────────────────

/**
 * DeveloperKeyGuard authenticates requests using a developer API key.
 *
 * Reads the key from:
 *   - `Authorization: Bearer cfk_...` header
 *   - `X-Api-Key: cfk_...` header
 *
 * On success, attaches `{ sub, scopes, sandbox, developerKeyId }` to
 * `request.user` so downstream handlers can access identity and permissions.
 *
 * Sandbox keys (sandbox=true) are authenticated normally but paid AI actions
 * are refused at the guard level: routes declare themselves with
 * `@PaidAction()` and sandbox keys never reach their handlers (Wave 18, R-12).
 *
 * Rate limiting: Redis-backed sliding window per keyId (see note above) — safe
 * for multi-instance deployments. Redis being down FAILS OPEN: the limiter is
 * an abuse speed bump, not the security boundary (key verification is), and an
 * outage must not take down the developer API.
 */
@Injectable()
export class DeveloperKeyGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(DeveloperKeyGuard.name);
  private readonly redis: Redis;
  private redisAvailable = true;

  constructor(
    private readonly devPortal: DevPortalService,
    private readonly reflector: Reflector,
  ) {
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

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }

  /** Returns true if the request is admitted, false if rate-limited. */
  private async checkRateLimit(keyId: string, limitPerMin: number): Promise<boolean> {
    if (!this.redisAvailable) return true; // fail open when Redis is unreachable
    const now = Date.now();
    try {
      const admitted = await this.redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        `ratelimit:devkey:${keyId}`,
        now,
        RATE_WINDOW_MS,
        limitPerMin,
        `${now}:${Math.random().toString(36).slice(2, 10)}`,
      );
      return admitted === 1;
    } catch (err) {
      this.logger.warn(
        `Dev-key rate limiter degraded (allowing request): ${err instanceof Error ? err.message : String(err)}`,
      );
      return true;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const rawKey = this.extractKey(request);
    if (!rawKey) {
      throw new UnauthorizedException('Developer API key required');
    }

    const verified = await this.devPortal.verifyKey(rawKey);
    if (!verified) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }

    // Rate limiting
    if (!(await this.checkRateLimit(verified.keyId, verified.rateLimitPerMin))) {
      throw new ForbiddenException('Rate limit exceeded');
    }

    // Usage analytics (Wave 10): count served requests only — rejected auth
    // and rate-limited calls stay out of the rollup. Fire-and-forget.
    void this.devPortal.recordRequest(verified.keyId);

    // Scope check (if route requires a specific scope)
    const requiredScope = this.reflector.get<string | undefined>(
      REQUIRE_SCOPE_KEY,
      context.getHandler(),
    );
    if (requiredScope && !scopeAllows(verified.scopes, requiredScope)) {
      throw new ForbiddenException(`Scope '${requiredScope}' required`);
    }

    // Paid-action gate (Wave 18, R-12): sandbox keys never reach paid handlers.
    const paidAction = this.reflector.getAllAndOverride<boolean | undefined>(PAID_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (paidAction && verified.sandbox) {
      throw new ForbiddenException('Sandbox keys cannot run paid AI actions — create a live key');
    }

    // Attach to request.user
    (request as Request & { user: unknown }).user = {
      sub: verified.userId,
      scopes: verified.scopes,
      sandbox: verified.sandbox,
      developerKeyId: verified.keyId,
    };

    return true;
  }

  private extractKey(request: Request): string | undefined {
    const authHeader = request.headers['authorization'];
    if (authHeader?.startsWith('Bearer cfk_')) {
      return authHeader.slice('Bearer '.length);
    }
    const apiKeyHeader = request.headers['x-api-key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.startsWith('cfk_')) {
      return apiKeyHeader;
    }
    return undefined;
  }
}
