import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import type { RenderPreset } from '@prisma/client';

@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

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

    // Real FFmpeg render via the agent job system (audit-placeholders.md B2:
    // the previous simulateRender faked progress/checksum/size with timers).
    // Timeline presets map onto the worker's aspect presets.
    const presetMap: Record<string, string> = {
      DRAFT_PROXY: 'LANDSCAPE',
      YT_1080P: 'LANDSCAPE',
      YT_4K: 'LANDSCAPE',
      SHORTS_1080X1920: 'VERTICAL',
    };
    await this.jobs.enqueue(projectId, 'RENDER', {
      preset: presetMap[preset] ?? 'LANDSCAPE',
      renderRowId: render.id,
      pipelineMode: true,
    });

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

}
