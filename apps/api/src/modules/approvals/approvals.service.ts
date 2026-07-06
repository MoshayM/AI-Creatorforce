import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsGateway } from '../../gateway/events.gateway';
import { JobsService } from '../jobs/jobs.service';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly jobs: JobsService,
  ) {}

  async createApproval(projectId: string, jobId: string, expiresInHours = 48) {
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    return this.prisma.approval.upsert({
      where: { jobId },
      create: { projectId, jobId, expiresAt },
      update: { status: 'PENDING', expiresAt },
    });
  }

  async listPending(userId: string) {
    return this.prisma.approval.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        project: { userId },
      },
      include: {
        job: { include: { agentLogs: { orderBy: { createdAt: 'desc' }, take: 5 } } },
        project: { select: { title: true, channel: { select: { title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Reviewed (or expired) approvals — the Approval Center's history section. */
  async listHistory(userId: string, limit = 50) {
    return this.prisma.approval.findMany({
      where: {
        project: { userId },
        OR: [
          { status: { in: ['APPROVED', 'REJECTED', 'EXPIRED'] } },
          { status: 'PENDING', expiresAt: { lte: new Date() } }, // lapsed but never marked
        ],
      },
      include: {
        job: { select: { type: true, result: true } },
        project: { select: { title: true, channel: { select: { title: true } } } },
      },
      orderBy: [{ reviewedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
  }

  async approve(approvalId: string, userId: string, notes?: string) {
    const approval = await this.getOwnedApproval(approvalId, userId);
    if (approval.expiresAt < new Date()) throw new BadRequestException('Approval expired');

    const [updated] = await this.prisma.$transaction([
      this.prisma.approval.update({
        where: { id: approvalId },
        data: { status: 'APPROVED', reviewedBy: userId, reviewedAt: new Date(), notes },
      }),
      // Transition the associated job from WAITING_APPROVAL → COMPLETED so downstream
      // steps (SEO, Thumbnail, Publish) become runnable.
      this.prisma.agentJob.update({
        where: { id: approval.jobId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
    ]);

    // Notify frontend via WebSocket so the page updates without a full refresh.
    this.events.emitJobComplete(approval.jobId, { approved: true });

    // Shorts publish approvals: the review IS the last human step — enqueue
    // the publish server-side so it doesn't depend on a browser tab polling.
    // Failure here is non-fatal; the clip stays resumable via the publish API.
    try {
      const job = await this.prisma.agentJob.findUnique({
        where: { id: approval.jobId },
        select: { type: true, projectId: true, result: true },
      });
      const result = job?.result as { shortClipId?: string; exportId?: string } | null;
      if (job?.type === 'SHORTS_EXPORT' && result?.shortClipId && result?.exportId) {
        await this.prisma.shortClip.update({
          where: { id: result.shortClipId },
          data: { status: 'APPROVED' },
        });
        await this.jobs.enqueue(job.projectId, 'SHORTS_PUBLISH', {
          shortClipId: result.shortClipId,
          exportId: result.exportId,
          approvalId,
        });
        this.logger.log(`Approved shorts export — auto-enqueued SHORTS_PUBLISH for clip ${result.shortClipId}`);
      }
    } catch (err) {
      this.logger.warn(`Post-approval publish enqueue failed (resumable via API): ${err instanceof Error ? err.message : String(err)}`);
    }

    return updated;
  }

  async reject(approvalId: string, userId: string, notes?: string) {
    await this.getOwnedApproval(approvalId, userId);
    return this.prisma.approval.update({
      where: { id: approvalId },
      data: { status: 'REJECTED', reviewedBy: userId, reviewedAt: new Date(), notes },
    });
  }

  private async getOwnedApproval(approvalId: string, userId: string) {
    const approval = await this.prisma.approval.findFirst({
      where: { id: approvalId, project: { userId } },
    });
    if (!approval) throw new NotFoundException('Approval not found');
    return approval;
  }
}
