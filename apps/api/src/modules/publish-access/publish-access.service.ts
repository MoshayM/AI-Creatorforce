import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PublishAccessStatus } from '@prisma/client';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { roleHasPermission } from '../../common/rbac';

export { PublishAccessStatus };

/** Pure helper — exported for unit testing without Prisma. */
export function viaRole(role: UserRole | string): boolean {
  return roleHasPermission(role as UserRole, 'publish:direct');
}

@Injectable()
export class PublishAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** True when the user can publish directly to YouTube (via role or an active grant). */
  async canPublishDirect(userId: string, role: UserRole | string): Promise<boolean> {
    if (viaRole(role)) return true;
    const row = await this.prisma.publishAccessGrant.findUnique({ where: { userId } });
    return row?.status === PublishAccessStatus.GRANTED;
  }

  /**
   * Throws ForbiddenException when direct publishing is not allowed.
   * Call this at the start of any endpoint that pushes to YouTube.
   */
  async assertCanPublishDirect(userId: string, role: UserRole | string): Promise<void> {
    const allowed = await this.canPublishDirect(userId, role);
    if (!allowed) {
      throw new ForbiddenException(
        'Direct publishing to YouTube requires publish access. Use Edit & Download, or request access from your admin.',
      );
    }
  }

  /** Current access status for a user — used by the frontend to decide which buttons to show. */
  async myStatus(
    userId: string,
    role: UserRole | string,
  ): Promise<{ canPublishDirect: boolean; viaRole: boolean; grantStatus: PublishAccessStatus | null }> {
    if (viaRole(role)) {
      return { canPublishDirect: true, viaRole: true, grantStatus: null };
    }
    const row = await this.prisma.publishAccessGrant.findUnique({ where: { userId } });
    const grantStatus = row?.status ?? null;
    return {
      canPublishDirect: grantStatus === PublishAccessStatus.GRANTED,
      viaRole: false,
      grantStatus,
    };
  }

  /**
   * Request direct publish access.
   * - Role-holders already have access → BadRequestException.
   * - Existing GRANTED or REQUESTED row → returned as-is (idempotent).
   * - Otherwise upserts a REQUESTED row.
   */
  async request(userId: string, role: UserRole | string) {
    if (viaRole(role)) {
      throw new BadRequestException('You already have publish access.');
    }

    const existing = await this.prisma.publishAccessGrant.findUnique({ where: { userId } });
    if (existing?.status === PublishAccessStatus.GRANTED || existing?.status === PublishAccessStatus.REQUESTED) {
      return existing;
    }

    return this.prisma.publishAccessGrant.upsert({
      where: { userId },
      create: { userId, status: PublishAccessStatus.REQUESTED, requestedAt: new Date() },
      update: { status: PublishAccessStatus.REQUESTED, requestedAt: new Date(), decidedAt: null, decidedById: null },
    });
  }

  /** List all grant rows with user details, newest first. Admin-only. */
  async listAll() {
    return this.prisma.publishAccessGrant.findMany({
      orderBy: { requestedAt: 'desc' },
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    });
  }

  /**
   * Approve or deny a REQUESTED grant.
   * Row must exist and be in REQUESTED status, else BadRequestException.
   */
  async decide(targetUserId: string, approve: boolean, deciderId: string) {
    const row = await this.prisma.publishAccessGrant.findUnique({ where: { userId: targetUserId } });
    if (!row || row.status !== PublishAccessStatus.REQUESTED) {
      throw new BadRequestException('No pending request found for this user.');
    }
    return this.prisma.publishAccessGrant.update({
      where: { userId: targetUserId },
      data: {
        status: approve ? PublishAccessStatus.GRANTED : PublishAccessStatus.DENIED,
        decidedAt: new Date(),
        decidedById: deciderId,
      },
    });
  }

  /**
   * Revoke a GRANTED access.
   * Row must be GRANTED, else BadRequestException.
   */
  async revoke(targetUserId: string, deciderId: string) {
    const row = await this.prisma.publishAccessGrant.findUnique({ where: { userId: targetUserId } });
    if (!row || row.status !== PublishAccessStatus.GRANTED) {
      throw new BadRequestException('No active grant found for this user.');
    }
    return this.prisma.publishAccessGrant.update({
      where: { userId: targetUserId },
      data: {
        status: PublishAccessStatus.REVOKED,
        decidedAt: new Date(),
        decidedById: deciderId,
      },
    });
  }
}
