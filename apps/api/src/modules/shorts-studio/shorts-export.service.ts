import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ComplianceService } from '../compliance/compliance.service';
import { PublishingService } from '../publishing/publishing.service';
import { YouTubeReadService } from './youtube-read.service';
import { CLIP_TYPE_PRESETS } from './clip-type-presets';

interface ClipMetadata {
  title: string;
  description: string;
  tags: string[];
}

/**
 * SHORTS_EXPORT + SHORTS_PUBLISH (ai.md Sections 15, 18.6, 18.7, 24.4).
 *
 * Publish is double-gated, per claude.md golden rules:
 * 1. Human approval — an Approval row on the clip's export job must be
 *    APPROVED (the existing Approvals page is the review surface).
 * 2. Compliance — the clip's metadata + caption text pass ComplianceService
 *    .enforce() inside the publish job. No bypass path.
 */
@Injectable()
export class ShortsExportService {
  private readonly logger = new Logger(ShortsExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly approvals: ApprovalsService,
    private readonly compliance: ComplianceService,
    private readonly publishing: PublishingService,
    private readonly youtubeRead: YouTubeReadService,
  ) {}

  private async buildMetadata(shortClipId: string): Promise<ClipMetadata> {
    const clip = await this.prisma.shortClip.findUniqueOrThrow({
      where: { id: shortClipId },
      include: { topicSegment: { include: { highlight: true } }, chapter: true },
    });
    // Metadata follows provenance: highlight/topic for Shorts, chapter for Small Videos
    const h = clip.topicSegment?.highlight;
    const keywords = h?.keywords ?? clip.chapter?.keyPoints ?? [];
    const hashtags = keywords.slice(0, 5).map((k) => `#${k.replace(/\s+/g, '')}`).join(' ');
    return {
      title: (h?.titleSuggestion ?? clip.topicSegment?.title ?? clip.chapter?.title ?? 'Clip').slice(0, 100),
      description: [clip.topicSegment?.summary ?? clip.chapter?.summary ?? '', '', hashtags].join('\n').trim(),
      tags: keywords.slice(0, 15),
    };
  }

