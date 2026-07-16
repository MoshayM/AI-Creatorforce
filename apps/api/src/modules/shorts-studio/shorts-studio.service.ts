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
  'CHAPTER_DETECTION',
  // Last on purpose: a missing embeddings key must never block the stages above
  'EMBEDDING_GENERATION',
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

  /** Owner-only free-form reference notes on an imported video. */
  async updateNotes(importedVideoId: string, userId: string, notes: string | null) {
    await this.assertVideoOwnership(importedVideoId, userId);
    return this.prisma.importedVideo.update({
      where: { id: importedVideoId },
      data: { notes: notes && notes.trim().length > 0 ? notes : null },
    });
  }

  /**
   * Remove a video from Shorts Studio. Transcript segments, scenes, topics,
   * chapters and social content cascade at the DB level; the library entry
   * and any downloaded source asset are left untouched.
   */
  async deleteImportedVideo(importedVideoId: string, userId: string) {
    await this.assertVideoOwnership(importedVideoId, userId);
    await this.prisma.importedVideo.delete({ where: { id: importedVideoId } });
    return { deleted: true, importedVideoId };
  }

  /** Channel-first view: every import across the channel's projects. */
  async listImportedVideosByChannel(channelId: string) {
    return this.prisma.importedVideo.findMany({
      where: { project: { channelId } },
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

    const [transcriptSegments, scenes, topicSegments, highlights, chapters, embeddedSegments] = await Promise.all([
      this.prisma.transcriptSegment.count({ where: { importedVideoId } }),
      this.prisma.videoScene.count({ where: { importedVideoId } }),
      this.prisma.topicSegment.count({ where: { importedVideoId } }),
      this.prisma.highlight.count({ where: { topicSegment: { importedVideoId } } }),
      this.prisma.chapter.count({ where: { importedVideoId } }),
      this.prisma.transcriptSegment.count({ where: { importedVideoId, embedding: { isEmpty: false } } }),
    ]);

    const satisfiedBy: Record<(typeof SHORTS_IMPORT_STAGES)[number], boolean> = {
      VIDEO_IMPORT: !!video.sourceAssetId,
      TRANSCRIPT_ANALYSIS: transcriptSegments > 0,
      SCENE_DETECTION: scenes > 0,
      TOPIC_SEGMENTATION: topicSegments > 0,
      HIGHLIGHT_DETECTION: highlights > 0,
      CHAPTER_DETECTION: chapters > 0,
      EMBEDDING_GENERATION: transcriptSegments > 0 && embeddedSegments >= transcriptSegments,
    };

    return {
      importedVideoId,
      transcriptStatus: video.transcriptStatus,
      sourceDownloaded: !!video.sourceAssetId,
      counts: { transcriptSegments, scenes, topicSegments, highlights, chapters, embeddedSegments },
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

  async getChapters(importedVideoId: string, userId: string) {
    await this.assertVideoOwnership(importedVideoId, userId);
    return this.prisma.chapter.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
    });
  }

  /** Standalone CHAPTER_DETECTION run — for videos analyzed before chapters shipped. */
  async enqueueChapterDetection(importedVideoId: string, userId: string) {
    const video = await this.assertVideoOwnership(importedVideoId, userId);
    return this.jobs.enqueue(video.projectId, 'CHAPTER_DETECTION', { importedVideoId });
  }

  /** Standalone EMBEDDING_GENERATION run — for videos analyzed before search shipped. */
  async enqueueEmbeddingGeneration(importedVideoId: string, userId: string) {
    const video = await this.assertVideoOwnership(importedVideoId, userId);
    return this.jobs.enqueue(video.projectId, 'EMBEDDING_GENERATION', { importedVideoId });
  }

  /** Church AI pack (§11) — on demand only, never part of the default pipeline. */
  async enqueueChurchPack(importedVideoId: string, userId: string) {
    const video = await this.assertVideoOwnership(importedVideoId, userId);
    return this.jobs.enqueue(video.projectId, 'CHURCH_PACK_GENERATION', { importedVideoId });
  }

  /** Social content factory (§10) — on demand only. */
  async enqueueSocialContent(importedVideoId: string, userId: string) {
    const video = await this.assertVideoOwnership(importedVideoId, userId);
    return this.jobs.enqueue(video.projectId, 'SOCIAL_CONTENT_GENERATION', { importedVideoId });
  }

  /** Manual rename/edit (Ai-video edit.md §11) — flagged so re-detection keeps it. */
  async updateChapter(chapterId: string, userId: string, patch: { title?: string; summary?: string }) {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, importedVideo: { project: { userId } } },
    });
    if (!chapter) throw new NotFoundException('Chapter not found');
    return this.prisma.chapter.update({
      where: { id: chapterId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        editedByUser: true,
      },
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
      where: { OR: [{ topicSegment: { importedVideoId } }, { chapter: { importedVideoId } }] },
      orderBy: { createdAt: 'desc' },
      include: {
        topicSegment: { select: { id: true, title: true, highlight: { select: { id: true, titleSuggestion: true, finalScore: true } } } },
        chapter: { select: { id: true, title: true } },
        timeline: { select: { id: true, durationMs: true, _count: { select: { captions: true } } } },
      },
    });
  }
}
