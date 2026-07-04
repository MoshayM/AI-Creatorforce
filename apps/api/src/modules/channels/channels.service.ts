import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenEncryptionService } from './token-encryption.service';

// ── URL parsing helpers ────────────────────────────────────────────────────────

interface ParsedYouTubeUrl {
  channelId?: string;   // UCxxxxxx format
  handle?: string;      // @handle format
  canonicalUrl: string; // normalised YouTube URL for oEmbed
}

function parseYouTubeChannelInput(input: string): ParsedYouTubeUrl {
  const s = input.trim().replace(/\/+$/, '');

  // Bare channel ID
  if (/^UC[\w-]{22}$/.test(s)) {
    return { channelId: s, canonicalUrl: `https://www.youtube.com/channel/${s}` };
  }
  // Bare @handle
  if (/^@[\w.-]+$/.test(s)) {
    return { handle: s, canonicalUrl: `https://www.youtube.com/${s}` };
  }
  // URL with /channel/UCxxxxxx
  const idMatch = s.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (idMatch) {
    return { channelId: idMatch[1]!, canonicalUrl: `https://www.youtube.com/channel/${idMatch[1]}` };
  }
  // URL with /@handle
  const handleMatch = s.match(/youtube\.com\/@([\w.-]+)/);
  if (handleMatch) {
    return { handle: `@${handleMatch[1]}`, canonicalUrl: `https://www.youtube.com/@${handleMatch[1]}` };
  }
  // URL with /c/... or /user/... (legacy)
  const legacyMatch = s.match(/youtube\.com\/(?:c|user)\/([\w.-]+)/);
  if (legacyMatch) {
    return { handle: legacyMatch[1]!, canonicalUrl: `https://www.youtube.com/c/${legacyMatch[1]}` };
  }
  throw new BadRequestException(
    'Could not recognise that YouTube URL. Use a channel URL like https://www.youtube.com/@channelname or a channel ID (UCxxxxxx).',
  );
}

interface YouTubeChannelData {
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  subscriberCount: number;
  videoCount: number;
}

