import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsGateway } from '../../gateway/events.gateway';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
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
