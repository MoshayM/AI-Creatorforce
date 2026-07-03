import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RenderPreset } from '@prisma/client';

@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);

  constructor(private readonly prisma: PrismaService) {}

  async queueRender(projectId: string, timelineVersion: number, preset: RenderPreset, userId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });

    if (!project) throw new NotFoundException('Project not found');

    const timeline = await this.prisma.timeline.findFirst({
      where: { projectId, version: timelineVersion, isDraft: false },
    });

    if (!timeline) throw new NotFoundException(`Timeline version ${timelineVersion} not found. Freeze a version first.`);

    // Idempotency — return existing if already queued/rendered
    const existing = await this.prisma.render.findUnique({
      where: { projectId_timelineVersion_preset: { projectId, timelineVersion, preset } },
    });

    if (existing && existing.status === 'READY') return existing;
    if (existing && existing.status === 'RENDERING') return existing;
    if (existing && existing.status === 'QUEUED') return existing;

    const render = await this.prisma.render.create({
      data: {
        projectId,
        timelineId: timeline.id,
        timelineVersion,
        preset,
        status: 'QUEUED',
      },
    });

    // Simulate async render progress (real FFmpeg worker in production)
    this.simulateRender(render.id).catch(err => this.logger.error(`Render sim failed: ${err}`));

    return render;
  }

  async getRender(renderId: string, userId: string) {
    const render = await this.prisma.render.findUnique({
      where: { id: renderId },
      include: { project: { select: { userId: true } } },
    });

    if (!render || render.project.userId !== userId) throw new NotFoundException('Render not found');
    return render;
  }

  async listForProject(projectId: string, userId: string) {
    await this.prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
    return this.prisma.render.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async simulateRender(renderId: string) {
    // In production this is replaced by a real FFmpeg render worker
    await new Promise(r => setTimeout(r, 3000));
    await this.prisma.render.update({
      where: { id: renderId },
      data: { status: 'RENDERING', progressPct: 10 },
    });
    await new Promise(r => setTimeout(r, 5000));
    await this.prisma.render.update({
      where: { id: renderId },
      data: { status: 'RENDERING', progressPct: 60 },
    });
    await new Promise(r => setTimeout(r, 5000));
    await this.prisma.render.update({
      where: { id: renderId },
      data: {
        status: 'READY',
        progressPct: 100,
        r2Key: `renders/${renderId}/output.mp4`,
        checksum: `sha256-${renderId.slice(0, 16)}`,
        durationMs: 600000,
        sizeBytes: BigInt(1024 * 1024 * 150), // 150MB placeholder
      },
    });
    this.logger.log(`Render ${renderId} complete (simulated)`);
  }
}
