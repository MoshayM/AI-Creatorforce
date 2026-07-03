import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDraft(projectId: string, userId: string) {
    await this.prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });

    const draft = await this.prisma.timeline.findFirst({
      where: { projectId, isDraft: true },
      orderBy: { version: 'desc' },
    });

    const versions = await this.prisma.timeline.findMany({
      where: { projectId, isDraft: false },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, label: true, createdAt: true, contentHash: true },
    });

    return { draft, versions };
  }

  async saveDraft(
    projectId: string,
    userId: string,
    tracks: unknown,
    fps: number = 30,
    resolution: unknown = { width: 1920, height: 1080 },
    expectedVersion?: number,
  ) {
    await this.prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });

    const existing = await this.prisma.timeline.findFirst({
      where: { projectId, isDraft: true },
      orderBy: { version: 'desc' },
    });

    if (existing && expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new ConflictException(`Timeline version conflict — expected v${expectedVersion}, got v${existing.version}`);
    }

    if (existing) {
      return this.prisma.timeline.update({
        where: { id: existing.id },
        data: { tracks: tracks as never, fps, resolution: resolution as never, updatedAt: new Date() },
      });
    }

    return this.prisma.timeline.create({
      data: {
        projectId,
        version: 1,
        fps,
        resolution: resolution as never,
        tracks: tracks as never,
        isDraft: true,
        label: 'Working draft',
      },
    });
  }

  async freezeVersion(projectId: string, userId: string, label: string) {
    await this.prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });

    const draft = await this.prisma.timeline.findFirst({
      where: { projectId, isDraft: true },
      orderBy: { version: 'desc' },
    });

    if (!draft) throw new NotFoundException('No draft timeline found');

    const latestFrozen = await this.prisma.timeline.findFirst({
      where: { projectId, isDraft: false },
      orderBy: { version: 'desc' },
    });

    const nextVersion = (latestFrozen?.version ?? 0) + 1;

    return this.prisma.timeline.create({
      data: {
        projectId,
        version: nextVersion,
        label,
        fps: draft.fps,
        resolution: draft.resolution as never,
        tracks: draft.tracks as never,
        contentHash: draft.contentHash,
        isDraft: false,
      },
    });
  }

  async restoreVersion(projectId: string, userId: string, version: number) {
    await this.prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });

    const frozen = await this.prisma.timeline.findFirst({
      where: { projectId, version, isDraft: false },
    });

    if (!frozen) throw new NotFoundException(`Timeline version ${version} not found`);

    // Overwrite draft with frozen version content
    const draft = await this.prisma.timeline.findFirst({ where: { projectId, isDraft: true } });

    if (draft) {
      return this.prisma.timeline.update({
        where: { id: draft.id },
        data: { tracks: frozen.tracks as never, fps: frozen.fps, resolution: frozen.resolution as never },
      });
    }

    return this.prisma.timeline.create({
      data: {
        projectId,
        version: 1,
        fps: frozen.fps,
        resolution: frozen.resolution as never,
        tracks: frozen.tracks as never,
        isDraft: true,
        label: `Restored from v${version}`,
      },
    });
  }
}
