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

/**
 * Successor windows for an expired budget period (spec §14 budget-period-rollover).
 *
 * Each window has the same duration as `latest`, starts exactly where the
 * previous one ends, and windows are generated until one contains `now`
 * (so a long outage catches up in a single run).  `maxPeriods` bounds the
 * catch-up so a years-stale period can't explode into thousands of rows.
 *
 * Returns [] when `latest` has not ended yet or its duration is non-positive.
 */
export function rolloverWindows(
  latest: { periodStart: Date; periodEnd: Date },
  now: Date,
  maxPeriods = 12,
): Array<{ periodStart: Date; periodEnd: Date }> {
  const duration = latest.periodEnd.getTime() - latest.periodStart.getTime();
  if (duration <= 0 || latest.periodEnd > now) return [];

  const windows: Array<{ periodStart: Date; periodEnd: Date }> = [];
  let start = latest.periodEnd.getTime();
  while (windows.length < maxPeriods) {
    const end = start + duration;
    windows.push({ periodStart: new Date(start), periodEnd: new Date(end) });
    if (end > now.getTime()) break;
    start = end;
  }
  return windows;
}

/**
 * Parse the reservation idempotency key written by orgSpend:
 * `org-spend:{orgId}:{memberUserId}:{action}:{ts}`.
 *
 * The action segment may itself contain ':' — orgId/memberUserId are cuids
 * (no ':') and the trailing segment is a numeric timestamp, so everything
 * between index 2 and the final segment is the action.  Returns null for
 * keys not produced by orgSpend.
 */
export function parseOrgSpendKey(
  key: string,
): { orgId: string; memberUserId: string; action: string } | null {
  const parts = key.split(':');
  if (parts.length < 5 || parts[0] !== 'org-spend') return null;
  const ts = parts[parts.length - 1];
  if (!/^\d+$/.test(ts)) return null;
  return {
    orgId: parts[1],
    memberUserId: parts[2],
    action: parts.slice(3, -1).join(':'),
  };
}

export interface UsageReportRow {
  userId: string;
  email: string | null;
  teamId: string | null;
  role: string;
  actions: Record<string, { credits: number; count: number }>;
  totalCredits: number;
  count: number;
}

/**
 * Roll up org-wallet reservations into per-member usage rows (spec §10).
 *
 * Credits counted: settledCredits for SETTLED holds (the real debit),
 * reserved amount for still-HELD ones.  RELEASED holds are expected to be
 * filtered out by the caller (credits were returned).  Reservations whose
 * member is no longer in the org still appear (role 'REMOVED') — usage
 * history must not vanish with a membership.
 */
export function buildUsageReport(
  reservations: Array<{ idempotencyKey: string; amount: number; status: string; settledCredits: number | null }>,
  members: Array<{ userId: string; teamId: string | null; role: string; email: string | null }>,
): { byMember: UsageReportRow[]; totalCredits: number; reservationCount: number } {
  const memberIndex = new Map(members.map((m) => [m.userId, m]));
  const rows = new Map<string, UsageReportRow>();
  let totalCredits = 0;
  let reservationCount = 0;

  for (const r of reservations) {
    const parsed = parseOrgSpendKey(r.idempotencyKey);
    if (!parsed) continue;

    const credits = r.status === 'SETTLED' ? (r.settledCredits ?? r.amount) : r.amount;
    const member = memberIndex.get(parsed.memberUserId);

    let row = rows.get(parsed.memberUserId);
    if (!row) {
      row = {
        userId: parsed.memberUserId,
        email: member?.email ?? null,
        teamId: member?.teamId ?? null,
        role: member?.role ?? 'REMOVED',
        actions: {},
        totalCredits: 0,
        count: 0,
      };
      rows.set(parsed.memberUserId, row);
    }

    const bucket = (row.actions[parsed.action] ??= { credits: 0, count: 0 });
    bucket.credits += credits;
    bucket.count += 1;
    row.totalCredits += credits;
    row.count += 1;
    totalCredits += credits;
    reservationCount += 1;
  }

  return {
    byMember: [...rows.values()].sort((a, b) => b.totalCredits - a.totalCredits),
    totalCredits,
    reservationCount,
  };
}

