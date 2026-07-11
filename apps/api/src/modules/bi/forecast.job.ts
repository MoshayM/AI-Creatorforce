import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BiService } from './bi.service';

// ── Config ────────────────────────────────────────────────────────────────────

/** Run the forecast job on this interval (default: 24 hours). */
const JOB_INTERVAL_MS = 24 * 60 * 60_000;
/** Delay after module init before first run — avoids thundering herd at boot. */
const BOOT_DELAY_MS = 10 * 60_000;

/** Whether the job is enabled (default true; always off in NODE_ENV=test). */
function jobEnabled(): boolean {
  if (process.env['NODE_ENV'] === 'test') return false;
  const v = process.env['FORECAST_JOB_ENABLED'];
  return v === undefined || v === 'true' || v === '1';
}

// ── Job ───────────────────────────────────────────────────────────────────────

/**
 * Phase 5 §14: forecast-generation background job.
 *
 * Runs daily (after a boot delay) and calls BiService.generateForecasts().
 * generateForecasts() is idempotent per day so replayed runs are harmless.
 * Errors are logged, never re-thrown (the job must not crash the process).
 *
 * Extension points:
 * - Email/Slack alert on persistent failures: inject NotificationsService.
 * - Configurable interval: replace JOB_INTERVAL_MS with an env-tunable value.
 */
@Injectable()
export class ForecastJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ForecastJob.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(private readonly bi: BiService) {}

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
      this.logger.log('[forecast-job] starting forecast generation');
      await this.bi.generateForecasts();
      this.logger.log('[forecast-job] forecast generation complete');
    } catch (err) {
      // Errors logged, never re-thrown — the job must not crash the process.
      this.logger.error(
        `[forecast-job] generation failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