interface YouTubeApiItem {
  id: string;
  snippet: {
    title: string;
    description?: string;
    customUrl?: string;
    thumbnails?: {
      maxres?: { url?: string };
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
  statistics: {
    subscriberCount?: string;
    videoCount?: string;
    hiddenSubscriberCount?: boolean;
  };
}

// Fetch full channel data from YouTube Data API v3 by channel ID or handle.
// forHandle must be sent WITHOUT the leading "@".
async function fetchChannelByApiKey(
  channelId: string | undefined,
  handle: string | undefined,
  apiKey: string,
): Promise<YouTubeChannelData | null> {
  const params = new URLSearchParams({
    part: 'snippet,statistics',
    key: apiKey,
    maxResults: '1',
  });

  if (channelId) {
    params.set('id', channelId);
  } else if (handle) {
    // YouTube API forHandle requires the handle without "@"
    params.set('forHandle', handle.replace(/^@/, ''));
  } else {
    return null;
  }

  const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`);
  if (!res.ok) {
    throw new BadRequestException(
      `YouTube Data API error (${res.status}): ${res.statusText}. Check your YOUTUBE_API_KEY.`,
    );
  }

  const json = await res.json() as { items?: YouTubeApiItem[] };
  const ch = json.items?.[0];
  if (!ch) return null;

  // Prefer highest-resolution thumbnail available
  const thumb = ch.snippet.thumbnails;
  const thumbnailUrl =
    thumb?.maxres?.url ?? thumb?.high?.url ?? thumb?.medium?.url ?? thumb?.default?.url ?? null;

  const customUrl = ch.snippet.customUrl
    ? (ch.snippet.customUrl.startsWith('@') ? ch.snippet.customUrl : `@${ch.snippet.customUrl}`)
    : null;

  return {
    youtubeChannelId: ch.id,
    title: ch.snippet.title,
    handle: customUrl ?? handle ?? null,
    thumbnailUrl,
    subscriberCount: ch.statistics.hiddenSubscriberCount
      ? 0
      : parseInt(ch.statistics.subscriberCount ?? '0', 10),
    videoCount: parseInt(ch.statistics.videoCount ?? '0', 10),
  };
}

// Resolve channel identity (ID + basic metadata) from the YouTube channel HTML page.
// Used as primary resolver when we only have a URL/handle and no direct channel ID.
async function resolveChannelViaPage(parsed: ParsedYouTubeUrl): Promise<{
  channelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
}> {
  const res = await fetch(parsed.canonicalUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) {
    if (res.status === 404) throw new BadRequestException('Channel not found. Check the URL or handle and try again.');
    throw new BadRequestException(`Could not reach YouTube (HTTP ${res.status}). Try again later.`);
  }

  const html = await res.text();

  // externalId is the most reliable source of the canonical channel ID
  const channelId =
    html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ??
    html.match(/link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1] ??
    parsed.channelId;

  if (!channelId) {
    throw new BadRequestException(
      'Could not identify the channel. Make sure the URL is correct and the channel is public.',
    );
  }

  const title =
    html.match(/<meta[^>]+og:title[^>]+content="([^"]+)"/)?.[1] ??
    html.match(/og:title" content="([^"]+)"/)?.[1] ??
    'Unknown Channel';

  const thumbnailUrl =
    html.match(/<meta[^>]+og:image[^>]+content="([^"]+)"/)?.[1] ??
    html.match(/og:image" content="([^"]+)"/)?.[1] ??
    null;

  return { channelId, title, handle: parsed.handle ?? null, thumbnailUrl };
}

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

// ── Channel access levels (user-selectable, self-service) ────────────────────
// The creator decides how much access to grant and can change it any time in
// Settings; every change goes back through Google's consent screen.

export type ChannelAccessLevel = 'READ_ONLY' | 'PUBLISH' | 'FULL';

export const SCOPE_READONLY = 'https://www.googleapis.com/auth/youtube.readonly';
export const SCOPE_UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
export const SCOPE_MANAGE = 'https://www.googleapis.com/auth/youtube.force-ssl';
export const SCOPE_ANALYTICS = 'https://www.googleapis.com/auth/yt-analytics.readonly';

// openid/profile/email identify the Google account
const IDENTITY_SCOPES = ['openid', 'email', 'profile'];

export const ACCESS_PRESETS: Record<ChannelAccessLevel, string[]> = {
  READ_ONLY: [SCOPE_READONLY],
  PUBLISH: [SCOPE_READONLY, SCOPE_UPLOAD],
  FULL: [SCOPE_READONLY, SCOPE_UPLOAD, SCOPE_MANAGE, SCOPE_ANALYTICS],
};

export function isAccessLevel(v: unknown): v is ChannelAccessLevel {
  return v === 'READ_ONLY' || v === 'PUBLISH' || v === 'FULL';
}

/** Effective access derived from what the user actually granted on Google's consent screen. */
export function accessLevelFromScopes(scopes: readonly string[]): ChannelAccessLevel | 'NONE' {
  if (scopes.includes(SCOPE_MANAGE)) return 'FULL';
  if (scopes.includes(SCOPE_UPLOAD)) return 'PUBLISH';
  if (scopes.includes(SCOPE_READONLY)) return 'READ_ONLY';
  return 'NONE';
}

@Injectable()
export class ChannelsService implements OnModuleInit {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly enc: TokenEncryptionService,
  ) {}

  onModuleInit() {
    const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter((k) => !process.env[k]);
    if (missing.length > 0) {
      this.logger.warn(
        `[OAuth] Missing config: ${missing.join(', ')} — YouTube OAuth will not work until these are set in .env`,
      );
    } else {
      this.logger.log(`[OAuth] Google OAuth credentials loaded OK`);
    }
  }

  getAuthUrl(redirectUri: string, userId: string, access: ChannelAccessLevel = 'PUBLISH'): string {
    this.logger.log(`[OAuth] Generating auth URL — userId=${userId} access=${access} redirectUri=${redirectUri}`);
    const oauth2 = this.buildOAuth2Client(redirectUri);
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [...IDENTITY_SCOPES, ...ACCESS_PRESETS[access]],
      state: Buffer.from(JSON.stringify({ u: userId, a: access })).toString('base64url'),
    });
    this.logger.log(`[OAuth] Auth URL generated`);
    return url;
  }

  async connectChannel(userId: string, code: string, redirectUri: string) {
    this.logger.log(`[OAuth] Callback received — userId=${userId}`);

    this.logger.log(`[OAuth] Exchanging authorization code for tokens`);
    const oauth2 = this.buildOAuth2Client(redirectUri);
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.access_token) {
      this.logger.error(`[OAuth] Token exchange failed — no access_token returned`);
      throw new BadRequestException('Failed to exchange authorization code');
    }
    if (!tokens.refresh_token) {
      this.logger.error(`[OAuth] Token exchange failed — no refresh_token returned`);
      throw new BadRequestException('Failed to obtain refresh token — please revoke app access in Google and try again');
    }
    this.logger.log(`[OAuth] Tokens received — has_refresh=${!!tokens.refresh_token} expires=${tokens.expiry_date}`);

    // The user controls what they grant on Google's consent screen (they may
    // untick boxes). We accept whatever was granted as long as the channel is
    // at least readable, and derive the effective access level from it —
    // features beyond that level explain what's missing at the point of use.
    const grantedScopes = (tokens.scope ?? '').split(' ').filter(Boolean);
    const effectiveAccess = accessLevelFromScopes(grantedScopes);
    if (effectiveAccess === 'NONE') {
      this.logger.error(`[OAuth] No YouTube scopes granted — got: ${grantedScopes.join(', ')}`);
      throw new BadRequestException('YouTube access was not granted. Please allow at least read access to your channel.');
    }
    this.logger.log(`[OAuth] Granted scopes → effective access: ${effectiveAccess}`);

    this.logger.log(`[OAuth] Fetching YouTube channel info`);
    oauth2.setCredentials(tokens);
    const yt = google.youtube({ version: 'v3', auth: oauth2 });
    const res = await yt.channels.list({ part: ['snippet', 'statistics'], mine: true });
    const ch = res.data.items?.[0];

    if (!ch?.id) {
      this.logger.error(`[OAuth] No YouTube channel found for userId=${userId}`);
      throw new BadRequestException('No YouTube channel found on this Google account');
    }
    this.logger.log(`[OAuth] Channel found — id=${ch.id} title="${ch.snippet?.title}" handle="${ch.snippet?.customUrl}"`);

    const now = new Date();
    const encryptedTokens = this.enc.encrypt(JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date ?? Date.now() + 3600_000,
    } satisfies OAuthTokens));

    this.logger.log(`[OAuth] Saving channel to database — youtubeChannelId=${ch.id}`);
    const saved = await this.prisma.channel.upsert({
      where: { youtubeChannelId: ch.id },
      create: {
        userId,
        youtubeChannelId: ch.id,
        title: ch.snippet?.title ?? 'Unknown',
        description: ch.snippet?.description,
        thumbnailUrl: ch.snippet?.thumbnails?.default?.url,
        customUrl: ch.snippet?.customUrl ?? null,
        subscriberCount: parseInt(ch.statistics?.subscriberCount ?? '0', 10),
        videoCount: parseInt(ch.statistics?.videoCount ?? '0', 10),
        encryptedTokens,
        tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        scopes: grantedScopes,
        lastSyncedAt: now,
      },
      update: {
        encryptedTokens,
        tokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        active: true,
        title: ch.snippet?.title ?? 'Unknown',
        thumbnailUrl: ch.snippet?.thumbnails?.default?.url,
        customUrl: ch.snippet?.customUrl ?? null,
        subscriberCount: parseInt(ch.statistics?.subscriberCount ?? '0', 10),
        videoCount: parseInt(ch.statistics?.videoCount ?? '0', 10),
        scopes: grantedScopes,
        lastSyncedAt: now,
      },
    });
    this.logger.log(`[OAuth] Connection successful — channelId=${saved.id}`);
    return saved;
  }

  async disconnectChannel(channelId: string, userId: string) {
    this.logger.log(`[OAuth] Disconnecting channel — channelId=${channelId} userId=${userId}`);
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch || ch.userId !== userId) throw new NotFoundException('Channel not found');

    // Revoke OAuth token if this is a full (non-read-only) channel
    if (!ch.readOnly && ch.encryptedTokens) {
      try {
        const tokens: OAuthTokens = JSON.parse(this.enc.decrypt(ch.encryptedTokens));
        const oauth2 = this.buildOAuth2Client('');
        await oauth2.revokeToken(tokens.access_token);
        this.logger.log(`[OAuth] Google token revoked for channelId=${channelId}`);
      } catch (err) {
        this.logger.warn(`[OAuth] Token revocation failed (non-fatal) — ${String(err)}`);
      }
    }

    await this.prisma.channel.update({ where: { id: channelId }, data: { active: false } });
    this.logger.log(`[OAuth] Channel disconnected — channelId=${channelId}`);
    return { success: true };
  }

  async removeChannel(channelId: string, userId: string) {
    this.logger.log(`[OAuth] Removing channel permanently — channelId=${channelId} userId=${userId}`);
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch || ch.userId !== userId) throw new NotFoundException('Channel not found');

    if (!ch.readOnly && ch.encryptedTokens) {
      try {
        const tokens: OAuthTokens = JSON.parse(this.enc.decrypt(ch.encryptedTokens));
        const oauth2 = this.buildOAuth2Client('');
        await oauth2.revokeToken(tokens.access_token);
        this.logger.log(`[OAuth] Google token revoked on remove — channelId=${channelId}`);
      } catch (err) {
        this.logger.warn(`[OAuth] Token revocation on remove failed (non-fatal) — ${String(err)}`);
      }
    }

    await this.prisma.channel.delete({ where: { id: channelId } });
    this.logger.log(`[OAuth] Channel permanently removed — channelId=${channelId}`);
    return { success: true };
  }

  async connectChannelByUrl(userId: string, channelUrl: string) {
    this.logger.log(`[URL] Connecting channel by URL — userId=${userId} url="${channelUrl}"`);

    const parsed = parseYouTubeChannelInput(channelUrl);
    const apiKey = process.env['YOUTUBE_API_KEY'];

    let data: YouTubeChannelData;

    // Stage 1 — if we already have a channel ID and an API key, go direct (fastest path)
    if (apiKey && parsed.channelId) {
      this.logger.log(`[URL] Stage 1: direct API lookup by channel ID`);
      const result = await fetchChannelByApiKey(parsed.channelId, undefined, apiKey);
      if (result) {
        data = result;
      } else {
        throw new BadRequestException('No YouTube channel found for that channel ID.');
      }
    }
    // Stage 2 — handle given, try API first (forHandle param, no @ prefix)
    else if (apiKey && parsed.handle) {
      this.logger.log(`[URL] Stage 2: API lookup by handle "${parsed.handle}"`);
      try {
        const result = await fetchChannelByApiKey(undefined, parsed.handle, apiKey);
        if (result) {
          data = result;
        } else {
          // forHandle returned empty — fall through to page scrape + enrichment
          this.logger.warn(`[URL] forHandle returned no results — resolving via page scrape`);
          const page = await resolveChannelViaPage(parsed);
          const enriched = await fetchChannelByApiKey(page.channelId, undefined, apiKey);
          data = enriched ?? { youtubeChannelId: page.channelId, title: page.title, handle: page.handle, thumbnailUrl: page.thumbnailUrl, subscriberCount: 0, videoCount: 0 };
        }
      } catch (apiErr) {
        const msg = apiErr instanceof Error ? apiErr.message : '';
        this.logger.warn(`[URL] API handle lookup failed (${msg}) — resolving via page scrape`);
        const page = await resolveChannelViaPage(parsed);
        try {
          const enriched = await fetchChannelByApiKey(page.channelId, undefined, apiKey);
          data = enriched ?? { youtubeChannelId: page.channelId, title: page.title, handle: page.handle, thumbnailUrl: page.thumbnailUrl, subscriberCount: 0, videoCount: 0 };
        } catch {
          data = { youtubeChannelId: page.channelId, title: page.title, handle: page.handle, thumbnailUrl: page.thumbnailUrl, subscriberCount: 0, videoCount: 0 };
        }
      }
    }
    // Stage 3 — no API key: resolve via page scrape only
    else {
      this.logger.log(`[URL] Stage 3: no API key — resolving via page scrape`);
      const page = await resolveChannelViaPage(parsed);
      data = { youtubeChannelId: page.channelId, title: page.title, handle: page.handle, thumbnailUrl: page.thumbnailUrl, subscriberCount: 0, videoCount: 0 };
    }

    this.logger.log(`[URL] Channel found — id="${data.youtubeChannelId}" title="${data.title}"`);

    const now = new Date();
    const saved = await this.prisma.channel.upsert({
      where: { youtubeChannelId: data.youtubeChannelId },
      create: {
        userId,
        youtubeChannelId: data.youtubeChannelId,
        title: data.title,
        thumbnailUrl: data.thumbnailUrl,
        customUrl: data.handle,
        subscriberCount: data.subscriberCount,
        videoCount: data.videoCount,
        readOnly: true,
        active: true,
        lastSyncedAt: now,
      },
      update: {
        title: data.title,
        thumbnailUrl: data.thumbnailUrl,
        customUrl: data.handle,
        subscriberCount: data.subscriberCount,
        videoCount: data.videoCount,
        active: true,
        lastSyncedAt: now,
      },
    });
    this.logger.log(`[URL] Read-only channel saved — channelId=${saved.id}`);
    return { ...saved, readOnly: true };
  }

  async listChannels(userId: string) {
    const rows = await this.prisma.channel.findMany({
      where: { userId },
      select: {
        id: true, youtubeChannelId: true, title: true, description: true,
        thumbnailUrl: true, customUrl: true, subscriberCount: true, videoCount: true,
        readOnly: true, active: true, lastSyncedAt: true, createdAt: true, scopes: true,
      },
    });
    // Expose the effective access level so the creator can see and manage
    // exactly what the app is allowed to do with their channel.
    return rows.map((ch) => ({
      ...ch,
      accessLevel: ch.readOnly ? 'READ_ONLY' : accessLevelFromScopes(ch.scopes ?? []),
    }));
  }

  async getStatus(userId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { userId, active: true },
      select: {
        id: true, youtubeChannelId: true, title: true, thumbnailUrl: true,
        customUrl: true, subscriberCount: true, lastSyncedAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!channel) {
      return { connected: false };
    }

    return {
      connected: true,
      channelId: channel.youtubeChannelId,
      channelName: channel.title,
      handle: channel.customUrl,
      thumbnail: channel.thumbnailUrl,
      subscriberCount: channel.subscriberCount,
      connectedAt: channel.createdAt,
      lastSyncAt: channel.lastSyncedAt,
    };
  }

  async getDecryptedTokens(channelId: string): Promise<OAuthTokens> {
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch) throw new NotFoundException('Channel not found');
    if (!ch.encryptedTokens) throw new BadRequestException('Channel is read-only and has no OAuth tokens');
    return JSON.parse(this.enc.decrypt(ch.encryptedTokens)) as OAuthTokens;
  }

  async refreshChannelToken(channelId: string, userId: string) {
    this.logger.log(`[OAuth] Refreshing token — channelId=${channelId} userId=${userId}`);
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch || ch.userId !== userId) throw new NotFoundException('Channel not found');
    if (ch.readOnly || !ch.encryptedTokens) throw new BadRequestException('This channel has no OAuth tokens to refresh');

    const tokens = await this.getDecryptedTokens(channelId);
    const redirectUri = `${process.env['API_URL'] ?? 'http://localhost:4007'}/api/v1/channels/oauth/callback`;
    const oauth2 = this.buildOAuth2Client(redirectUri);
    oauth2.setCredentials(tokens);

    const { credentials } = await oauth2.refreshAccessToken();
    const updated: OAuthTokens = {
      access_token: credentials.access_token!,
      refresh_token: credentials.refresh_token ?? tokens.refresh_token,
      expiry_date: credentials.expiry_date ?? (Date.now() + 3_600_000),
    };

    const enc = this.enc.encrypt(JSON.stringify(updated));
    const saved = await this.prisma.channel.update({
      where: { id: channelId },
      data: { encryptedTokens: enc, tokenExpiresAt: new Date(updated.expiry_date) },
    });
    this.logger.log(`[OAuth] Token refreshed — expiresAt=${saved.tokenExpiresAt}`);
    return { success: true, expiresAt: saved.tokenExpiresAt };
  }

  async buildAuthedYouTube(channelId: string) {
    this.logger.log(`[OAuth] Building authed YouTube client — channelId=${channelId}`);
    const tokens = await this.getDecryptedTokens(channelId);
    const ch = await this.prisma.channel.findUniqueOrThrow({ where: { id: channelId } });
    const redirectUri = `${process.env['API_URL'] ?? 'http://localhost:4007'}/api/v1/channels/oauth/callback`;
    const oauth2 = this.buildOAuth2Client(redirectUri);
    oauth2.setCredentials(tokens);

    oauth2.on('tokens', (newTokens) => {
      this.logger.log(`[OAuth] Token refreshed — channelId=${channelId}`);
      const merged = { ...tokens, ...newTokens };
      const enc = this.enc.encrypt(JSON.stringify(merged));
      void this.prisma.channel.update({
        where: { id: channelId },
        data: { encryptedTokens: enc, tokenExpiresAt: new Date(merged.expiry_date ?? Date.now() + 3600_000) },
      });
    });

    return { youtube: google.youtube({ version: 'v3', auth: oauth2 }), channel: ch };
  }

  async updateChannel(
    channelId: string,
    userId: string,
    data: { niche?: string; brandKit?: Record<string, unknown>; voiceProfile?: Record<string, unknown> },
  ) {
    const ch = await this.prisma.channel.findFirst({ where: { id: channelId, userId } });
    if (!ch) throw new NotFoundException('Channel not found');

    return this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(data.niche !== undefined ? { niche: data.niche } : {}),
        ...(data.brandKit !== undefined ? { brandKit: data.brandKit as never } : {}),
        ...(data.voiceProfile !== undefined ? { voiceProfile: data.voiceProfile as never } : {}),
      },
      select: { id: true, title: true, niche: true, brandKit: true, voiceProfile: true },
    });
  }

  private buildOAuth2Client(redirectUri: string) {
    return new google.auth.OAuth2(
      process.env['GOOGLE_CLIENT_ID'],
      process.env['GOOGLE_CLIENT_SECRET'],
      redirectUri || undefined,
    );
  }
}
