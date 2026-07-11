import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';

// ── Pure helpers (exported for tests) ────────────────────────────────────────

export type OrgAction = 'MANAGE_ORG' | 'MANAGE_BUDGET' | 'SPEND' | 'VIEW_REPORTS';

/**
 * Role-action matrix for org billing roles.
 *
 * ORG_ADMIN    → all actions
 * BILLING_ADMIN→ MANAGE_BUDGET + VIEW_REPORTS + SPEND
 * TEAM_MANAGER → SPEND + VIEW_REPORTS
 * MEMBER       → SPEND only
 */
export function orgRoleAllows(role: string, action: OrgAction): boolean {
  switch (role) {
    case 'ORG_ADMIN':
      return true;
    case 'BILLING_ADMIN':
      return action === 'MANAGE_BUDGET' || action === 'VIEW_REPORTS' || action === 'SPEND';
    case 'TEAM_MANAGER':
      return action === 'SPEND' || action === 'VIEW_REPORTS';
    case 'MEMBER':
      return action === 'SPEND';
    default:
      return false;
  }
}

/**
 * Find the index of the BudgetPeriod whose window contains `now`.
 * Returns -1 if none match. When periods overlap, returns the first match.
 */
export function currentPeriodFor(
  periods: Array<{ periodStart: Date; periodEnd: Date }>,
  now: Date,
): number {
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    if (p.periodStart <= now && now < p.periodEnd) return i;
  }
  return -1;
}

/**
 * Remaining credits in a budget period (floored at 0 — never negative).
 */
export function remainingCredits(allocated: number, consumed: number): number {
  return Math.max(0, allocated - consumed);
}

export type SpendDecision = 'ALLOW' | 'BLOCK_BUDGET' | 'NEEDS_APPROVAL';

/**
 * Determine whether a spend of `amount` credits should be allowed.
 *
 * Precedence (most restrictive first):
 *   1. hardCap && amount > remaining → BLOCK_BUDGET (not enough budget)
 *   2. approvalRequired && amount >= approvalThreshold → NEEDS_APPROVAL
 *   3. else → ALLOW  (soft-cap overspend is permitted; caller notifies manager)
 */
