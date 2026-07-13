import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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

// ── In-memory sliding-window rate limiter ──────────────────────────────────────

interface WindowEntry {
  timestamps: number[];
}

/**
 * Simple in-memory sliding-window rate limiter per keyId.
 *
 * NOTE: This is a per-process in-memory implementation suitable for
 * single-instance deployments and development. For production multi-instance
 * deployments, replace with a Redis-backed sliding window (e.g., lua script
 * on a sorted set). The rateLimitPerMin field on the key exposes the limit to
 * any future Redis implementation without schema changes.
 */
const rateLimitWindows = new Map<string, WindowEntry>();

function checkRateLimit(keyId: string, limitPerMin: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;

  let entry = rateLimitWindows.get(keyId);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitWindows.set(keyId, entry);
  }

  // Evict timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= limitPerMin) {
    return false; // rate limit exceeded
  }

  entry.timestamps.push(now);
  return true;
}

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
 * Rate limiting: simple in-memory sliding window per keyId (see note above).
 */
@Injectable()
export class DeveloperKeyGuard implements CanActivate {
  constructor(
    private readonly devPortal: DevPortalService,
    private readonly reflector: Reflector,
  ) {}

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
    if (!checkRateLimit(verified.keyId, verified.rateLimitPerMin)) {
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
