import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService, shouldNotifyTrialExpiry } from './notifications.service';

// ── Config ────────────────────────────────────────────────────────────────────

/** Run on this interval (default: 1 hour — same cadence as trial expiry). */
const JOB_INTERVAL_MS = 60 * 60_000;
/** Offset from TrialExpiryJob's 5-minute boot delay to spread startup load. */
const BOOT_DELAY_MS = 6 * 60_000;
/** Only lots expiring inside this window are examined (largest day-mark). */
const HORIZON_MS = 7 * 24 * 60 * 60_000;

/** Whether the background jobs are enabled (default true; set false in tests). */
function jobsEnabled(): boolean {
  const v = process.env['NOTIFICATIONS_JOBS_ENABLED'];
  return v === undefined || v === 'true' || v === '1';
}

const BUCKET_LABELS: Record<string, string> = {
  promotionalCredits: 'promotional',
  bonusCredits: 'bonus',
  referralCredits: 'referral',
  purchasedCredits: 'purchased',
};

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Credit-lot expiry warnings (billing spec §14): fires `credits.expiring`
 * at the 7/3/1 day-marks for every lot that still has credits remaining,
 * reusing the trial job's day-mark logic (`shouldNotifyTrialExpiry` — the
 * marks are generic; each mark fires once per lot).
 *
 * Excluded on purpose:
 * - `trialCredits` lots — their expiry equals the TrialGrant expiry, which
 *   TrialExpiryJob already announces; a second notification would be spam.
 * - Org shared wallets (userId null) — org budget warnings are the budget
 *   period machinery's job, not the lot ledger's.
 *
 * In-app only; the email/push extension point is inside notify(), same as
 * every other notification type.  Idempotent: per-lot day-marks are read
 * back from the notifications table, and notify()'s 24h dedupe guards
 * replays.  Errors are logged, never re-thrown.
 */
@Injectable()
export class LotExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LotExpiryJob.name);
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
      }, BOOT_DELAY_MS),
    );
    this.timers.push(
      setInterval(() => {
        void this.runNotify();
      }, JOB_INTERVAL_MS),
    );
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  async runNotify(): Promise<void> {
    try {
      const now = new Date();

      const lots = await this.prisma.creditLot.findMany({
        where: {
          remaining: { gt: 0 },
          bucket: { not: 'trialCredits' },
          expiresAt: { gt: now, lte: new Date(now.getTime() + HORIZON_MS) },
        },
        select: {
          id: true,
          bucket: true,
          remaining: true,
          expiresAt: true,
          wallet: { select: { userId: true } },
        },
      });

      for (const lot of lots) {
        await this.processLot(lot, now).catch((err: unknown) => {
          this.logger.warn(
            `[lot-expiry] error on lot ${lot.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    } catch (err) {
      this.logger.warn(`[lot-expiry] run failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async processLot(
    lot: { id: string; bucket: string; remaining: number; expiresAt: Date | null; wallet: { userId: string | null } },
    now: Date,
  ): Promise<void> {
    const userId = lot.wallet.userId;
    if (!userId || !lot.expiresAt) return;

    const existingMarks = await this.prisma.notification.findMany({
      where: {
        userId,
        type: 'credits.expiring',
        meta: { path: ['lotId'], equals: lot.id },
      },
      select: { meta: true },
    });
    const notifiedDays = existingMarks
      .map((n) => {
        const m = n.meta as Record<string, unknown>;
        return typeof m['dayMark'] === 'number' ? m['dayMark'] : null;
      })
      .filter((d): d is number => d !== null);

    const mark = shouldNotifyTrialExpiry(lot.expiresAt, now, notifiedDays);
    if (mark === null) return;

    const daysWord = mark === 1 ? '1 day' : `${mark} days`;
    const label = BUCKET_LABELS[lot.bucket] ?? lot.bucket;
    await this.notifications.notify(
      userId,
      'credits.expiring',
      `${lot.remaining.toLocaleString()} ${label} credits expire in ${daysWord}`,
      'Use them before they expire — expired credits are removed from your balance.',
      { lotId: lot.id, dayMark: mark, bucket: lot.bucket, remaining: lot.remaining },
    );
  }
}
