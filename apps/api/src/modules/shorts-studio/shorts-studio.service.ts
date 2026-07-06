import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';

/** Job types run by the shorts-import pipeline, in order (ai.md Section 3.1). */
export const SHORTS_IMPORT_STAGES = [
  'VIDEO_IMPORT',
  'TRANSCRIPT_ANALYSIS',
  'SCENE_DETECTION',
  'TOPIC_SEGMENTATION',
  'HIGHLIGHT_DETECTION',
] as const;

@Injectable()
export class ShortsStudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  /** Every route goes through this — new tables scope to projectId (ai.md Section 24.1). */
  async assertVideoOwnership(importedVideoId: string, userId: string) {
    const video = await this.prisma.importedVideo.findFirst({
      where: { id: importedVideoId, project: { userId } },
    });
    if (!video) throw new NotFoundException('Imported video not found');
    return video;
  }

  async assertProjectOwnership(projectId: string, userId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, userId } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async assertChannelOwnership(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, userId } });
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  async listImportedVideos(projectId: string) {
    return this.prisma.importedVideo.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { transcriptSegments: true, scenes: true, topicSegments: true } },
      },
    });
  }

  /** Enqueue the shorts-import pipeline root job (ai.md Section 3.2). */
  async enqueueAnalysis(importedVideoId: string, userId: string) {
    const video = await this.assertVideoOwnership(importedVideoId, userId);
    return this.jobs.enqueue(video.projectId, 'SHORTS_ANALYZE', { importedVideoId });
  }

  /** Aggregated pipeline status: latest job per stage + persisted output counts. */
  async analysisStatus(importedVideoId: string, userId: string) {
    const video = await this.assertVideoOwnership(importedVideoId, userId);

    const jobs = await this.prisma.agentJob.findMany({
      where: {
        projectId: video.projectId,
        type: { in: [...SHORTS_IMPORT_STAGES, 'SHORTS_ANALYZE'] },
        payload: { path: ['importedVideoId'], equals: importedVideoId },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, type: true, status: true, error: true, createdAt: true, completedAt: true },
    });
    const latestByType = new Map<string, (typeof jobs)[number]>();
    for (const j of jobs) if (!latestByType.has(j.type)) latestByType.set(j.type, j);

    const [transcriptSegments, scenes, topicSegments, highlights] = await Promise.all([
      this.prisma.transcriptSegment.count({ where: { importedVideoId } }),
      this.prisma.videoScene.count({ where: { importedVideoId } }),
      this.prisma.topicSegment.count({ where: { importedVideoId } }),
      this.prisma.highlight.count({ where: { topicSegment: { importedVideoId } } }),
    ]);

    const satisfiedBy: Record<(typeof SHORTS_IMPORT_STAGES)[number], boolean> = {
      VIDEO_IMPORT: !!video.sourceAssetId,
      TRANSCRIPT_ANALYSIS: transcriptSegments > 0,
      SCENE_DETECTION: scenes > 0,
      TOPIC_SEGMENTATION: topicSegments > 0,
      HIGHLIGHT_DETECTION: highlights > 0,
    };

    return {
      importedVideoId,
      transcriptStatus: video.transcriptStatus,
      sourceDownloaded: !!video.sourceAssetId,
      counts: { transcriptSegments, scenes, topicSegments, highlights },
      pipeline: latestByType.get('SHORTS_ANALYZE') ?? null,
      stages: SHORTS_IMPORT_STAGES.map((type) => ({
        type,
        job: latestByType.get(type) ?? null,
        satisfied: satisfiedBy[type],
      })),
    };
  }

  async getTranscriptSegments(importedVideoId: string, userId: string) {
    await this.assertVideoOwnership(importedVideoId, userId);
    return this.prisma.transcriptSegment.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
      select: { id: true, startMs: true, endMs: true, speakerId: true, text: true },
    });
  }

  async getScenes(importedVideoId: string, userId: string) {
    await this.assertVideoOwnership(importedVideoId, userId);
    return this.prisma.videoScene.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
    });
  }

  async getTopics(importedVideoId: string, userId: string) {
    await this.assertVideoOwnership(importedVideoId, userId);
    return this.prisma.topicSegment.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
      include: { highlight: { select: { id: true, finalScore: true } } },
    });
  }

  async getHighlights(importedVideoId: string, userId: string) {
    await this.assertVideoOwnership(importedVideoId, userId);
    return this.prisma.highlight.findMany({
      where: { topicSegment: { importedVideoId } },
      orderBy: { finalScore: 'desc' },
      include: { topicSegment: true },
    });
  }

  async assertHighlightOwnership(highlightId: string, userId: string) {
    const highlight = await this.prisma.highlight.findFirst({
      where: { id: highlightId, topicSegment: { importedVideo: { project: { userId } } } },
    });
    if (!highlight) throw new NotFoundException('Highlight not found');
    return highlight;
  }

  async assertClipOwnership(shortClipId: string, userId: string) {
    const clip = await this.prisma.shortClip.findFirst({
      where: { id: shortClipId, project: { userId } },
    });
    if (!clip) throw new NotFoundException('Clip not found');
    return clip;
  }

  async renderStatus(shortClipId: string) {
    const clip = await this.prisma.shortClip.findUnique({
      where: { id: shortClipId },
      select: {
        id: true,
        status: true,
        renderAsset: {
          select: { id: true, createdAt: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, sizeBytes: true, durationMs: true } } },
        },
      },
    });
    const renderJob = await this.prisma.shortsRenderJob.findFirst({
      where: { shortClipId },
      orderBy: { createdAt: 'desc' },
    });
    const version = clip?.renderAsset?.versions[0];
    return {
      clipStatus: clip?.status ?? null,
      renderJob,
      render: version
        ? { assetId: clip!.renderAsset!.id, versionId: version.id, sizeBytes: Number(version.sizeBytes), durationMs: version.durationMs }
        : null,
    };
  }

  async getClipsForVideo(importedVideoId: string, userId: string) {
    await this.assertVideoOwnership(importedVideoId, userId);
    return this.prisma.shortClip.findMany({
      where: { topicSegment: { importedVideoId } },
      orderBy: { createdAt: 'desc' },
      include: {
        topicSegment: { select: { id: true, title: true, highlight: { select: { id: true, titleSuggestion: true, finalScore: true } } } },
        timeline: { select: { id: true, durationMs: true, _count: { select: { captions: true } } } },
      },
    });
  }
}
