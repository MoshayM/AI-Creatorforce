import { Injectable, NotFoundException, ServiceUnavailableException, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AGENT_QUEUE } from './jobs.constants';
import { currentCorrelationId } from '../../common/correlation.context';
import type { JobType } from '@cf/shared';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(AGENT_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(
    projectId: string | null,
    type: JobType,
    payload: Record<string, unknown> = {},
    opts?: { developerKeyId?: string; idempotencyKey?: string },
  ) {
    // Enqueue idempotency (Wave 17, risk R-02): a replayed Idempotency-Key
    // returns the original job — the unique column closes the concurrent race
    // the pre-check alone can't.
    const idempotencyKey = opts?.idempotencyKey?.trim() || undefined;
    if (idempotencyKey) {
      const existing = await this.prisma.agentJob.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
    }

    let job;
    try {
      job = await this.prisma.agentJob.create({
        data: { projectId, type, status: 'PENDING', payload: payload as never, idempotencyKey },
      });
    } catch (err: unknown) {
      // P2002 = unique violation: a concurrent enqueue with the same key won.
      if (idempotencyKey && (err as { code?: string }).code === 'P2002') {
        const winner = await this.prisma.agentJob.findUnique({ where: { idempotencyKey } });
        if (winner) return winner;
      }
      throw err;
    }

    try {
      await this.assertQueueReady();
      await this.queue.add(type, { jobId: job.id, projectId, type, payload, correlationId: currentCorrelationId(), developerKeyId: opts?.developerKeyId }, {
        jobId: job.id,
        attempts: 1,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Queue unavailable while enqueuing job ${job.id} (${type}): ${msg}`);
      await this.prisma.agentJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: 'Queue unavailable — Redis is not running' } });
      throw new ServiceUnavailableException(
        'Queue unavailable — Redis is not running. Start the services (run creatorforce-AI.bat) and try again.',
      );
    }

    // Guarded transition: the worker may have already picked the job up and set
    // RUNNING (or even COMPLETED) — only PENDING may move to QUEUED.
    await this.prisma.agentJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'QUEUED' },
    });
    return job;
  }

  /**
   * Fail fast instead of hanging when the queue's Redis connection isn't
   * ready. The connection is eager and retries forever (app.module.ts), so if
   * the API booted while Redis was down, BullMQ's client promise stays pending
   * until Redis returns — without this guard an enqueue would block for as
   * long as Redis is down instead of returning the 503 the UI expects.
   */
  private async assertQueueReady(timeoutMs = 2000): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const client = await Promise.race([
        this.queue.client,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Redis connection not ready (timed out)')), timeoutMs);
          timer.unref?.();
        }),
      ]);
      if (client.status !== 'ready') {
        throw new Error(`Redis connection not ready (status: ${client.status})`);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async get(jobId: string) {
    const job = await this.prisma.agentJob.findUnique({
      where: { id: jobId },
      include: { agentLogs: { orderBy: { createdAt: 'asc' } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async listByProject(projectId: string) {
    return this.prisma.agentJob.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Persist a user-edited stage result as a new COMPLETED job. Downstream
   * stages read via lastResult() (latest completedAt wins), so edits flow
   * into every later stage; write-once history is preserved — prior AI
   * results are never mutated.
   */
  async overrideResult(projectId: string, type: JobType, result: unknown) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');
    const now = new Date();
    return this.prisma.agentJob.create({
      data: {
        projectId,
        type,
        status: 'COMPLETED',
        payload: { editedByUser: true } as never,
        result: result as never,
        startedAt: now,
        completedAt: now,
      },
    });
  }

  /**
   * DLQ replay (docs4/35): re-run a dead job as a FRESH AgentJob so the
   * failed row stays in history (write-once). Pipeline resume semantics mean
   * completed prior stages are reused, so replaying FULL_PRODUCTION picks up
   * where the failure happened.
   */
  async replayFailed(jobId: string) {
    const dead = await this.prisma.agentJob.findUnique({ where: { id: jobId } });
    if (!dead) throw new NotFoundException('Job not found');
    if (dead.status !== 'FAILED' && dead.status !== 'CANCELLED') {
      throw new BadRequestException(`Only FAILED or CANCELLED jobs can be replayed (job is ${dead.status})`);
    }
    return this.enqueue(dead.projectId, dead.type, (dead.payload ?? {}) as Record<string, unknown>);
  }

  async cancel(jobId: string) {
    const bJob = await this.queue.getJob(jobId);
    if (bJob) await bJob.remove();
    return this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED' },
    });
  }

  /** Permanently delete a job record (history cleanup). Logs and any approval
   *  row cascade at the DB level. Active jobs must be cancelled first; if the
   *  deleted row was a stage's latest result, that stage reverts to the
   *  previous run. */
  async remove(jobId: string, userId: string) {
    const job = await this.prisma.agentJob.findUnique({
      where: { id: jobId },
      include: { project: { select: { userId: true } } },
    });
    // Project-less jobs (CHANNEL_SYNC) are owned via their channel instead.
    let owned = job?.project ? job.project.userId === userId : false;
    if (job && !job.project) {
      const channelId = (job.payload as { channelId?: string } | null)?.channelId;
      if (channelId) {
        const channel = await this.prisma.channel.findUnique({
          where: { id: channelId },
          select: { userId: true },
        });
        owned = channel?.userId === userId;
      }
    }
    if (!job || !owned) throw new NotFoundException('Job not found');
    if (['PENDING', 'QUEUED', 'RUNNING'].includes(job.status)) {
      throw new BadRequestException('This job is still active — cancel it before deleting.');
    }
    await this.prisma.agentJob.delete({ where: { id: jobId } });
    return { deleted: true };
  }

  async listForUser(
    userId: string,
    opts?: { status?: string; type?: string; limit?: number },
  ) {
    const where: Record<string, unknown> = { project: { userId } };
    if (opts?.status && opts.status !== 'ALL') where['status'] = opts.status;
    if (opts?.type) where['type'] = opts.type;

    const jobs = await this.prisma.agentJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 100,
      include: { project: { select: { id: true, title: true } } },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [allCounts, todayCounts] = await Promise.all([
      this.prisma.agentJob.groupBy({ by: ['status'], where: { project: { userId } }, _count: { _all: true } }),
      this.prisma.agentJob.groupBy({ by: ['status'], where: { project: { userId }, completedAt: { gte: today } }, _count: { _all: true } }),
    ]);

    const toMap = (rows: Array<{ status: string; _count: { _all: number } }>) =>
      Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

    return { jobs, counts: toMap(allCounts), todayCounts: toMap(todayCounts) };
  }

  async logStep(jobId: string, agentName: string, step: string, input: unknown, output: unknown, tokensIn = 0, tokensOut = 0, latencyMs = 0) {
    return this.prisma.agentLog.create({
      data: {
        jobId,
        agentName,
        step,
        input: input as never,
        output: output as never,
        tokensIn,
        tokensOut,
        latencyMs,
      },
    });
  }
}
