import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

// ── Config ────────────────────────────────────────────────────────────────────

/** Sweep interval (default: 10 minutes). */
const JOB_INTERVAL_MS = 10 * 60_000;
/** Boot delay, offset from the notification jobs to spread startup load. */
const BOOT_DELAY_MS = 8 * 60_000;

/**
 * A RUNNING job whose row hasn't moved past this age is considered dead.
 * Generous by design: FULL_PRODUCTION renders are long, and the cost of
 * reaping late (a stuck row lingers a bit) is far lower than reaping a live
 * render (its result is thrown away).
 */
function stallMs(): number {
  const minutes = parseInt(process.env['JOB_REAPER_STALL_MINUTES'] ?? '120', 10);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 120) * 60_000;
}

/** Whether the reaper runs (default true; set false in tests). */
function reaperEnabled(): boolean {
  const v = process.env['JOB_REAPER_ENABLED'];
  return v === undefined || v === 'true' || v === '1';
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Stalled-job reaper (Wave 17, risk R-01): BullMQ's stalled detection covers
 * the queue side, but the AgentJob DB row of a crashed worker stays RUNNING
 * forever — blocking "still active" guards and holding credit reservations.
 * This sweep moves RUNNING rows past the deadline to FAILED and releases any
 * credit hold still referencing them (the supervisor releases holds on its own
 * failure path; this covers the path where the process died before it could).
 *
 * Guarded transition: only RUNNING rows are touched, keyed by the same
 * updatedAt the deadline was computed from, so a job that completes between
 * read and write is never clobbered.
 */
@Injectable()
export class JobReaperJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobReaperJob.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env['NODE_ENV'] === 'test' || !reaperEnabled()) return;

    this.timers.push(
      setTimeout(() => {
        void this.reap();
      }, BOOT_DELAY_MS),
    );
    this.timers.push(
      setInterval(() => {
        void this.reap();
      }, JOB_INTERVAL_MS),
    );
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  async reap(now: Date = new Date()): Promise<{ reaped: number; holdsReleased: number }> {
    try {
      const cutoff = new Date(now.getTime() - stallMs());

      const stalled = await this.prisma.agentJob.findMany({
        where: { status: 'RUNNING', updatedAt: { lt: cutoff } },
        select: { id: true, type: true, updatedAt: true },
      });
      if (stalled.length === 0) return { reaped: 0, holdsReleased: 0 };

      let reaped = 0;
      for (const job of stalled) {
        const res = await this.prisma.agentJob.updateMany({
          where: { id: job.id, status: 'RUNNING', updatedAt: job.updatedAt },
          data: {
            status: 'FAILED',
            error: 'Reaped: worker did not report completion within the stall deadline (process crashed or was killed). Re-run the stage — completed prior stages are reused.',
            completedAt: now,
          },
        });
        reaped += res.count;
      }

      // Job-scoped holds (referenceId = jobId, set by the supervisor's reserve
      // call). RELEASED, not SETTLED: no work was billed.
      const holds = await this.prisma.creditReservation.updateMany({
        where: { status: 'HELD', referenceId: { in: stalled.map((j) => j.id) } },
        data: { status: 'RELEASED' },
      });

      if (reaped > 0) {
        this.logger.warn(
          `[reaper] failed ${reaped} stalled job(s), released ${holds.count} credit hold(s): ${stalled.map((j) => `${j.id} (${j.type})`).join(', ')}`,
        );
      }
      return { reaped, holdsReleased: holds.count };
    } catch (err) {
      this.logger.warn(`[reaper] run failed: ${err instanceof Error ? err.message : String(err)}`);
      return { reaped: 0, holdsReleased: 0 };
    }
  }
}
