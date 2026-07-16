import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { createReadStream } from 'fs';
import type { youtube_v3 } from 'googleapis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';

/**
 * YouTube A/S (Altered or Synthetic) disclosure — googleapis@144 typings
 * predate the field, but videos.insert/update accept it
 * (developers.google.com/youtube/v3/docs/videos → status.containsSyntheticMedia).
 */
type VideoStatusWithDisclosure = youtube_v3.Schema$VideoStatus & { containsSyntheticMedia?: boolean };

/**
 * Human-readable disclosure appended to the description when the platform
 * label is set — keeps the disclosure visible even where the label isn't
 * rendered (embeds, third-party clients). Policy:
 * support.google.com/youtube/answer/14328491
 */
const AI_DISCLOSURE_LABEL =
  'Altered or synthetic content: this video includes AI-generated media (voice, visuals, or music).';

export interface PublishOptions {
  videoId: string;
  channelId: string;
  title: string;
  description: string;
  tags: string[];
  categoryId?: string;
  scheduledAt?: Date;
  videoFilePath?: string;
  /**
   * BCP-47 audio language of the uploaded media — always the SOURCE video's
   * original language, never a translation. Left unset when unknown so
   * YouTube doesn't get told a wrong language; viewers only hear another
   * language if they switch audio tracks themselves.
   */
  defaultAudioLanguage?: string;
  /**
   * YouTube AI-disclosure policy (support.google.com/youtube/answer/14328491):
   * set when the upload contains realistic AI-generated or meaningfully
   * altered media (TTS narration, generated visuals/music). Sets the
   * platform "Altered or synthetic content" label AND appends a clear
   * disclosure line to the description.
   */
  containsSyntheticMedia?: boolean;
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
    const status: VideoStatusWithDisclosure = publishAt
      ? { privacyStatus: 'private', publishAt }
      : { privacyStatus: 'public' };
    if (opts.containsSyntheticMedia) status.containsSyntheticMedia = true;

    // Disclosure line in the description alongside the platform label —
    // skipped when the metadata already carries one.
    const description =
      opts.containsSyntheticMedia && !/altered or synthetic content/i.test(opts.description)
        ? `${opts.description}\n\n${AI_DISCLOSURE_LABEL}`.trim()
        : opts.description;

    const res = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: opts.title,
          description,
          tags: opts.tags,
          categoryId: opts.categoryId ?? '22',
          ...(opts.defaultAudioLanguage ? { defaultAudioLanguage: opts.defaultAudioLanguage } : {}),
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
        description,
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
