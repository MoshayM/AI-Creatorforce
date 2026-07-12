import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Content-hash analysis cache (Ai-video edit.md §12): when a video's source
 * media is byte-identical to one already analyzed — same AssetVersion
 * `contentHash`, e.g. the same file re-imported into another project or
 * after a delete — the stored transcript / scene / topic rows are copied
 * instead of recomputed.  A cache hit skips Whisper ASR, the ffmpeg scene
 * pass, and every topic-segmentation AI window for that video.
 *
 * Scoped to the same user: identical input would produce identical output,
 * but keeping derived rows inside one tenant makes access control trivially
 * auditable.  Rows are copied (not shared) so the §16 resume rules and
 * cascade deletes keep working per video.
 */
@Injectable()
export class AnalysisCacheService {
  private readonly logger = new Logger(AnalysisCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Same-user imported videos whose source asset carries the same content
   * hash, most recently updated first.  Empty while this video's source has
   * not been downloaded yet — the hash only exists after VIDEO_IMPORT.
   */
  private async twins(importedVideoId: string): Promise<string[]> {
    const me = await this.prisma.importedVideo.findUnique({
      where: { id: importedVideoId },
      select: {
        sourceAssetId: true,
        project: { select: { userId: true } },
        sourceAsset: {
          select: { versions: { orderBy: { version: 'desc' }, take: 1, select: { contentHash: true } } },
        },
      },
    });
    const hash = me?.sourceAsset?.versions[0]?.contentHash;
    if (!me || !hash) return [];

    const sameContent = await this.prisma.assetVersion.findMany({
      where: { contentHash: hash, ...(me.sourceAssetId ? { assetId: { not: me.sourceAssetId } } : {}) },
      select: { assetId: true },
    });
    if (sameContent.length === 0) return [];

    const candidates = await this.prisma.importedVideo.findMany({
      where: {
        id: { not: importedVideoId },
        sourceAssetId: { in: sameContent.map((v) => v.assetId) },
        project: { userId: me.project.userId },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    return candidates.map((c) => c.id);
  }

  /**
   * Copy transcript segments (embeddings included — identical text embeds
   * identically) from a content-identical video.  Returns null on miss.
   */
  async copyTranscript(
    importedVideoId: string,
    onLog?: (msg: string) => void,
  ): Promise<{ segments: number; source: 'YOUTUBE_CAPTIONS' | 'ASR_GENERATED' } | null> {
    for (const twinId of await this.twins(importedVideoId)) {
      const twin = await this.prisma.importedVideo.findUnique({
        where: { id: twinId },
        select: { transcriptStatus: true },
      });
      const source = twin?.transcriptStatus;
      if (source !== 'YOUTUBE_CAPTIONS' && source !== 'ASR_GENERATED') continue;

      const rows = await this.prisma.transcriptSegment.findMany({
        where: { importedVideoId: twinId },
        orderBy: { startMs: 'asc' },
        select: { startMs: true, endMs: true, speakerId: true, text: true, embedding: true },
      });
      if (rows.length === 0) continue;

      await this.prisma.$transaction([
        this.prisma.transcriptSegment.createMany({
          data: rows.map((r) => ({ ...r, importedVideoId })),
        }),
        this.prisma.importedVideo.update({
          where: { id: importedVideoId },
          data: { transcriptStatus: source },
        }),
      ]);
      this.logger.log(`[analysis-cache] transcript hit: ${importedVideoId} <- ${twinId} (${rows.length} segments)`);
      onLog?.(`Transcript copied from an identical previously-analyzed video (${rows.length} segments) — no re-transcription`);
      return { segments: rows.length, source };
    }
    return null;
  }

  /** Copy scene rows from a content-identical video.  Returns null on miss. */
  async copyScenes(importedVideoId: string, onLog?: (msg: string) => void): Promise<{ scenes: number } | null> {
    for (const twinId of await this.twins(importedVideoId)) {
      const rows = await this.prisma.videoScene.findMany({
        where: { importedVideoId: twinId },
        orderBy: { startMs: 'asc' },
        select: { startMs: true, endMs: true, speakerId: true, emotionScores: true, sceneChangeConfidence: true },
      });
      if (rows.length === 0) continue;

      await this.prisma.videoScene.createMany({
        data: rows.map((r) => ({ ...r, emotionScores: r.emotionScores as never, importedVideoId })),
      });
      this.logger.log(`[analysis-cache] scenes hit: ${importedVideoId} <- ${twinId} (${rows.length} scenes)`);
      onLog?.(`Scenes copied from an identical previously-analyzed video (${rows.length}) — no ffmpeg pass`);
      return { scenes: rows.length };
    }
    return null;
  }

  /** Copy topic segments from a content-identical video.  Returns null on miss. */
  async copyTopics(importedVideoId: string, onLog?: (msg: string) => void): Promise<{ segments: number } | null> {
    for (const twinId of await this.twins(importedVideoId)) {
      const rows = await this.prisma.topicSegment.findMany({
        where: { importedVideoId: twinId },
        orderBy: { startMs: 'asc' },
        select: { startMs: true, endMs: true, category: true, title: true, summary: true, confidence: true },
      });
      if (rows.length === 0) continue;

      await this.prisma.topicSegment.createMany({
        data: rows.map((r) => ({ ...r, importedVideoId })),
      });
      this.logger.log(`[analysis-cache] topics hit: ${importedVideoId} <- ${twinId} (${rows.length} segments)`);
      onLog?.(`Topic segments copied from an identical previously-analyzed video (${rows.length}) — no AI windows`);
      return { segments: rows.length };
    }
    return null;
  }
}
