import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BillingService } from './billing.service';
import { WalletService } from '../wallet/wallet.service';

const SWEEP_INTERVAL_MS = 15 * 60_000;
const RECONCILE_INTERVAL_MS = 24 * 60 * 60_000;
const BOOT_DELAY_MS = 2 * 60_000;

/**
 * Billing background jobs (billing spec §11), interval-based — this
 * local-first deployment has no cron infra, and a drifting schedule is fine
 * for reconciliation work. Each run is independently safe to repeat.
 */
@Injectable()
export class BillingJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingJobsService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly wallet: WalletService,
  ) {}

  onModuleInit() {
    // Skip in tests (jest sets NODE_ENV=test) so timers never leak into specs
    if (process.env['NODE_ENV'] === 'test') return;
    this.timers.push(setInterval(() => void this.sweepStaleReservations(), SWEEP_INTERVAL_MS));
    this.timers.push(setInterval(() => void this.runReconciliation(), RECONCILE_INTERVAL_MS));
    this.timers.push(setTimeout(() => {
      void this.sweepStaleReservations();
      void this.runReconciliation();
    }, BOOT_DELAY_MS));
  }

  private async runReconciliation() {
    // §5.4 credit-expiry-job runs BEFORE reconciliation so expired lots are
    // already posted when balances are recomputed
    const expired = await this.wallet.expireLots().catch((err) => {
      this.logger.warn(`[expiry] failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    });
    if (expired > 0) this.logger.log(`[expiry] ${expired} lot(s) expired`);
    await this.reconcileLedger();
    const settlements = await this.billing.reconcilePendingPayments().catch((err) => {
      this.logger.warn(`[settlement] failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    if (settlements && settlements.checked > 0) {
      this.logger.log(`[settlement] ${settlements.checked} stale payment(s): ${settlements.recovered} recovered, ${settlements.expired} expired`);
    }
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /**
   * §11 webhook-retry-sweeper analogue for holds: expired HELD reservations
   * are already invisible to availability math — this marks them RELEASED so
   * the table reads honestly.
   */
  async sweepStaleReservations(): Promise<number> {
    try {
      const res = await this.prisma.creditReservation.updateMany({
        where: { status: 'HELD', expiresAt: { lt: new Date() } },
        data: { status: 'RELEASED' },
      });
      if (res.count > 0) this.logger.log(`[sweep] released ${res.count} expired hold(s)`);
      return res.count;
    } catch (err) {
      this.logger.warn(`[sweep] failed: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }

  /**
   * §5.5/§11 ledger-reconciliation-job: the wallet row is only a read cache —
   * recompute every balance from the ledger and treat any mismatch as a P1:
   * loud log + audit row (the ledger is truth; the cache is what's wrong).
   */
  async reconcileLedger(): Promise<{ checked: number; mismatches: number }> {
    try {
      const [wallets, sums] = await Promise.all([
        this.prisma.wallet.findMany({ select: { id: true, userId: true, balanceCredits: true } }),
        this.prisma.creditLedger.groupBy({ by: ['walletId'], _sum: { amount: true } }),
      ]);
      const sumByWallet = new Map(sums.map((s) => [s.walletId, s._sum.amount ?? 0]));

      let mismatches = 0;
      for (const w of wallets) {
        const ledgerSum = sumByWallet.get(w.id) ?? 0;
        if (ledgerSum !== w.balanceCredits) {
          mismatches += 1;
          this.logger.error(
            `[P1][reconcile] wallet ${w.id} cache=${w.balanceCredits} ledger=${ledgerSum} (drift ${w.balanceCredits - ledgerSum})`,
          );
          await this.prisma.auditLog.create({
            data: {
              userId: w.userId,
              action: 'system:ledger-mismatch',
              target: w.id,
              meta: { cachedBalance: w.balanceCredits, ledgerSum, driftedBy: w.balanceCredits - ledgerSum } as never,
            },
          }).catch(() => undefined);
        }
      }
      this.logger.log(`[reconcile] ${wallets.length} wallet(s) checked, ${mismatches} mismatch(es)`);
      return { checked: wallets.length, mismatches };
    } catch (err) {
      this.logger.warn(`[reconcile] failed: ${err instanceof Error ? err.message : String(err)}`);
      return { checked: 0, mismatches: 0 };
    }
  }
}