export function spendDecision(args: {
  hardCap: boolean;
  remaining: number;
  amount: number;
  approvalRequired: boolean;
  approvalThreshold: number;
}): SpendDecision {
  if (args.hardCap && args.amount > args.remaining) return 'BLOCK_BUDGET';
  if (args.approvalRequired && args.amount >= args.approvalThreshold) return 'NEEDS_APPROVAL';
  return 'ALLOW';
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface AddMemberDto {
  email: string;
  role?: string;
  teamId?: string;
  approvalRequired?: boolean;
}

export interface SetBudgetDto {
  teamId?: string;
  periodStart: Date;
  periodEnd: Date;
  allocatedCredits: number;
  hardCap?: boolean;
}

export interface OrgSpendDto {
  amount: number;
  action: string;
  memberUserId: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

const ORG_APPROVAL_THRESHOLD_DEFAULT = 100;

@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Org lifecycle ──────────────────────────────────────────────────────────

  /**
   * Create an org, add the creator as ORG_ADMIN, and provision the org wallet.
   * All three writes happen in a single transaction.
   */
  async create(ownerUserId: string, name: string, billingEmail?: string) {
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { ownerUserId, name, billingEmail },
      });

      await tx.orgMembership.create({
        data: { orgId: org.id, userId: ownerUserId, role: 'ORG_ADMIN' },
      });

      // Provision the org shared wallet inside the same transaction.
      await tx.wallet.create({ data: { orgId: org.id } });

      this.logger.log(`[orgs] created org ${org.id} owner=${ownerUserId}`);
      return org;
    });
  }

  /** All orgs the user is a member of (any role). */
  async myOrgs(userId: string) {
    const memberships = await this.prisma.orgMembership.findMany({
      where: { userId },
      include: { org: true },
    });
    return memberships.map((m) => ({ ...m.org, role: m.role }));
  }

  // ── Membership management ─────────────────────────────────────────────────

  /**
   * Add (or update) a member.  Actor must hold MANAGE_ORG.
   * Target user is resolved by email — 404 if not registered.
   */
  async addMember(actorId: string, orgId: string, dto: AddMemberDto) {
    await this.requireOrgAction(actorId, orgId, 'MANAGE_ORG');

    const target = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!target) throw new NotFoundException(`No user registered with email ${dto.email}`);

    const membership = await this.prisma.orgMembership.upsert({
      where: { orgId_userId: { orgId, userId: target.id } },
      create: {
        orgId,
        userId: target.id,
        role: dto.role ?? 'MEMBER',
        teamId: dto.teamId,
        approvalRequired: dto.approvalRequired ?? false,
      },
      update: {
        role: dto.role ?? 'MEMBER',
        teamId: dto.teamId,
        approvalRequired: dto.approvalRequired ?? false,
      },
    });

    this.logger.log(`[orgs] addMember org=${orgId} user=${target.id} role=${membership.role} actor=${actorId}`);
    return membership;
  }

  /** List all members. Any member of the org may call this. */
  async members(actorId: string, orgId: string) {
    await this.requireMembership(actorId, orgId);
    return this.prisma.orgMembership.findMany({
      where: { orgId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Budget management ─────────────────────────────────────────────────────

  /**
   * Create a BudgetPeriod for the org (optionally scoped to a team).
   * Validates: end > start, allocated >= 0.
   */
  async setBudget(actorId: string, orgId: string, dto: SetBudgetDto) {
    await this.requireOrgAction(actorId, orgId, 'MANAGE_BUDGET');

    if (dto.periodEnd <= dto.periodStart) {
      throw new BadRequestException('periodEnd must be after periodStart');
    }
    if (!Number.isInteger(dto.allocatedCredits) || dto.allocatedCredits < 0) {
      throw new BadRequestException('allocatedCredits must be a non-negative integer');
    }

    const period = await this.prisma.budgetPeriod.create({
      data: {
        orgId,
        teamId: dto.teamId,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        allocatedCredits: dto.allocatedCredits,
        hardCap: dto.hardCap ?? true,
      },
    });

    this.logger.log(`[orgs] setBudget org=${orgId} team=${dto.teamId ?? 'org-wide'} credits=${dto.allocatedCredits} actor=${actorId}`);
    return period;
  }

  /**
   * Return budget status for the current period (optionally scoped to a team).
   * Falls back to org-wide period if no team-scoped one is found.
   */
  async budgetStatus(actorId: string, orgId: string, teamId?: string) {
    await this.requireMembership(actorId, orgId);

    const now = new Date();
    const periods = await this.prisma.budgetPeriod.findMany({
      where: { orgId, teamId: teamId ?? null },
      orderBy: { periodStart: 'asc' },
    });

    const idx = currentPeriodFor(periods, now);
    const period = idx >= 0 ? periods[idx] : null;

    const wallet = await this.prisma.wallet.findUnique({ where: { orgId } });

    return {
      period,
      remaining: period ? remainingCredits(period.allocatedCredits, period.consumedCredits) : null,
      orgBalance: wallet?.balanceCredits ?? 0,
    };
  }

  // ── Org spend (main integration point) ───────────────────────────────────

  /**
   * Gate and execute a credit spend against the org wallet.
   *
   * Flow:
   *   1. Resolve the member's membership (+ teamId for budget scope).
   *   2. Find the current BudgetPeriod for (org, teamId|org-wide).
   *   3. Run spendDecision.
   *   4a. ALLOW        → reserve on org wallet + recordConsumption.
   *   4b. NEEDS_APPROVAL → notify manager + return status (no reservation).
   *      Deviation from spec §10: the existing Approval model is tightly coupled
   *      to AgentJob/Project (project.userId ownership check) and cannot cleanly
   *      represent org-scoped spend approvals.  Instead we: (a) return
   *      { status: 'NEEDS_APPROVAL' } to the caller; (b) notify all
   *      TEAM_MANAGER/ORG_ADMIN members in the team; (c) write an audit log row.
   *      If a dedicated org approval table is added later, wire it here.
   *   4c. BLOCK_BUDGET → throw BadRequestException('ORG_BUDGET_EXCEEDED').
   *
   * After a successful reserve, soft-cap (non-hard-cap) overspend also fires a
   * manager notification.
   */
  async orgSpend(
    actorId: string,
    orgId: string,
    dto: OrgSpendDto,
  ): Promise<{ status: 'ALLOWED'; reservationId: string } | { status: 'NEEDS_APPROVAL' }> {
    // 1. Resolve membership
    const membership = await this.prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId: dto.memberUserId } },
    });
    if (!membership) throw new NotFoundException('Member is not part of this organisation');

    if (!orgRoleAllows(membership.role, 'SPEND')) {
      throw new ForbiddenException('Member role does not permit spending');
    }

    // 2. Current budget period (team-scoped first, then org-wide fallback)
    const now = new Date();
    let period = await this.currentPeriod(orgId, membership.teamId ?? undefined, now);
    if (!period) {
      period = await this.currentPeriod(orgId, undefined, now);
    }

    // 3. Spend decision
    const approvalThreshold =
      Math.max(1, Number(process.env['ORG_APPROVAL_THRESHOLD_CREDITS']) || ORG_APPROVAL_THRESHOLD_DEFAULT);

    const remaining = period ? remainingCredits(period.allocatedCredits, period.consumedCredits) : Infinity;
    const hardCap = period?.hardCap ?? false;

    const decision = spendDecision({
      hardCap,
      remaining: remaining === Infinity ? Number.MAX_SAFE_INTEGER : remaining,
      amount: dto.amount,
      approvalRequired: membership.approvalRequired,
      approvalThreshold,
    });

    if (decision === 'BLOCK_BUDGET') {
      throw new BadRequestException('ORG_BUDGET_EXCEEDED');
    }

    if (decision === 'NEEDS_APPROVAL') {
      // Notify managers (non-fatal)
      await this.notifyManagers(orgId, membership.teamId ?? undefined, {
        type: 'org.spend.approval_required',
        title: 'Spend approval required',
        body: `A ${dto.amount}-credit action (${dto.action}) needs approval`,
        meta: { orgId, memberUserId: dto.memberUserId, amount: dto.amount, action: dto.action },
      });

      this.logger.log(
        `[orgs] orgSpend NEEDS_APPROVAL org=${orgId} member=${dto.memberUserId} amount=${dto.amount}`,
      );
      return { status: 'NEEDS_APPROVAL' };
    }

    // 4a. ALLOW — reserve on the org wallet
    const orgWallet = await this.walletService.ensureOrgWallet(orgId);
    const idempotencyKey = `org-spend:${orgId}:${dto.memberUserId}:${dto.action}:${Date.now()}`;
    const reservation = await this.walletService.reserveForWallet(
      orgWallet.id,
      dto.amount,
      idempotencyKey,
      'AI_REQUEST',
      dto.action,
    );

    // Record consumption against the current budget period
    if (period) {
      await this.recordConsumption(orgId, membership.teamId ?? undefined, dto.amount);
    }

    // Soft-cap overspend notification (period exists, not hard-cap, but over budget)
    if (period && !hardCap && dto.amount > remaining) {
      await this.notifyManagers(orgId, membership.teamId ?? undefined, {
        type: 'org.budget.softcap',
        title: 'Budget soft cap exceeded',
        body: `Org budget soft cap has been exceeded by ${dto.amount - remaining} credits`,
        meta: { orgId, teamId: membership.teamId, amount: dto.amount, remaining },
      });
    }

    // 80% consumed threshold notification
    if (period) {
      const newConsumed = period.consumedCredits + dto.amount;
      const pct = (newConsumed / period.allocatedCredits) * 100;
      if (pct >= 80) {
        await this.notifyAdmins(orgId, {
          type: 'org.budget.alert',
          title: 'Budget 80% consumed',
          body: `Organisation budget is ${Math.round(pct)}% consumed`,
          meta: { orgId, teamId: period.teamId, pct, consumed: newConsumed, allocated: period.allocatedCredits },
        });
      }
    }

    this.logger.log(
      `[orgs] orgSpend ALLOWED org=${orgId} member=${dto.memberUserId} amount=${dto.amount} reservation=${reservation.id}`,
    );
    return { status: 'ALLOWED', reservationId: reservation.id };
  }

  /**
   * Increment consumedCredits on the current budget period.
   * Called after a successful reservation so the period stays in sync.
   */
  async recordConsumption(orgId: string, teamId: string | undefined, credits: number) {
    const now = new Date();
    const period = await this.currentPeriod(orgId, teamId, now);
    if (!period) return;
    await this.prisma.budgetPeriod.update({
      where: { id: period.id },
      data: { consumedCredits: { increment: credits } },
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async currentPeriod(orgId: string, teamId: string | undefined, now: Date) {
    const periods = await this.prisma.budgetPeriod.findMany({
      where: {
        orgId,
        teamId: teamId ?? null,
        periodStart: { lte: now },
        periodEnd: { gt: now },
      },
      orderBy: { periodStart: 'asc' },
      take: 1,
    });
    return periods[0] ?? null;
  }

  private async requireMembership(userId: string, orgId: string) {
    const m = await this.prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!m) throw new ForbiddenException('Not a member of this organisation');
    return m;
  }

  private async requireOrgAction(userId: string, orgId: string, action: OrgAction) {
    const m = await this.requireMembership(userId, orgId);
    if (!orgRoleAllows(m.role, action)) {
      throw new ForbiddenException(`Role ${m.role} cannot perform ${action}`);
    }
    return m;
  }

  private async notifyManagers(
    orgId: string,
    teamId: string | undefined,
    payload: { type: string; title: string; body: string; meta: Record<string, unknown> },
  ) {
    const managers = await this.prisma.orgMembership.findMany({
      where: {
        orgId,
        role: { in: ['ORG_ADMIN', 'TEAM_MANAGER'] },
        ...(teamId ? { teamId } : {}),
      },
      select: { userId: true },
    });
    for (const m of managers) {
      // notify is guaranteed non-throwing
      await this.notifications.notify(m.userId, payload.type, payload.title, payload.body, payload.meta);
    }
  }

  private async notifyAdmins(
    orgId: string,
    payload: { type: string; title: string; body: string; meta: Record<string, unknown> },
  ) {
    const admins = await this.prisma.orgMembership.findMany({
      where: { orgId, role: { in: ['ORG_ADMIN', 'BILLING_ADMIN'] } },
      select: { userId: true },
    });
    for (const a of admins) {
      await this.notifications.notify(a.userId, payload.type, payload.title, payload.body, payload.meta);
    }
  }
}
