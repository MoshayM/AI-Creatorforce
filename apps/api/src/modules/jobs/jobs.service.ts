import { Injectable, NotFoundException, ServiceUnavailableException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AGENT_QUEUE } from './jobs.constants';
import type { JobType } from '@cf/shared';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(AGENT_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(projectId: string, type: JobType, payload: Record<string, unknown> = {}) {
    const job = await this.prisma.agentJob.create({
      data: { projectId, type, status: 'PENDING', payload: payload as never },
    });

    try {
      await this.queue.add(type, { jobId: job.id, projectId, type, payload }, {
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

  async cancel(jobId: string) {
    const bJob = await this.queue.getJob(jobId);
    if (bJob) await bJob.remove();
    return this.prisma.agentJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED' },
    });
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