  /** SHORTS_EXPORT job: render + metadata + thumbnail ref → platform-ready package. */
  async exportClip(shortClipId: string, onLog?: (msg: string) => void) {
    const clip = await this.prisma.shortClip.findUnique({
      where: { id: shortClipId },
      include: {
        renderAsset: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } },
        thumbnails: { where: { isPrimary: true }, include: { asset: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } } },
        exports: { orderBy: { createdAt: 'desc' }, take: 1, include: { exportAsset: true } },
        timeline: { select: { updatedAt: true } },
      },
    });
    if (!clip) throw new NotFoundException('Clip not found');
    const renderVersion = clip.renderAsset?.versions[0];
    if (!renderVersion?.r2Key || !this.storage.exists(renderVersion.r2Key)) {
      throw new BadRequestException('Clip is not rendered yet — render it before exporting');
    }

    // Block when the timeline was edited after the last render — the render no longer
    // reflects the current edit state and must be regenerated first.
    if (clip.timeline && clip.renderAsset && clip.timeline.updatedAt > clip.renderAsset.createdAt) {
      throw new BadRequestException('Timeline has been edited since the last render — click "Re-render" to produce the updated video before exporting');
    }

    // Skip when the latest export already packages the current render
    const latest = clip.exports[0];
    if (latest && latest.exportAsset.createdAt > clip.renderAsset!.createdAt) {
      onLog?.('Export package is up to date — reusing');
      const latestVersion = await this.prisma.assetVersion.findFirst({
        where: { assetId: latest.exportAssetId },
        orderBy: { version: 'desc' },
        select: { id: true, durationMs: true },
      });
      const metadata = await this.buildMetadata(shortClipId);
      return {
        skipped: true,
        exportId: latest.id,
        exportAssetId: latest.exportAssetId,
        shortClipId,
        clipType: clip.clipType,
        exportVersionId: latestVersion?.id ?? null,
        durationMs: latestVersion?.durationMs ?? null,
        metadata,
      };
    }

    const metadata = await this.buildMetadata(shortClipId);
    const preset = CLIP_TYPE_PRESETS[clip.clipType];

    onLog?.('Building platform package…');
    const asset = await this.prisma.asset.create({
      data: {
        projectId: clip.projectId,
        kind: 'SHORTS_FINAL_EXPORT',
        label: `Export: ${metadata.title} (${clip.clipType})`,
        status: 'READY',
      },
    });
    const videoKey = `exports/shorts/${clip.projectId}/${asset.id}.mp4`;
    const metaKey = `exports/shorts/${clip.projectId}/${asset.id}.json`;
    const renderPath = this.storage.resolve(renderVersion.r2Key);
    const { sizeBytes } = await this.storage.copyIn(videoKey, renderPath);
    await this.storage.put(metaKey, Buffer.from(JSON.stringify({
      ...metadata,
      clipType: clip.clipType,
      maxDurationMs: preset.maxDurationMs,
      aspect: preset.aspect,
      primaryThumbnailVersionId: clip.thumbnails[0]?.asset.versions[0]?.id ?? null,
      exportedAt: new Date().toISOString(),
    }, null, 2)));

    const version = await this.prisma.assetVersion.create({
      data: {
        assetId: asset.id,
        version: 1,
        r2Key: videoKey,
        contentHash: renderVersion.contentHash,
        provider: 'shorts-export',
        sizeBytes: BigInt(sizeBytes),
        durationMs: renderVersion.durationMs,
        params: { metadataKey: metaKey } as never,
      },
    });
    await this.prisma.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id } });

    const history = await this.prisma.shortsExportHistory.create({
      data: { shortClipId, clipType: clip.clipType, exportAssetId: asset.id },
    });
    await this.prisma.shortClip.update({ where: { id: shortClipId }, data: { status: 'EXPORTED' } });
    onLog?.(`Export package ready — ${(sizeBytes / 1024 / 1024).toFixed(1)} MB + metadata`);
    // Everything the Approval Center needs to render a human review card
    return {
      skipped: false,
      exportId: history.id,
      exportAssetId: asset.id,
      shortClipId,
      clipType: clip.clipType,
      exportVersionId: version.id,
      durationMs: renderVersion.durationMs,
      metadata,
    };
  }

  async listExports(shortClipId: string) {
    return this.prisma.shortsExportHistory.findMany({
      where: { shortClipId },
      orderBy: { createdAt: 'desc' },
      include: { exportAsset: { include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, sizeBytes: true } } } } },
    });
  }

  /** Find the AgentJob that produced this clip's latest export (approval anchor). */
  private async latestExportJob(clip: { id: string; projectId: string }) {
    return this.prisma.agentJob.findFirst({
      where: {
        projectId: clip.projectId,
        type: 'SHORTS_EXPORT',
        status: 'COMPLETED',
        payload: { path: ['shortClipId'], equals: clip.id },
      },
      orderBy: { completedAt: 'desc' },
    });
  }

  /** Create the human-approval gate on the clip's export (ai.md 24.4). */
  async requestPublish(shortClipId: string) {
    const clip = await this.prisma.shortClip.findUniqueOrThrow({ where: { id: shortClipId } });
    const exportJob = await this.latestExportJob(clip);
    if (!exportJob) throw new BadRequestException('Export the clip before requesting publish approval');

    const approval = await this.approvals.createApproval(clip.projectId, exportJob.id);
    await this.prisma.shortClip.update({ where: { id: shortClipId }, data: { status: 'PENDING_APPROVAL' } });
    return { approvalId: approval.id, status: approval.status, expiresAt: approval.expiresAt };
  }

  async publishState(shortClipId: string) {
    const clip = await this.prisma.shortClip.findUniqueOrThrow({ where: { id: shortClipId } });
    const exportJob = await this.latestExportJob(clip);
    const approval = exportJob
      ? await this.prisma.approval.findUnique({ where: { jobId: exportJob.id } })
      : null;
    const publishJob = await this.prisma.agentJob.findFirst({
      where: {
        projectId: clip.projectId,
        type: 'SHORTS_PUBLISH',
        payload: { path: ['shortClipId'], equals: shortClipId },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, error: true, result: true },
    });
    return {
      clipStatus: clip.status,
      approval: approval ? { id: approval.id, status: approval.status, expiresAt: approval.expiresAt } : null,
      publishJob,
    };
  }

  /** Validate the approval before the publish job may even be enqueued. */
  async assertPublishable(shortClipId: string): Promise<{ approvalId: string; exportId: string }> {
    const clip = await this.prisma.shortClip.findUniqueOrThrow({ where: { id: shortClipId } });
    const exportJob = await this.latestExportJob(clip);
    if (!exportJob) throw new BadRequestException('Export the clip first');
    const approval = await this.prisma.approval.findUnique({ where: { jobId: exportJob.id } });
    if (approval?.status !== 'APPROVED') {
      throw new BadRequestException('Publishing requires an approved review — request approval and approve it on the Approvals page first');
    }
    const history = await this.prisma.shortsExportHistory.findFirst({
      where: { shortClipId },
      orderBy: { createdAt: 'desc' },
    });
    if (!history) throw new BadRequestException('No export package found');
    await this.prisma.shortClip.update({ where: { id: shortClipId }, data: { status: 'APPROVED' } });
    return { approvalId: approval.id, exportId: history.id };
  }

  /** SHORTS_PUBLISH job body: compliance gate → YouTube upload → history. */
  async publishClip(shortClipId: string, approvalId: string, exportId: string, onLog?: (msg: string) => void) {
    const clip = await this.prisma.shortClip.findUniqueOrThrow({
      where: { id: shortClipId },
      include: {
        project: { select: { id: true, channelId: true } },
        timeline: { include: { captions: { orderBy: { startMs: 'asc' } } } },
        topicSegment: { select: { importedVideoId: true } },
        chapter: { select: { importedVideoId: true } },
      },
    });
    const history = await this.prisma.shortsExportHistory.findUniqueOrThrow({
      where: { id: exportId },
      include: { exportAsset: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } },
    });
    const exportKey = history.exportAsset.versions[0]?.r2Key;
    if (!exportKey || !this.storage.exists(exportKey)) {
      throw new BadRequestException('Export package file is missing — re-run the export');
    }

    const metadata = await this.buildMetadata(shortClipId);

    // Compliance hard gate (claude.md rule 1) — caption text is the spoken content
    onLog?.('Running compliance audit on metadata + captions…');
    const script = clip.timeline?.captions.map((c) => c.text).join(' ') || metadata.description;
    await this.compliance.enforce({
      title: metadata.title,
      script,
      description: metadata.description,
      tags: metadata.tags,
    });
    onLog?.('Compliance passed ✓');

    // The existing publishing connector needs a Video row to track the upload
    const video = await this.prisma.video.create({
      data: {
        projectId: clip.project.id,
        channelId: clip.project.channelId,
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        status: 'APPROVED',
      },
    });

    // The Short keeps the SOURCE video's original audio language — YouTube
    // must not present a different audio language to viewers unless they
    // switch tracks manually. Unknown stays unset (no wrong guesses).
    const importedVideoId = clip.topicSegment?.importedVideoId ?? clip.chapter?.importedVideoId ?? null;
    const originalAudioLanguage = importedVideoId
      ? await this.resolveOriginalAudioLanguage(importedVideoId, clip.project.channelId, onLog)
      : null;

    // YouTube AI-disclosure policy (support.google.com/youtube/answer/14328491):
    // a Short cut from real footage with burned captions is a "minor edit" and
    // needs no label, but AI voiceover, generated music, or generated imagery
    // on the timeline is realistic synthetic media and must be disclosed.
    const syntheticItems = clip.timeline
      ? await this.prisma.shortsTimelineItem.count({
          where: {
            track: { timelineId: clip.timeline.id },
            sourceAsset: { kind: { in: ['VOICE', 'SHORTS_VOICE', 'MUSIC', 'SHORTS_MUSIC', 'IMAGE'] } },
          },
        })
      : 0;
    const containsSyntheticMedia = syntheticItems > 0;
    if (containsSyntheticMedia) {
      onLog?.('AI disclosure: timeline uses generated voice/music/imagery — setting the "Altered or synthetic content" label');
    }

    onLog?.('Uploading to YouTube…');
    const youtubeVideoId = await this.publishing.publish({
      videoId: video.id,
      channelId: clip.project.channelId,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      videoFilePath: this.storage.resolve(exportKey),
      ...(originalAudioLanguage ? { defaultAudioLanguage: originalAudioLanguage } : {}),
      containsSyntheticMedia,
    }, approvalId);

    await this.prisma.shortsExportHistory.update({
      where: { id: exportId },
      data: { publishedAt: new Date(), publishTargetId: clip.project.channelId },
    });
    await this.prisma.shortClip.update({ where: { id: shortClipId }, data: { status: 'PUBLISHED' } });
    onLog?.(`Published ✓ — https://youtube.com/shorts/${youtubeVideoId}`);
    return { youtubeVideoId, url: `https://youtube.com/shorts/${youtubeVideoId}` };
  }

  /**
   * Source video's original audio language: stored value first (captured at
   * import), then a live metadata read persisted for next time. Null when
   * YouTube doesn't report one — the upload then simply omits the field.
   */
  private async resolveOriginalAudioLanguage(
    importedVideoId: string,
    channelId: string,
    onLog?: (msg: string) => void,
  ): Promise<string | null> {
    const video = await this.prisma.importedVideo.findUnique({
      where: { id: importedVideoId },
      select: { originalAudioLanguage: true, youtubeVideoId: true },
    });
    if (!video) return null;
    if (video.originalAudioLanguage) return video.originalAudioLanguage;
    try {
      const meta = await this.youtubeRead.getVideoMetadata(channelId, video.youtubeVideoId);
      if (meta.defaultAudioLanguage) {
        await this.prisma.importedVideo.update({
          where: { id: importedVideoId },
          data: { originalAudioLanguage: meta.defaultAudioLanguage },
        });
        onLog?.(`Original audio language: ${meta.defaultAudioLanguage}`);
        return meta.defaultAudioLanguage;
      }
    } catch {
      // Metadata read is best-effort — publishing proceeds without the field.
    }
    return null;
  }
}
