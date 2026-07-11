import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService, shouldNotifyTrialExpiry } from './notifications.service';

// ── Config ────────────────────────────────────────────────────────────────────

/** Run both jobs on this interval (default: 1 hour). */
const JOB_INTERVAL_MS = 60 * 60_000;
/** Delay after module init before first run — avoids thundering herd at boot. */
const BOOT_DELAY_MS = 5 * 60_000;
/** Low-trial-credit threshold as a fraction (env NOTIFICATIONS_LOW_TRIAL_PCT, default 20). */
function lowTrialPct(): number {
  const v = Number(process.env['NOTIFICATIONS_LOW_TRIAL_PCT']);
  return Number.isFinite(v) && v > 0 && v < 100 ? v / 100 : 0.2;
}
/** Whether the background jobs are enabled (default true; set false in tests). */
function jobsEnabled(): boolean {
  const v = process.env['NOTIFICATIONS_JOBS_ENABLED'];
  return v === undefined || v === 'true' || v === '1';
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Phase 6 §16: Trial expiry background jobs.
 *
 * trial-expiry-notify (hourly):
 *   - For ACTIVE TrialGrants with a future expiresAt, fires trial.expiring
 *     notifications at the 7/3/1 day-mark boundaries (each mark fires once).
 *   - Also fires trial.exhausted when the trial bucket's remaining credits
 *     fall to or below LOW_TRIAL_PCT — deduplication ensures one notification.
 *
 * trial-expiry-sweep (hourly):
 *   - For ACTIVE TrialGrants whose expiresAt is in the past, materialises the
 *     derived EXPIRED status by writing status=EXPIRED to the DB row. The
 *     credit-lot expiry machinery runs independently — this job does NOT touch
 *     lots, it only updates the grant row and emits trial.expired.
 *
 * Both jobs are idempotent: re-runs produce no new DB rows thanks to the
 * notification dedupe in NotificationsService and the status guard in the
 * sweep path. Errors are logged, never re-thrown.
 *
 * Extension points:
 * - Push notifications: add provider call inside notify() per type.
 * - Email notifications: same injection point.
 * - Configurable intervals: replace JOB_INTERVAL_MS with env-tunable values.
 */
@Injectable()
export class TrialExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrialExpiryJob.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (process.env['NODE_ENV'] === 'test' || !jobsEnabled()) return;

    this.timers.push(
      setTimeout(() => {
        void this.runNotify();
        void this.runSweep();
      }, BOOT_DELAY_MS),
    );
    this.timers.push(
      setInterval(() => {
        void this.runNotify();
      }, JOB_INTERVAL_MS),
    );
    this.timers.push(
      setInterval(() => {
        void this.runSweep();
      }, JOB_INTERVAL_MS),
    );
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ── trial-expiry-notify ────────────────────────────────────────────────────

  async runNotify(): Promise<void> {
    try {
      const now = new Date();

      // Only look at ACTIVE grants whose expiry is in the future
      const grants = await this.prisma.trialGrant.findMany({
        where: { status: 'ACTIVE', expiresAt: { gt: now } },
        select: {
          id: true,
          userId: true,
          expiresAt: true,
        },
      });

      for (const grant of grants) {
        await this.processNotify(grant, now).catch((err: unknown) => {
          this.logger.warn(
            `[trial-expiry-notify] error on grant ${grant.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    } catch (err) {
      this.logger.warn(
        `[trial-expiry-notify] run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async processNotify(
    grant: { id: string; userId: string; expiresAt: Date },
    now: Date,
  ): Promise<void> {
    // ── 1. Day-mark expiry notifications ───────────────────────────────────
    // Find which day-marks have already been sent for this grant
    const existingMarks = await this.prisma.notification.findMany({
      where: {
        userId: grant.userId,
        type: 'trial.expiring',
        meta: { path: ['grantId'], equals: grant.id },
      },
      select: { meta: true },
    });

    const notifiedDays = existingMarks
      .map((n) => {
        const m = n.meta as Record<string, unknown>;
        return typeof m['dayMark'] === 'number' ? m['dayMark'] : null;
      })
      .filter((d): d is number => d !== null);

    const mark = shouldNotifyTrialExpiry(grant.expiresAt, now, notifiedDays);
    if (mark !== null) {
      const daysWord = mark === 1 ? '1 day' : `${mark} days`;
      await this.notifications.notify(
        grant.userId,
        'trial.expiring',
        `Your trial expires in ${daysWord}`,
        `Upgrade now to keep your credits and avoid interruption.`,
        { grantId: grant.id, dayMark: mark },
      );
    }

    // ── 2. Low-credits notification ─────────────────────────────────────────
    // Trial credits are TRIAL-bucket lots in the user's wallet. Sum remaining
    // and initial across all TRIAL lots (there is typically exactly one, but
    // we aggregate defensively in case of approved manual top-ups).
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: grant.userId },
      select: { id: true },
    }).catch(() => null);
    if (!wallet) return;

    const trialLots = await this.prisma.creditLot.findMany({
      where: { walletId: wallet.id, bucket: 'trialCredits' },
      select: { remaining: true, amount: true },
    }).catch(() => [] as Array<{ remaining: number; amount: number }>);

    // If no trial credit lot exists, skip the low-credit check.
    // The check is best-effort; dedupe prevents spam if it fires unexpectedly.
    if (trialLots.length === 0) return;

    const totalAmount = trialLots.reduce((s, l) => s + l.amount, 0);
    const totalRemaining = trialLots.reduce((s, l) => s + l.remaining, 0);

    if (totalAmount <= 0) return;

    const usedPct = 1 - totalRemaining / totalAmount;
    if (usedPct >= 1 - lowTrialPct()) {
      // trial.exhausted fires at most once per grant (24h dedupe + same meta)
      await this.notifications.notify(
        grant.userId,
        'trial.exhausted',
        'Trial credits running low',
        `You've used ${Math.round(usedPct * 100)}% of your trial credits. Upgrade to continue.`,
        { grantId: grant.id },
      );
    }
  }

  // ── trial-expiry-sweep ─────────────────────────────────────────────────────

  async runSweep(): Promise<void> {
    try {
      const now = new Date();

      // ACTIVE grants whose expiresAt is in the past — effectiveTrialStatus
      // derives EXPIRED at read time; this materialises it into the DB row.
      // The credit-lot expiry job runs separately and handles lot.balance=0;
      // we do NOT touch lots here.
      const expired = await this.prisma.trialGrant.findMany({
        where: { status: 'ACTIVE', expiresAt: { lte: now } },
        select: { id: true, userId: true },
      });

      for (const grant of expired) {
        await this.sweepGrant(grant).catch((err: unknown) => {
          this.logger.warn(
            `[trial-expiry-sweep] error on grant ${grant.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    } catch (err) {
      this.logger.warn(
        `[trial-expiry-sweep] run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async sweepGrant(grant: { id: string; userId: string }): Promise<void> {
    // Idempotent update — if another replica already wrote EXPIRED, updateMany
    // simply matches 0 rows.
    const result = await this.prisma.trialGrant.updateMany({
      where: { id: grant.id, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });

    if (result.count > 0) {
      // Only notify once — dedupe in notify() guards against replayed sweeps
      await this.notifications.notify(
        grant.userId,
        'trial.expired',
        'Your free trial has ended',
        'Recharge your wallet to keep creating.',
        { grantId: grant.id },
      );
      this.logger.log(`[trial-expiry-sweep] expired grant ${grant.id} for user ${grant.userId}`);
    }
  }
}
