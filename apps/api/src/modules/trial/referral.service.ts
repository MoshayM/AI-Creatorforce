import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';
import { bonusWithinMargin } from './offers.service';

// ── Unambiguous base32 alphabet — no 0/O/1/I ─────────────────────────────────
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Deterministic 8-char referral code from a sha256 seed.
 * Uses a 32-symbol unambiguous alphabet (no 0/O/1/I) so codes are
 * human-readable without transcription errors. Pure — exported for tests.
 */
export function generateReferralCode(seed: string): string {
  const digest = createHash('sha256').update(seed).digest();
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[digest[i]! % ALPHABET.length];
  }
  return code;
}

/**
 * Referral acceptance decision with explicit precedence ordering:
 * inactive > self > already. Pure — exported for tests.
 */
export function referralDecision(args: {
  selfReferral: boolean;
  alreadyReferred: boolean;
  codeActive: boolean;
}): 'ACCEPT' | 'REJECT_SELF' | 'REJECT_ALREADY' | 'REJECT_INACTIVE' {
  if (!args.codeActive) return 'REJECT_INACTIVE';
  if (args.selfReferral) return 'REJECT_SELF';
  if (args.alreadyReferred) return 'REJECT_ALREADY';
  return 'ACCEPT';
}

/**
 * Detect shared-device or shared-IP fraud signals between referrer and
 * referred. Only flags when both sides have a non-null/non-undefined value
 * that matches — two missing values never constitute a match. Pure.
 */
export function fraudFlags(
  referrer: { deviceFingerprint?: string | null; ipHash?: string | null },
  referred: { deviceFingerprint?: string | null; ipHash?: string | null },
): string[] {
  const flags: string[] = [];
  if (
    referrer.deviceFingerprint != null &&
    referred.deviceFingerprint != null &&
    referrer.deviceFingerprint === referred.deviceFingerprint
  ) {
    flags.push('SHARED_DEVICE');
  }
  if (
    referrer.ipHash != null &&
    referred.ipHash != null &&
    referrer.ipHash === referred.ipHash
  ) {
    flags.push('SHARED_IP');
  }
  return flags;
}

/**
 * Returns the highest milestone tier index (1-based) the qualified count
 * has reached. Returns 0 when no tier is met. Default tiers: [3, 10, 25].
 * Pure — exported for tests.
 */
export function milestoneFor(qualifiedCount: number, tiers = [3, 10, 25]): number {
  let level = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (qualifiedCount >= tiers[i]!) level = i + 1;
  }
  return level;
}

/**
 * Credits to grant for each reward kind. Env-tunable defaults:
 *   REFERRAL_REFERRER_CREDITS   default 50
 *   REFERRAL_REFERRED_CREDITS   default 25
 *   REFERRAL_MILESTONE_CREDITS  default 200 (× milestoneLevel for MILESTONE)
 * Pure — exported for tests.
 */
export function rewardCredits(
  kind: 'REFERRER' | 'REFERRED' | 'MILESTONE',
  milestoneLevel?: number,
): number {
  const referrer = Math.max(0, Number(process.env['REFERRAL_REFERRER_CREDITS']) || 50);
  const referred = Math.max(0, Number(process.env['REFERRAL_REFERRED_CREDITS']) || 25);
  const milestone = Math.max(0, Number(process.env['REFERRAL_MILESTONE_CREDITS']) || 200);
  switch (kind) {
    case 'REFERRER': return referrer;
    case 'REFERRED': return referred;
    case 'MILESTONE': return milestone * (milestoneLevel ?? 1);
  }
}

// ── Injectable service ────────────────────────────────────────────────────────

function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

function creditsPerUsd(): number {
  return Math.max(1, Math.round(Number(process.env['CREDITS_PER_USD']) || 100));
}

