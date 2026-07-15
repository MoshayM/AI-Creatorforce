import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';
import { formatChapterBlock, upsertChapterBlock } from './chapter-sync.util';

/** Google API error body shape (GaxiosError.response.data.error). */
interface GoogleApiError {
  response?: { data?: { error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> } } };
  message?: string;
}

/**
 * Translate a googleapis rejection into an HttpException with the ACTUAL
 * reason (quotaExceeded, forbidden, invalid description, …) instead of the
 * opaque 500 the raw GaxiosError produced.
 */
function toYouTubeHttpError(err: unknown, action: string): Error {
  const g = err as GoogleApiError;
  const apiErr = g.response?.data?.error;
  const reason = apiErr?.errors?.[0]?.reason ?? '';
  const detail = apiErr?.errors?.[0]?.message ?? apiErr?.message ?? g.message ?? 'unknown error';
  if (`${detail} ${g.message ?? ''}`.includes('invalid_grant')) {
    return new ForbiddenException(
      'The YouTube connection for this channel has expired or was revoked. Reconnect the channel under Settings → YouTube channel access, then retry.',
    );
  }
  if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded' || apiErr?.code === 429) {
    return new BadGatewayException(`YouTube API quota exhausted while ${action} — try again after the daily quota resets.`);
  }
  if (apiErr?.code === 403 || reason === 'forbidden' || reason === 'insufficientPermissions') {
    return new ForbiddenException(`YouTube rejected ${action} (${reason || '403'}): ${detail}. Reconnect the channel with full access if this persists.`);
  }
  if (apiErr?.code === 400) {
    return new BadRequestException(`YouTube rejected ${action}: ${detail}`);
  }
  return new BadGatewayException(`YouTube error while ${action}: ${detail}`);
}

/**
 * YouTube chapter sync (Ai-video edit.md §11): publish the stored chapter
 * list into the source video's YouTube description as a "0:00 Title" block —
 * replacing the existing block when the description already has one. Local
 * ImportedVideo.description is updated to match, so a later re-detection
 * imports these same chapters back at zero tokens.
 */
@Injectable()
export class ChapterSyncService {
  private readonly logger = new Logger(ChapterSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
  ) {}

  async syncToYouTube(importedVideoId: string) {
    const video = await this.prisma.importedVideo.findUnique({
      where: { id: importedVideoId },
      include: { project: { select: { channelId: true } } },
    });
    if (!video) throw new NotFoundException('Imported video not found');

    const chapters = await this.prisma.chapter.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
      select: { startMs: true, title: true },
    });
    // YouTube ignores chapter lists with fewer than 3 entries
    if (chapters.length < 3) {
      throw new BadRequestException(`YouTube needs at least 3 chapters to render them — this video has ${chapters.length}`);
    }

    const { youtube } = await this.channels.buildAuthedYouTube(video.project.channelId);

    // videos.update replaces the whole snippet — fetch it so title/category/tags survive
    let snippet;
    try {
      const current = await youtube.videos.list({ part: ['snippet'], id: [video.youtubeVideoId] });
      snippet = current.data.items?.[0]?.snippet;
    } catch (err) {
      throw toYouTubeHttpError(err, 'reading the video');
    }
    if (!snippet) throw new NotFoundException('Video not found on YouTube — was it deleted?');

    const block = formatChapterBlock(chapters);
    const description = upsertChapterBlock(snippet.description ?? '', block);
    // videos.update rejects descriptions over 5000 bytes — fail with guidance
    // instead of letting YouTube return an inscrutable 400.
    if (Buffer.byteLength(description, 'utf8') > 5000) {
      throw new BadRequestException(
        `The description with chapters would be ${Buffer.byteLength(description, 'utf8')} bytes — YouTube's limit is 5000. Shorten the description or reduce chapter titles.`,
      );
    }

    try {
      await youtube.videos.update({
        part: ['snippet'],
        requestBody: {
          id: video.youtubeVideoId,
          snippet: {
            title: snippet.title,
            categoryId: snippet.categoryId,
            tags: snippet.tags,
            defaultLanguage: snippet.defaultLanguage ?? undefined,
            description,
          },
        },
      });
    } catch (err) {
      this.logger.warn(`[chapter-sync] videos.update failed for ${video.youtubeVideoId}: ${err instanceof Error ? err.message : String(err)}`);
      throw toYouTubeHttpError(err, 'updating the video description');
    }

    const syncedAt = new Date();
    await this.prisma.importedVideo.update({
      where: { id: importedVideoId },
      data: { description, chaptersSyncedAt: syncedAt },
    });

    this.logger.log(`[chapter-sync] ${chapters.length} chapters → youtube:${video.youtubeVideoId}`);
    return { youtubeVideoId: video.youtubeVideoId, chapters: chapters.length, syncedAt };
  }
}
