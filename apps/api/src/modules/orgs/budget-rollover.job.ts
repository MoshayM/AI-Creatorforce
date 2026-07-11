import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OrgsService } from './orgs.service';

// ── Config ────────────────────────────────────────────────────────────────────

/** Run the rollover job on this interval (default: 1 hour). */
const JOB_INTERVAL_MS = 60 * 60_000;
/** Delay after module init before first run — avoids thundering herd at boot. */
const BOOT_DELAY_MS = 2 * 60_000;

/** Whether the job is enabled (default true; always off in NODE_ENV=test). */
function jobEnabled(): boolean {
  if (process.env['NODE_ENV'] === 'test') return false;
  const v = process.env['BUDGET_ROLLOVER_JOB_ENABLED'];
  return v === undefined || v === 'true' || v === '1';
}

// ── Job ───────────────────────────────────────────────────────────────────────

/**
 * Phase 5 §14: budget-period-rollover background job.
 *
 * Runs hourly and calls OrgsService.rolloverExpiredBudgets(): every (org,
 * team) whose latest BudgetPeriod has ended gets a successor with the same
 * allocation/hardCap and consumption reset.  Without this, an expired period
 * means spendDecision sees no budget at all and org spend goes unbudgeted.
 *
 * rolloverExpiredBudgets() is idempotent (successor-existence check), so
 * replayed or overlapping runs are harmless.  Errors are logged, never
 * re-thrown (the job must not crash the process).
 */
@Injectable()
export class BudgetRolloverJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BudgetRolloverJob.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(private readonly orgs: OrgsService) {}

  onModuleInit(): void {
    if (!jobEnabled()) return;

    this.timers.push(
      setTimeout(() => {
        void this.run();
      }, BOOT_DELAY_MS),
    );
    this.timers.push(
      setInterval(() => {
        void this.run();
      }, JOB_INTERVAL_MS),
    );
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
  }

  async run(): Promise<void> {
    try {
      const created = await this.orgs.rolloverExpiredBudgets();
      if (created > 0) {
        this.logger.log(`[budget-rollover] opened ${created} new budget period(s)`);
      }
    } catch (err) {
      this.logger.error(
        `[budget-rollover] run failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