/** Flatten a usage report into CSV (one row per member × action). */
export function usageReportCsv(report: { byMember: UsageReportRow[] }): string {
  const esc = (v: string | null) => {
    const s = v ?? '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['userId,email,teamId,role,action,credits,count'];
  for (const row of report.byMember) {
    for (const [action, agg] of Object.entries(row.actions)) {
      lines.push(
        [esc(row.userId), esc(row.email), esc(row.teamId), esc(row.role), esc(action), agg.credits, agg.count].join(','),
      );
    }
  }
  return lines.join('\n') + '\n';
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

  // ── Usage reports (spec §10) ──────────────────────────────────────────────

  /**
   * Per-member usage rolled up from the org wallet's reservations
   * (spec §10 "usage reports per team/department/member").
   *
   * Requires VIEW_REPORTS (ORG_ADMIN / BILLING_ADMIN / TEAM_MANAGER).
   * RELEASED holds are excluded — those credits were returned.
   * `teamId` filters rows to members of that team (usage by ex-members of the
   * team is attributed by their CURRENT membership, the ledger has no
   * historical team snapshot — documented limitation).
   */
  async usageReport(
    actorId: string,
    orgId: string,
    opts: { from?: Date; to?: Date; teamId?: string } = {},
  ) {
    await this.requireOrgAction(actorId, orgId, 'VIEW_REPORTS');

    const wallet = await this.prisma.wallet.findUnique({ where: { orgId } });
    if (!wallet) throw new NotFoundException('Organisation wallet not found');

    const [reservations, memberships] = await Promise.all([
      this.prisma.creditReservation.findMany({
        where: {
          walletId: wallet.id,
          status: { in: ['HELD', 'SETTLED'] },
          idempotencyKey: { startsWith: `org-spend:${orgId}:` },
          ...(opts.from || opts.to
            ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } }
            : {}),
        },
        select: { idempotencyKey: true, amount: true, status: true, settledCredits: true },
      }),
      this.prisma.orgMembership.findMany({
        where: { orgId },
        select: { userId: true, teamId: true, role: true },
      }),
    ]);

    // OrgMembership has no user relation — resolve emails by id.
    const users = await this.prisma.user.findMany({
      where: { id: { in: memberships.map((m) => m.userId) } },
      select: { id: true, email: true },
    });
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    const members = memberships.map((m) => ({
      userId: m.userId,
      teamId: m.teamId,
      role: m.role,
      email: emailById.get(m.userId) ?? null,
    }));

    const report = buildUsageReport(reservations, members);

    const byMember = opts.teamId
      ? report.byMember.filter((r) => r.teamId === opts.teamId)
      : report.byMember;

    return {
      orgId,
      from: opts.from ?? null,
      to: opts.to ?? null,
      teamId: opts.teamId ?? null,
      byMember,
      totalCredits: opts.teamId
        ? byMember.reduce((s, r) => s + r.totalCredits, 0)
        : report.totalCredits,
      reservationCount: opts.teamId
        ? byMember.reduce((s, r) => s + r.count, 0)
        : report.reservationCount,
    };
  }

  // ── Budget rollover (spec §14 budget-period-rollover job) ────────────────

  /**
   * Open successor BudgetPeriods for every (org, team) whose latest period has
   * ended.  Without this, an expired period means `currentPeriod` finds
   * nothing and spend silently becomes unbudgeted.
   *
   * The successor copies allocation/hardCap from the expired period with
   * consumption reset; multiple missed windows are backfilled in one run
   * (bounded — see rolloverWindows).  Idempotent: a successor is only created
   * when no period already starts at the expired period's end, so replayed
   * runs are harmless.
   *
   * Returns the number of periods created (for job logging).
   */
  async rolloverExpiredBudgets(now = new Date()): Promise<number> {
    const groups = await this.prisma.budgetPeriod.groupBy({
      by: ['orgId', 'teamId'],
      _max: { periodEnd: true },
    });

    let created = 0;
    for (const g of groups) {
      const latestEnd = g._max.periodEnd;
      if (!latestEnd || latestEnd > now) continue; // current period still open

      const latest = await this.prisma.budgetPeriod.findFirst({
        where: { orgId: g.orgId, teamId: g.teamId ?? null, periodEnd: latestEnd },
        orderBy: { periodStart: 'desc' },
      });
      if (!latest) continue;

      const windows = rolloverWindows(latest, now);
      if (windows.length === 0) continue;

      // Idempotency guard: another run may have rolled this group already.
      const successor = await this.prisma.budgetPeriod.findFirst({
        where: { orgId: g.orgId, teamId: g.teamId ?? null, periodStart: { gte: latest.periodEnd } },
      });
      if (successor) continue;

      await this.prisma.budgetPeriod.createMany({
        data: windows.map((w) => ({
          orgId: g.orgId,
          teamId: g.teamId,
          periodStart: w.periodStart,
          periodEnd: w.periodEnd,
          allocatedCredits: latest.allocatedCredits,
          hardCap: latest.hardCap,
        })),
      });
      created += windows.length;

      await this.notifyAdmins(g.orgId, {
        type: 'org.budget.rollover',
        title: 'Budget period rolled over',
        body: `A new ${latest.allocatedCredits}-credit budget period has started${g.teamId ? ' for your team' : ''}`,
        meta: { orgId: g.orgId, teamId: g.teamId, allocatedCredits: latest.allocatedCredits, periods: windows.length },
      });

      this.logger.log(
        `[orgs] budget rollover org=${g.orgId} team=${g.teamId ?? 'org-wide'} periods=${windows.length}`,
      );
    }
    return created;
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
