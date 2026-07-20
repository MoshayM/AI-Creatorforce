import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsGateway } from '../../gateway/events.gateway';
import { JobsService } from '../jobs/jobs.service';
import { decodeCursor, keysetWhereDesc, clampLimit, pageResult } from '../../common/pagination/cursor';

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

  async listPending(userId: string, opts: { cursor?: string; limit?: number } = {}) {
    const take = clampLimit(opts.limit, 50, 100);
    const rows = await this.prisma.approval.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        project: { userId },
        ...keysetWhereDesc('createdAt', decodeCursor(opts.cursor)),
      },
      include: {
        job: { include: { agentLogs: { orderBy: { createdAt: 'desc' }, take: 5 } } },
        project: { select: { title: true, channel: { select: { title: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    return pageResult(rows, take, (r) => r.createdAt);
  }

  /** Reviewed (or expired) approvals — the Approval Center's history section. */
  async listHistory(userId: string, opts: { cursor?: string; limit?: number } = {}) {
    const take = clampLimit(opts.limit, 50, 100);
    const rows = await this.prisma.approval.findMany({
      where: {
        project: { userId },
        // AND keeps the reviewed-or-lapsed OR intact alongside the cursor's OR
        AND: [
          {
            OR: [
              { status: { in: ['APPROVED', 'REJECTED', 'EXPIRED'] } },
              { status: 'PENDING', expiresAt: { lte: new Date() } }, // lapsed but never marked
            ],
          },
          keysetWhereDesc('createdAt', decodeCursor(opts.cursor)),
        ],
      },
      include: {
        job: { select: { type: true, result: true } },
        project: { select: { title: true, channel: { select: { title: true } } } },
      },
      // Keyset needs a stable non-null sort; reviewedAt is null for lapsed rows
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    return pageResult(rows, take, (r) => r.createdAt);
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
      if (job?.type === 'SHORTS_EXPORT' && job.projectId && result?.shortClipId && result?.exportId) {
        await this.prisma.shortClip.update({
          where: { id: result.shortClipId },
          data: { status: 'APPROVED' },
        });
        await this.jobs.enqueue(job.projectId, 'SHORTS_PUBLISH', {
          shortClipId: result.shortClipId,
          exportId: result.exportId,
          approvalId,
        }, { idempotencyKey: `SHORTS_PUBLISH-${result.shortClipId}-${approvalId}` });
        this.logger.log(`Approved shorts export — auto-enqueued SHORTS_PUBLISH for clip ${result.shortClipId}`);
      }
    } catch (err) {
      this.logger.warn(`Post-approval publish enqueue failed (resumable via API): ${err instanceof Error ? err.message : String(err)}`);
    }

    return updated;
  }

  async reject(approvalId: string, userId: string, notes?: string) {
    const approval = await this.getOwnedApproval(approvalId, userId);
    const updated = await this.prisma.approval.update({
      where: { id: approvalId },
      data: { status: 'REJECTED', reviewedBy: userId, reviewedAt: new Date(), notes },
    });

    // Shorts publish approvals: reflect the verdict on the clip itself so the
    // Clips list stops showing PENDING_APPROVAL. Non-fatal — the approval row
    // is the source of truth for the review either way.
    try {
      const clipId = await this.shortsClipIdForJob(approval.jobId);
      if (clipId) {
        await this.prisma.shortClip.update({ where: { id: clipId }, data: { status: 'REJECTED' } });
      }
    } catch (err) {
      this.logger.warn(`Could not mark clip REJECTED after approval rejection: ${err instanceof Error ? err.message : String(err)}`);
    }

    return updated;
  }

  /**
   * Reviewer verdict "needs work": close the approval and put the clip back
   * into editing so the user can adjust it and re-request publishing later.
   */
  async moveToEditing(approvalId: string, userId: string, notes?: string) {
    const approval = await this.getOwnedApproval(approvalId, userId);
    const clipId = await this.shortsClipIdForJob(approval.jobId);
    if (!clipId) throw new BadRequestException('Only Shorts publish approvals can be moved to editing');

    await this.prisma.$transaction([
      this.prisma.approval.update({
        where: { id: approvalId },
        data: { status: 'REJECTED', reviewedBy: userId, reviewedAt: new Date(), notes: notes?.trim() || 'Moved back to editing' },
      }),
      this.prisma.shortClip.update({ where: { id: clipId }, data: { status: 'IN_EDITING' } }),
    ]);
    return { shortClipId: clipId, status: 'IN_EDITING' };
  }

  /** shortClipId from a SHORTS_EXPORT job's result, or null for other job types. */
  private async shortsClipIdForJob(jobId: string): Promise<string | null> {
    const job = await this.prisma.agentJob.findUnique({
      where: { id: jobId },
      select: { type: true, result: true },
    });
    const result = job?.result as { shortClipId?: string } | null;
    return job?.type === 'SHORTS_EXPORT' && result?.shortClipId ? result.shortClipId : null;
  }

  private async getOwnedApproval(approvalId: string, userId: string) {
    const approval = await this.prisma.approval.findFirst({
      where: { id: approvalId, project: { userId } },
    });
    if (!approval) throw new NotFoundException('Approval not found');
    return approval;
  }
}
