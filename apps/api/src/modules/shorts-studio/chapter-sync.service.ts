import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';
import { formatChapterBlock, upsertChapterBlock } from './chapter-sync.util';

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
    const current = await youtube.videos.list({ part: ['snippet'], id: [video.youtubeVideoId] });
    const snippet = current.data.items?.[0]?.snippet;
    if (!snippet) throw new NotFoundException('Video not found on YouTube — was it deleted?');

    const block = formatChapterBlock(chapters);
    const description = upsertChapterBlock(snippet.description ?? '', block);

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

    const syncedAt = new Date();
    await this.prisma.importedVideo.update({
      where: { id: importedVideoId },
      data: { description, chaptersSyncedAt: syncedAt },
    });

    this.logger.log(`[chapter-sync] ${chapters.length} chapters → youtube:${video.youtubeVideoId}`);
    return { youtubeVideoId: video.youtubeVideoId, chapters: chapters.length, syncedAt };
  }
}
