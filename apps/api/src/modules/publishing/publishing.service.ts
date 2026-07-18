import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { createReadStream } from 'fs';
import type { youtube_v3 } from 'googleapis';
import type { Prisma, VideoStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../media/storage.service';

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
  /** Absolute path to a local video file. Use this OR r2Key, not both. */
  videoFilePath?: string;
  /** R2 object key for the video. StorageService.ensure() will download it locally before upload. */
  r2Key?: string;
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
    private readonly storage: StorageService,
  ) {}

  async publish(opts: PublishOptions, approvalId: string): Promise<string> {
    const approval = await this.prisma.approval.findFirst({
      where: { id: approvalId, status: 'APPROVED' },
    });
    if (!approval) {
      throw new ForbiddenException('Human approval required before publishing. Approval not found or not approved.');
    }

    // Resolve the video path: explicit file path takes precedence, then r2Key
    let resolvedPath = opts.videoFilePath;
    if (!resolvedPath && opts.r2Key) {
      const available = await this.storage.ensure(opts.r2Key);
      if (!available) {
        throw new BadRequestException(`Video asset not found in storage (r2Key: ${opts.r2Key})`);
      }
      resolvedPath = this.storage.resolve(opts.r2Key);
    }

    if (!resolvedPath) {
      throw new BadRequestException(
        'Provide videoFilePath or r2Key to publish. ' +
        'Run the render pipeline to produce an r2Key from the content pipeline.',
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
      media: { body: createReadStream(resolvedPath) },
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

  /**
   * Scheduler tracking list: videos that have entered the publish pipeline
   * (SCHEDULED / PUBLISHED / FAILED), scoped to the requesting user via
   * channel ownership. A video's effective date is publishedAt when set,
   * otherwise scheduledAt — the from/to range filters on that.
   */
  async listTracked(
    userId: string,
    opts: {
      channelId?: string;
      status?: VideoStatus[];
      from?: Date;
      to?: Date;
      q?: string;
      take?: number;
      skip?: number;
    },
  ) {
    const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
    const skip = Math.max(opts.skip ?? 0, 0);

    const dateRange: Prisma.DateTimeNullableFilter | undefined =
      opts.from || opts.to
        ? { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) }
        : undefined;

    const where: Prisma.VideoWhereInput = {
      channel: { userId },
      status: { in: opts.status?.length ? opts.status : ['SCHEDULED', 'PUBLISHED', 'FAILED'] },
      ...(opts.channelId ? { channelId: opts.channelId } : {}),
      ...(opts.q ? { title: { contains: opts.q, mode: 'insensitive' } } : {}),
      ...(dateRange
        ? {
            OR: [
              { publishedAt: dateRange },
              { publishedAt: null, scheduledAt: dateRange },
            ],
          }
        : {}),
    };

    const [total, data] = await this.prisma.$transaction([
      this.prisma.video.count({ where }),
      this.prisma.video.findMany({
        where,
        orderBy: [
          { publishedAt: { sort: 'desc', nulls: 'first' } },
          { scheduledAt: 'desc' },
          { updatedAt: 'desc' },
        ],
        take,
        skip,
        select: {
          id: true,
          title: true,
          status: true,
          youtubeVideoId: true,
          thumbnailUrl: true,
          scheduledAt: true,
          publishedAt: true,
          viewCount: true,
          likeCount: true,
          commentCount: true,
          createdAt: true,
          channel: { select: { id: true, title: true } },
          project: { select: { id: true, title: true } },
        },
      }),
    ]);

    return { data, total, take, skip };
  }

  /** Headline counts for the scheduler page, scoped like listTracked. */
  async trackingSummary(userId: string, channelId?: string) {
    const base: Prisma.VideoWhereInput = {
      channel: { userId },
      ...(channelId ? { channelId } : {}),
    };
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [scheduled, upcoming7d, published, publishedThisMonth, failed] =
      await this.prisma.$transaction([
        this.prisma.video.count({ where: { ...base, status: 'SCHEDULED' } }),
        this.prisma.video.count({
          where: {
            ...base,
            status: 'SCHEDULED',
            scheduledAt: { gte: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
          },
        }),
        this.prisma.video.count({ where: { ...base, status: 'PUBLISHED' } }),
        this.prisma.video.count({
          where: { ...base, status: 'PUBLISHED', publishedAt: { gte: monthStart } },
        }),
        this.prisma.video.count({ where: { ...base, status: 'FAILED' } }),
      ]);

    return { scheduled, upcoming7d, published, publishedThisMonth, failed };
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
