import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { google, type youtube_v3 } from 'googleapis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelsService, SCOPE_MANAGE } from '../channels/channels.service';

export interface YouTubeVideoMetadata {
  youtubeVideoId: string;
  title: string;
  description: string | null;
  durationMs: number;
  thumbnailUrl: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  channelId: string; // YouTube channel id (UC…)
  publishedAt: string | null;
}

export interface YouTubeVideoListPage {
  items: YouTubeVideoMetadata[];
  nextPageToken: string | null;
}

export interface TranscriptCueDTO {
  startMs: number;
  endMs: number;
  text: string;
}

/** ISO-8601 duration (PT1H2M3S) → milliseconds. */
export function parseIsoDurationMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    (parseInt(d ?? '0', 10) * 86_400 +
      parseInt(h ?? '0', 10) * 3_600 +
      parseInt(min ?? '0', 10) * 60 +
      parseFloat(s ?? '0')) * 1_000
  );
}

/** Parse SRT caption text into cues. Tolerates \r\n and missing indices. */
export function parseSrt(srt: string): TranscriptCueDTO[] {
  const cues: TranscriptCueDTO[] = [];
  const blocks = srt.replace(/\r/g, '').split(/\n\n+/);
  const ts = (t: string): number => {
    const m = t.match(/(\d+):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!m) return NaN;
    return (+m[1]! * 3600 + +m[2]! * 60 + +m[3]!) * 1000 + +m[4]!;
  };
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0);
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx === -1) continue;
    const [startRaw, endRaw] = lines[timeIdx]!.split('-->');
    const startMs = ts(startRaw ?? '');
    const endMs = ts(endRaw ?? '');
    const text = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && text) cues.push({ startMs, endMs, text });
  }
  return cues;
}

function toMetadata(v: youtube_v3.Schema$Video): YouTubeVideoMetadata {
  const thumb = v.snippet?.thumbnails;
  return {
    youtubeVideoId: v.id ?? '',
    title: v.snippet?.title ?? 'Untitled',
    description: v.snippet?.description ?? null,
    durationMs: parseIsoDurationMs(v.contentDetails?.duration),
    thumbnailUrl: thumb?.maxres?.url ?? thumb?.high?.url ?? thumb?.medium?.url ?? thumb?.default?.url ?? null,
    viewCount: v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null,
    likeCount: v.statistics?.likeCount != null ? Number(v.statistics.likeCount) : null,
    commentCount: v.statistics?.commentCount != null ? Number(v.statistics.commentCount) : null,
    channelId: v.snippet?.channelId ?? '',
    publishedAt: v.snippet?.publishedAt ?? null,
  };
}

/**
 * Read-only YouTube Data API v3 wrapper for Shorts Studio (ai.md Section 2).
 * Prefers the channel's OAuth tokens (needed for captions.download); falls
 * back to the public API key for metadata-only reads. Requests no write scopes.
 */
@Injectable()
export class YouTubeReadService {
  private readonly logger = new Logger(YouTubeReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
  ) {}

  /** channelId is our DB Channel.id. Returns an authed client when tokens exist, else API-key client. */
  private async getClient(channelId: string): Promise<{ youtube: youtube_v3.Youtube; authed: boolean; youtubeChannelId: string; scopes: string[] }> {
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch) throw new NotFoundException('Channel not found');
    if (ch.encryptedTokens && !ch.readOnly) {
      const { youtube } = await this.channels.buildAuthedYouTube(channelId);
      return { youtube, authed: true, youtubeChannelId: ch.youtubeChannelId, scopes: ch.scopes ?? [] };
    }
    const apiKey = process.env['YOUTUBE_API_KEY'];
    if (!apiKey) {
      throw new BadRequestException('Channel has no OAuth tokens and YOUTUBE_API_KEY is not configured');
    }
    return {
      youtube: google.youtube({ version: 'v3', auth: apiKey }),
      authed: false,
      youtubeChannelId: ch.youtubeChannelId,
      scopes: [],
    };
  }

  /** Page through the channel's uploads playlist (UC… → UU…), enriched with duration + stats. */
  async listChannelVideos(channelId: string, pageToken?: string): Promise<YouTubeVideoListPage> {
    const { youtube, youtubeChannelId } = await this.getClient(channelId);
    const uploadsPlaylistId = youtubeChannelId.replace(/^UC/, 'UU');

    const page = await youtube.playlistItems.list({
      part: ['contentDetails'],
      playlistId: uploadsPlaylistId,
      maxResults: 25,
      pageToken: pageToken || undefined,
    });
    const ids = (page.data.items ?? [])
      .map((i) => i.contentDetails?.videoId)
      .filter((id): id is string => !!id);
    if (ids.length === 0) return { items: [], nextPageToken: null };

    const details = await youtube.videos.list({ part: ['snippet', 'contentDetails', 'statistics'], id: ids });
    return {
      items: (details.data.items ?? []).map(toMetadata),
      nextPageToken: page.data.nextPageToken ?? null,
    };
  }

  async getVideoMetadata(channelId: string, youtubeVideoId: string): Promise<YouTubeVideoMetadata> {
    const { youtube } = await this.getClient(channelId);
    const res = await youtube.videos.list({ part: ['snippet', 'contentDetails', 'statistics'], id: [youtubeVideoId] });
    const v = res.data.items?.[0];
    if (!v) throw new NotFoundException(`YouTube video ${youtubeVideoId} not found`);
    return toMetadata(v);
  }

  async getStatistics(channelId: string, youtubeVideoId: string) {
    const meta = await this.getVideoMetadata(channelId, youtubeVideoId);
    return { viewCount: meta.viewCount, likeCount: meta.likeCount, commentCount: meta.commentCount };
  }

  /**
   * Download the video's own captions as cues. Returns null when no caption
   * track exists or the channel's grant doesn't include captions access —
   * TRANSCRIPT_ANALYSIS then falls back to ASR (ai.md Section 2.3/3).
   */
  async getTranscript(channelId: string, youtubeVideoId: string): Promise<TranscriptCueDTO[] | null> {
    const { youtube, authed, scopes } = await this.getClient(channelId);
    if (!authed || !scopes.includes(SCOPE_MANAGE)) {
      this.logger.log(`captions.download needs the force-ssl scope — channel ${channelId} lacks it, falling back to ASR`);
      return null;
    }
    try {
      const list = await youtube.captions.list({ part: ['snippet'], videoId: youtubeVideoId });
      const tracks = list.data.items ?? [];
      if (tracks.length === 0) return null;
      // Prefer a manually created track over ASR, and the video language over others
      const track =
        tracks.find((t) => t.snippet?.trackKind !== 'asr') ?? tracks[0]!;
      const res = await youtube.captions.download(
        { id: track.id ?? '', tfmt: 'srt' },
        { responseType: 'text' },
      );
      const srt = typeof res.data === 'string' ? res.data : String(res.data);
      const cues = parseSrt(srt);
      return cues.length > 0 ? cues : null;
    } catch (err) {
      this.logger.warn(`captions download failed for ${youtubeVideoId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
