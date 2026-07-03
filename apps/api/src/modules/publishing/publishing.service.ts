import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';

export interface PublishOptions {
  videoId: string;
  channelId: string;
  title: string;
  description: string;
  tags: string[];
  categoryId?: string;
  scheduledAt?: Date;
  videoFilePath?: string;
}

@Injectable()
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
  ) {}

  async publish(opts: PublishOptions, approvalId: string): Promise<string> {
    const approval = await this.prisma.approval.findFirst({
      where: { id: approvalId, status: 'APPROVED' },
    });
    if (!approval) {
      throw new ForbiddenException('Human approval required before publishing. Approval not found or not approved.');
    }

    if (!opts.videoFilePath) {
      throw new BadRequestException(
        'videoFilePath is required for publishing. ' +
        'Create the video file externally and provide its path. ' +
        '(In-app video generation is a Phase 2 feature.)',
      );
    }

    const { youtube } = await this.channels.buildAuthedYouTube(opts.channelId);

    const publishAt = opts.scheduledAt?.toISOString();
    const status = publishAt
      ? { privacyStatus: 'private' as const, publishAt }
      : { privacyStatus: 'public' as const };

    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: opts.title,
          description: opts.description,
          tags: opts.tags,
          categoryId: opts.categoryId ?? '22',
        },
        status,
      },
      media: { body: createReadStream(opts.videoFilePath) },
    });

    const youtubeVideoId = res.data.id!;

    await this.prisma.video.update({
      where: { id: opts.videoId },
      data: {
        youtubeVideoId,
        status: opts.scheduledAt ? 'SCHEDULED' : 'PUBLISHED',
        publishedAt: opts.scheduledAt ? null : new Date(),
        scheduledAt: opts.scheduledAt,
      },
    });

    return youtubeVideoId;
  }

  async getVideoStats(channelId: string, youtubeVideoId: string) {
    const { youtube } = await this.channels.buildAuthedYouTube(channelId);
    const res = await youtube.videos.list({
      part: ['statistics'],
      id: [youtubeVideoId],
    });
    return res.data.items?.[0]?.statistics;
  }
}