function minMargin(): number {
  const v = Number(process.env['MIN_PROFIT_MARGIN']);
  return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.3;
}

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Get or deterministically create a referral code for this user. */
  async getOrCreateCode(userId: string): Promise<{ code: string }> {
    const existing = await this.prisma.referralCode.findUnique({ where: { userId } });
    if (existing) return { code: existing.code };

    let attempt = 0;
    while (true) {
      const seed = attempt === 0 ? userId : `${userId}:${attempt}`;
      const code = generateReferralCode(seed);
      try {
        const created = await this.prisma.referralCode.create({
          data: { userId, code },
        });
        return { code: created.code };
      } catch {
        // unique constraint violation on code — try next seed
        attempt++;
        if (attempt > 10) throw new Error('Failed to generate unique referral code after 10 attempts');
      }
    }
  }

  /**
   * Redeem a referral code: validates, creates the Referral row PENDING,
   * increments usesCount, stores hashed signals. Rejects with ConflictException
   * on any non-ACCEPT decision.
   */
  async redeem(
    userId: string,
    code: string,
    signals: { deviceFingerprint?: string; ip?: string } = {},
  ): Promise<{ referralId: string }> {
    const codeRow = await this.prisma.referralCode.findUnique({ where: { code } });

    const decision = referralDecision({
      selfReferral: codeRow?.userId === userId,
      alreadyReferred: !!(await this.prisma.referral.findUnique({ where: { referredId: userId } })),
      codeActive: !!codeRow?.isActive,
    });

    if (decision !== 'ACCEPT') {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'referral.rejected',
          target: code,
          meta: { decision } as never,
        },
      });
      throw new ConflictException(decision);
    }

    const ipHash = signals.ip ? hashIp(signals.ip) : undefined;
    const deviceFingerprint = signals.deviceFingerprint?.slice(0, 128);

    const referral = await this.prisma.$transaction(async (tx) => {
      const row = await tx.referral.create({
        data: {
          referrerId: codeRow!.userId,
          referredId: userId,
          codeId: codeRow!.id,
          deviceFingerprint: deviceFingerprint ?? null,
          ipHash: ipHash ?? null,
        },
      });
      await tx.referralCode.update({
        where: { id: codeRow!.id },
        data: { usesCount: { increment: 1 } },
      });
      return row;
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'referral.redeem',
        target: referral.id,
        meta: { referrerId: codeRow!.userId, code } as never,
      },
    });

    return { referralId: referral.id };
  }

  /**
   * Called from payment-success path after a user's first recharge.
   * Finds the PENDING referral for this user, runs fraud checks, and
   * if clean: pays out REFERRER + REFERRED rewards and runs milestone check.
   * Never throws — safe to call from webhook (caller wraps in .catch()).
   */
  async qualify(referredUserId: string, paymentId: string): Promise<void> {
    const referral = await this.prisma.referral.findUnique({
      where: { referredId: referredUserId },
      include: { code: true },
    });
    if (!referral || referral.status !== 'PENDING') return;

    const referrerId = referral.referrerId;

    // Load referrer's fraud signals from their TrialGrant row (same place signup signals are stored)
    const referrerTrial = await this.prisma.trialGrant.findUnique({
      where: { userId: referrerId },
      select: { deviceFingerprint: true, ipHash: true },
    });

    const flags = fraudFlags(
      { deviceFingerprint: referrerTrial?.deviceFingerprint, ipHash: referrerTrial?.ipHash },
      { deviceFingerprint: referral.deviceFingerprint, ipHash: referral.ipHash },
    );

    if (flags.length > 0) {
      await this.prisma.referral.update({
        where: { id: referral.id },
        data: { status: 'FLAGGED', flagReason: flags.join(', ') },
      });
      await this.prisma.auditLog.create({
        data: {
          userId: referrerId,
          action: 'referral.flagged',
          target: referral.id,
          meta: { flags, paymentId } as never,
        },
      });
      this.logger.warn(`[referral] FLAGGED ${referral.id}: ${flags.join(', ')}`);
      return;
    }

    // Qualify the referral
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'QUALIFIED', qualifiedAt: new Date() },
    });

    // Margin gate: validate reward amounts against the payment amount
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    const amountMinor = payment?.amount ?? 0;
    const referrerCredits = rewardCredits('REFERRER');
    const referredCredits = rewardCredits('REFERRED');
    const totalRewardCredits = referrerCredits + referredCredits;

    if (amountMinor > 0 && !bonusWithinMargin(amountMinor, totalRewardCredits, creditsPerUsd(), minMargin())) {
      await this.prisma.auditLog.create({
        data: {
          userId: referrerId,
          action: 'referral.reward_blocked',
          target: referral.id,
          meta: { reason: 'margin_gate', amountMinor, totalRewardCredits, paymentId } as never,
        },
      });
      this.logger.warn(`[referral] reward blocked for ${referral.id}: margin gate failed (${totalRewardCredits} credits on ${amountMinor} minor units)`);
      return;
    }

    // Grant REFERRER reward
    await this.grantReward(referral.id, referrerId, 'REFERRER', referrerCredits);
    this.notifications.notify(
      referrerId,
      'referral.reward',
      `You earned ${referrerCredits} referral credits`,
      `A friend you referred has made their first recharge.`,
      { kind: 'REFERRER', credits: referrerCredits, referralId: referral.id },
    ).catch(() => undefined);

    // Grant REFERRED reward
    await this.grantReward(referral.id, referredUserId, 'REFERRED', referredCredits);
    this.notifications.notify(
      referredUserId,
      'referral.reward',
      `You earned ${referredCredits} referral credits`,
      `Welcome bonus for joining via a referral link.`,
      { kind: 'REFERRED', credits: referredCredits, referralId: referral.id },
    ).catch(() => undefined);

    // Milestone check
    const qualifiedCount = await this.prisma.referral.count({
      where: { referrerId, status: { in: ['QUALIFIED', 'REWARDED'] } },
    });
    const newMilestone = milestoneFor(qualifiedCount);
    if (newMilestone > 0 && referral.milestoneLevel < newMilestone) {
      const milestoneCredits = rewardCredits('MILESTONE', newMilestone);
      await this.grantMilestoneReward(referrerId, newMilestone, milestoneCredits);
    }

    // Mark REWARDED
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'REWARDED', milestoneLevel: newMilestone },
    });

    this.logger.log(`[referral] ${referral.id} REWARDED: +${referrerCredits} referrer, +${referredCredits} referred`);
  }

  private async grantReward(
    referralId: string,
    beneficiaryId: string,
    kind: 'REFERRER' | 'REFERRED',
    credits: number,
  ): Promise<void> {
    const idempotencyKey = `referral:${referralId}:${kind}`;
    try {
      await this.prisma.referralReward.create({
        data: { referralId, beneficiaryId, kind, credits, idempotencyKey },
      });
    } catch {
      // unique violation = already granted (idempotent replay)
      return;
    }
    await this.wallet.credit(beneficiaryId, {
      entryType: 'REFERRAL',
      amount: credits,
      referenceType: 'REFERRAL',
      referenceId: referralId,
      idempotencyKey,
      metadata: { kind, referralId },
    });
  }

  private async grantMilestoneReward(
    referrerId: string,
    tier: number,
    credits: number,
  ): Promise<void> {
    // Find the most-recently rewarded referral for this referrer to attach the reward to
    const lastReferral = await this.prisma.referral.findFirst({
      where: { referrerId, status: { in: ['QUALIFIED', 'REWARDED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!lastReferral) return;

    const idempotencyKey = `referral:milestone:${referrerId}:${tier}`;
    try {
      await this.prisma.referralReward.create({
        data: {
          referralId: lastReferral.id,
          beneficiaryId: referrerId,
          kind: 'MILESTONE',
          credits,
          idempotencyKey,
        },
      });
    } catch {
      return; // already granted
    }
    await this.wallet.credit(referrerId, {
      entryType: 'REFERRAL',
      amount: credits,
      referenceType: 'REFERRAL',
      referenceId: lastReferral.id,
      idempotencyKey,
      metadata: { kind: 'MILESTONE', tier },
    });
    this.notifications.notify(
      referrerId,
      'referral.reward',
      `You earned ${credits} milestone credits`,
      `Congratulations — you've reached referral milestone tier ${tier}!`,
      { kind: 'MILESTONE', credits, tier, referralId: lastReferral.id },
    ).catch(() => undefined);
    this.logger.log(`[referral] milestone tier ${tier} → +${credits} credits to ${referrerId}`);
  }

  /** Earnings summary for the authenticated user. Does NOT expose referred users' emails. */
  async earnings(userId: string): Promise<{
    code: string | null;
    totalCredits: number;
    qualifiedCount: number;
    pendingCount: number;
    flaggedCount: number;
    referrals: Array<{ id: string; status: string; reward: number; createdAt: Date }>;
  }> {
    const [codeRow, referrals] = await Promise.all([
      this.prisma.referralCode.findUnique({ where: { userId } }),
      this.prisma.referral.findMany({
        where: { referrerId: userId },
        include: { rewards: { where: { beneficiaryId: userId } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalCredits = referrals.reduce(
      (sum, r) => sum + r.rewards.reduce((s, rw) => s + rw.credits, 0),
      0,
    );

    return {
      code: codeRow?.code ?? null,
      totalCredits,
      qualifiedCount: referrals.filter((r) => r.status === 'QUALIFIED' || r.status === 'REWARDED').length,
      pendingCount: referrals.filter((r) => r.status === 'PENDING').length,
      flaggedCount: referrals.filter((r) => r.status === 'FLAGGED').length,
      referrals: referrals.map((r) => ({
        id: r.id,
        status: r.status,
        reward: r.rewards.reduce((s, rw) => s + rw.credits, 0),
        createdAt: r.createdAt,
      })),
    };
  }

  /** Public leaderboard — userLabel is masked (first 2 chars + ***@domain). */
  async leaderboard(take = 10): Promise<
    Array<{ rank: number; userLabel: string; qualifiedCount: number; totalCredits: number }>
  > {
    // Aggregate qualified/rewarded referrals by referrer
    const rows = await this.prisma.referral.groupBy({
      by: ['referrerId'],
      where: { status: { in: ['QUALIFIED', 'REWARDED'] } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take,
    });

    const userIds = rows.map((r) => r.referrerId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.email]));

    // Sum total referral credits per referrer
    const creditRows = await this.prisma.referralReward.groupBy({
      by: ['beneficiaryId'],
      where: { beneficiaryId: { in: userIds } },
      _sum: { credits: true },
    });
    const creditMap = new Map(creditRows.map((r) => [r.beneficiaryId, r._sum.credits ?? 0]));

    return rows.map((r, i) => {
      const email = userMap.get(r.referrerId) ?? '';
      const [local = '', domain = ''] = email.split('@');
      const masked = `${local.slice(0, 2)}***@${domain}`;
      return {
        rank: i + 1,
        userLabel: masked,
        qualifiedCount: r._count.id,
        totalCredits: creditMap.get(r.referrerId) ?? 0,
      };
    });
  }

  /** Admin review queue. */
  async listFlagged(status?: string): Promise<unknown[]> {
    return this.prisma.referral.findMany({
      where: status ? { status } : { status: 'FLAGGED' },
      include: { rewards: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Admin: approve or reject a flagged referral.
   * APPROVE runs the full payout path (idempotency keys make it safe on replay).
   * REJECT keeps status FLAGGED, appends rejection note to flagReason.
   */
  async review(
    referralId: string,
    decision: 'APPROVE' | 'REJECT',
    adminId: string,
  ): Promise<{ referralId: string; decision: string }> {
    const referral = await this.prisma.referral.findUniqueOrThrow({
      where: { id: referralId },
    });
    if (referral.status !== 'FLAGGED') {
      throw new ConflictException(`Referral ${referralId} is not FLAGGED (status: ${referral.status})`);
    }

    if (decision === 'APPROVE') {
      // Re-run qualify payout using the referral's existing data.
      // Since referral is already QUALIFIED-ready (we just un-flag it),
      // we temporarily set it to PENDING to let qualify() proceed.
      await this.prisma.referral.update({
        where: { id: referralId },
        data: { status: 'PENDING', flagReason: null },
      });
      // qualify() will look up the referral by referredId
      await this.qualify(referral.referredId, '').catch((err: unknown) => {
        this.logger.warn(`[referral] admin approve qualify error: ${err instanceof Error ? err.message : String(err)}`);
      });
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'referral.review_approved',
          target: referralId,
          meta: {} as never,
        },
      });
    } else {
      await this.prisma.referral.update({
        where: { id: referralId },
        data: { flagReason: (referral.flagReason ?? '') + ' | rejected by admin' },
      });
      await this.prisma.auditLog.create({
        data: {
          userId: adminId,
          action: 'referral.review_rejected',
          target: referralId,
          meta: {} as never,
        },
      });
    }

    return { referralId, decision };
  }
}
