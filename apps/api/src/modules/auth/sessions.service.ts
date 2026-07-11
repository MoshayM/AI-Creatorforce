import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

// ── Pure helpers (exported for unit testing) ──────────────────────────────────

/** Returns the SHA-256 hex digest of a raw refresh token. Tokens are never stored in the clear. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Generates a cryptographically random refresh token (48 bytes → base64url). */
export function newRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export type RefreshDecision = 'ROTATE' | 'REUSE_DETECTED' | 'INVALID';

type SessionRow = {
  revokedAt: Date | null;
  rotatedAt: Date | null;
  expiresAt: Date;
};

/**
 * Decides what to do with a refresh-token lookup result.
 *
 * - null        → INVALID  (not found)
 * - expired     → INVALID  (session TTL elapsed)
 * - revokedAt   → REUSE_DETECTED  (whole family revoked — replay after revocation)
 * - rotatedAt   → REUSE_DETECTED  (token was already used once, replay attempt)
 * - healthy     → ROTATE   (issue new token, mark this row rotatedAt)
 */
export function refreshDecision(row: SessionRow | null, now: Date): RefreshDecision {
  if (row === null) return 'INVALID';
  if (row.expiresAt <= now) return 'INVALID';
  if (row.revokedAt !== null) return 'REUSE_DETECTED';
  if (row.rotatedAt !== null) return 'REUSE_DETECTED';
  return 'ROTATE';
}

// ── Config ────────────────────────────────────────────────────────────────────

function refreshTtlDays(): number {
  const raw = process.env['REFRESH_TOKEN_TTL_DAYS'];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

// ── Service ───────────────────────────────────────────────────────────────────

export interface SessionMeta {
  device?: string;
  ip?: string;
}

export interface IssuedTokens {
  refreshToken: string;
  familyId: string;
  sessionId: string;
}

export interface RotatedTokens {
  refreshToken: string;
  familyId: string;
  userId: string;
}

export interface ActiveSessionView {
  id: string;
  device: string | null;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a new AuthSession row and returns the raw refresh token.
   * The raw token is returned exactly once and never persisted — only its hash is stored.
   *
   * @param familyId  Supply when rotating (same family); omit to start a new family.
   */
  async issue(
    userId: string,
    meta: SessionMeta,
    familyId?: string,
  ): Promise<IssuedTokens> {
    const token = newRefreshToken();
    const hash = hashRefreshToken(token);
    const resolvedFamilyId = familyId ?? randomUUID();
    const ttl = refreshTtlDays();
    const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);

    const session = await this.prisma.authSession.create({
      data: {
        userId,
        familyId: resolvedFamilyId,
        refreshTokenHash: hash,
        device: meta.device ?? null,
        ip: meta.ip ?? null,
        expiresAt,
      },
    });

    return { refreshToken: token, familyId: resolvedFamilyId, sessionId: session.id };
  }

  /**
   * Validates and rotates a refresh token.
   *
   * - If the token is replayed after rotation or revocation → revoke the whole
   *   family (refresh-token reuse detection) and throw UnauthorizedException.
   * - If the token is expired or unknown → throw UnauthorizedException.
   * - If healthy → mark the old row rotatedAt, issue a new row in the same family.
   */
  async rotate(refreshToken: string, meta: SessionMeta): Promise<RotatedTokens> {
    const hash = hashRefreshToken(refreshToken);
    const now = new Date();

    const row = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: hash },
    });

    const decision = refreshDecision(row, now);

    if (decision === 'REUSE_DETECTED') {
      // Revoke the entire family to force re-authentication on all devices.
      await this.prisma.authSession.updateMany({
        where: { familyId: row!.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit(row!.userId, 'auth.reuse_detected', {
        familyId: row!.familyId,
        sessionId: row!.id,
      });
      this.logger.warn(`Refresh-token reuse detected — family revoked: ${row!.familyId}`);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (decision === 'INVALID') {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // ROTATE: mark current row as consumed, then issue a new one in the same family.
    // Guarded update — a concurrent refresh with the same token would otherwise
    // pass refreshDecision too; only the first writer may rotate, the loser is a replay.
    const claimed = await this.prisma.authSession.updateMany({
      where: { id: row!.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: now, lastUsedAt: now },
    });
    if (claimed.count === 0) {
      await this.prisma.authSession.updateMany({
        where: { familyId: row!.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit(row!.userId, 'auth.reuse_detected', {
        familyId: row!.familyId,
        sessionId: row!.id,
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const { refreshToken: newToken, familyId } = await this.issue(
      row!.userId,
      meta,
      row!.familyId,
    );

    return { refreshToken: newToken, familyId, userId: row!.userId };
  }

  /**
   * Revokes all non-revoked sessions in a family, scoped to the given userId
   * to prevent cross-user revocation.
   */
  async revokeFamily(userId: string, familyId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit(userId, 'auth.session_revoked', { familyId });
  }

  /**
   * Returns all active sessions for the user (not revoked, not rotated-out, not expired).
   * Marks the session matching currentFamilyId as current.
   */
  async listActive(
    userId: string,
    currentFamilyId?: string,
  ): Promise<ActiveSessionView[]> {
    const now = new Date();
    const rows = await this.prisma.authSession.findMany({
      where: {
        userId,
        revokedAt: null,
        rotatedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { lastUsedAt: 'desc' },
    });

    // Deduplicate by familyId — show the most-recently-used row per family.
    const seen = new Set<string>();
    const result: ActiveSessionView[] = [];
    for (const row of rows) {
      if (seen.has(row.familyId)) continue;
      seen.add(row.familyId);
      result.push({
        id: row.familyId,
        device: row.device,
        ip: row.ip,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        current: row.familyId === currentFamilyId,
      });
    }
    return result;
  }

  /**
   * Returns true when the family has at least one non-revoked, non-expired row.
   * Used by JwtStrategy to gate access tokens whose session may have been revoked.
   */
  async isFamilyActive(familyId: string): Promise<boolean> {
    const now = new Date();
    const count = await this.prisma.authSession.count({
      where: {
        familyId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    return count > 0;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async audit(
    userId: string,
    action: string,
    meta: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { userId, action, meta },
    });
  }
}
