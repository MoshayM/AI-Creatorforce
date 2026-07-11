import { Injectable, Logger } from '@nestjs/common';
import { google, youtube_v3 } from 'googleapis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ChannelsService } from './channels.service';

// ── ISO duration helper (reuses the same logic as youtube-read.service) ────────

function parseIsoDurationMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    (parseInt(d ?? '0', 10) * 86_400 +
      parseInt(h ?? '0', 10) * 3_600 +
      parseInt(min ?? '0', 10) * 60 +
      parseFloat(s ?? '0')) *
    1_000
  );
}

/** Classify video vs Short: ≤ 183 000 ms ≈ 3 min heuristic upper bound for Shorts. */
function kindForDuration(durationMs: number): 'video' | 'short' {
  return durationMs <= 183_000 ? 'short' : 'video';
}

export interface SyncOpts {
  onProgress?: (msg: string) => void;
}

@Injectable()
export class ChannelSyncService {
  private readonly logger = new Logger(ChannelSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
  ) {}

  async runSync(channelId: string, opts: SyncOpts = {}): Promise<void> {
    const log = (msg: string) => {
      this.logger.log(`[Sync:${channelId}] ${msg}`);
      opts.onProgress?.(msg);
    };

    // ── Resolve channel + YouTube client ──────────────────────────────────────
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!ch) throw new Error(`Channel not found: ${channelId}`);

    // Use authenticated client if tokens exist, else fall back to API key
    // (same pattern as youtube-read.service.ts)
    let youtube: youtube_v3.Youtube;
    if (ch.encryptedTokens && !ch.readOnly) {
      const built = await this.channels.buildAuthedYouTube(channelId);
      youtube = built.youtube;
    } else {
      const apiKey = process.env['YOUTUBE_API_KEY'];
      if (!apiKey) throw new Error('Channel has no OAuth tokens and YOUTUBE_API_KEY is not set');
      youtube = google.youtube({ version: 'v3', auth: apiKey });
    }

    // ── Load or create ChannelSyncState ───────────────────────────────────────
    let state = await this.prisma.channelSyncState.findUnique({ where: { channelId } });
    const isResume = state && !['DONE', 'ERROR', 'IDLE'].includes(state.phase);

    if (!state) {
      state = await this.prisma.channelSyncState.create({
        data: { channelId, phase: 'VIDEOS', startedAt: new Date() },
      });
    } else if (!isResume) {
      // Fresh sync after DONE/ERROR/IDLE — reset cursors
      state = await this.prisma.channelSyncState.update({
        where: { channelId },
        data: {
          phase: 'VIDEOS',
          videosPageToken: null,
          playlistsPageToken: null,
          currentPlaylistId: null,
          playlistItemsPageToken: null,
          syncedVideos: 0,
          syncedPlaylists: 0,
          error: null,
          startedAt: new Date(),
          completedAt: null,
        },
      });
    } else {
      log(`Resuming from phase=${state.phase}`);
    }

    const startedAt = state.startedAt ?? new Date();

    try {
      // ── Phase VIDEOS ───────────────────────────────────────────────────────
      if (state.phase === 'VIDEOS') {
        log('Phase VIDEOS: syncing uploads playlist…');
        // Uploads playlist ID = channel ID with UC → UU prefix
        const uploadsPlaylistId = 'UU' + ch.youtubeChannelId.slice(2);
        let pageToken: string | undefined = state.videosPageToken ?? undefined;
        let totalSynced = state.syncedVideos;

        do {
          // Step 1: get playlist items page
          const piRes = await youtube.playlistItems.list({
            part: ['snippet'],
            playlistId: uploadsPlaylistId,
            maxResults: 50,
            ...(pageToken ? { pageToken } : {}),
          });

          const items = piRes.data.items ?? [];
          const videoIds = items
            .map((i) => i.snippet?.resourceId?.videoId)
            .filter((id): id is string => Boolean(id));

          if (videoIds.length > 0) {
            // Step 2: enrich with contentDetails + statistics
            const vRes = await youtube.videos.list({
              part: ['snippet', 'contentDetails', 'statistics'],
              id: videoIds,
              maxResults: 50,
            });

            const videos = vRes.data.items ?? [];
            for (const v of videos) {
              const durationMs = parseIsoDurationMs(v.contentDetails?.duration);
              const thumb = v.snippet?.thumbnails;
              const thumbnailUrl =
                thumb?.maxres?.url ?? thumb?.high?.url ?? thumb?.medium?.url ?? thumb?.default?.url ?? null;

              await this.prisma.libraryVideo.upsert({
                where: { channelId_youtubeVideoId: { channelId, youtubeVideoId: v.id! } },
                create: {
                  channelId,
                  youtubeVideoId: v.id!,
                  kind: kindForDuration(durationMs),
                  title: v.snippet?.title ?? 'Untitled',
                  description: v.snippet?.description ?? null,
                  thumbnailUrl,
                  durationMs,
                  publishedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : null,
                  viewCount: parseInt(v.statistics?.viewCount ?? '0', 10),
                  likeCount: parseInt(v.statistics?.likeCount ?? '0', 10),
                  commentCount: parseInt(v.statistics?.commentCount ?? '0', 10),
                  lastSeenAt: new Date(),
                },
                update: {
                  title: v.snippet?.title ?? 'Untitled',
                  description: v.snippet?.description ?? null,
                  thumbnailUrl,
                  durationMs,
                  kind: kindForDuration(durationMs),
                  viewCount: parseInt(v.statistics?.viewCount ?? '0', 10),
                  likeCount: parseInt(v.statistics?.likeCount ?? '0', 10),
                  commentCount: parseInt(v.statistics?.commentCount ?? '0', 10),
                  archived: false,
                  lastSeenAt: new Date(),
                },
              });
              totalSynced += 1;
            }
          }

          pageToken = piRes.data.nextPageToken ?? undefined;

          // Persist cursor after every page — resumable on crash/quota kill
          state = await this.prisma.channelSyncState.update({
            where: { channelId },
            data: {
              videosPageToken: pageToken ?? null,
              syncedVideos: totalSynced,
            },
          });

          log(`Videos: ${totalSynced} synced (pageToken=${pageToken ?? 'done'})`);
        } while (pageToken);

        // Advance to next phase
        state = await this.prisma.channelSyncState.update({
          where: { channelId },
          data: { phase: 'PLAYLISTS', videosPageToken: null },
        });
      }

      // ── Phase PLAYLISTS ───────────────────────────────────────────────────
      if (state.phase === 'PLAYLISTS') {
        log('Phase PLAYLISTS: syncing channel playlists…');
        let pageToken: string | undefined = state.playlistsPageToken ?? undefined;
        let totalPlaylists = state.syncedPlaylists;

        do {
          const plRes = await youtube.playlists.list({
            part: ['snippet', 'contentDetails'],
            mine: true,
            maxResults: 50,
            ...(pageToken ? { pageToken } : {}),
          });

          const playlists = plRes.data.items ?? [];
          for (const pl of playlists) {
            const thumb = pl.snippet?.thumbnails;
            const thumbnailUrl =
              thumb?.maxres?.url ?? thumb?.high?.url ?? thumb?.medium?.url ?? thumb?.default?.url ?? null;

            await this.prisma.libraryPlaylist.upsert({
              where: { channelId_youtubePlaylistId: { channelId, youtubePlaylistId: pl.id! } },
              create: {
                channelId,
                youtubePlaylistId: pl.id!,
                title: pl.snippet?.title ?? 'Untitled',
                description: pl.snippet?.description ?? null,
                thumbnailUrl,
                itemCount: pl.contentDetails?.itemCount ?? 0,
              },
              update: {
                title: pl.snippet?.title ?? 'Untitled',
                description: pl.snippet?.description ?? null,
                thumbnailUrl,
                itemCount: pl.contentDetails?.itemCount ?? 0,
              },
            });
            totalPlaylists += 1;
          }

          pageToken = plRes.data.nextPageToken ?? undefined;

          state = await this.prisma.channelSyncState.update({
            where: { channelId },
            data: {
              playlistsPageToken: pageToken ?? null,
              syncedPlaylists: totalPlaylists,
            },
          });

          log(`Playlists: ${totalPlaylists} synced`);
        } while (pageToken);

        state = await this.prisma.channelSyncState.update({
          where: { channelId },
          data: { phase: 'PLAYLIST_ITEMS', playlistsPageToken: null },
        });
      }

      // ── Phase PLAYLIST_ITEMS ──────────────────────────────────────────────
      if (state.phase === 'PLAYLIST_ITEMS') {
        log('Phase PLAYLIST_ITEMS: syncing playlist items…');

        // Get all playlists for this channel in a stable order
        const allPlaylists = await this.prisma.libraryPlaylist.findMany({
          where: { channelId },
          select: { id: true, youtubePlaylistId: true, title: true },
          orderBy: { id: 'asc' },
        });

        // Resume: skip playlists before currentPlaylistId
        let startIdx = 0;
        if (state.currentPlaylistId) {
          const idx = allPlaylists.findIndex((p) => p.id === state!.currentPlaylistId);
          startIdx = idx >= 0 ? idx : 0;
        }

        for (let i = startIdx; i < allPlaylists.length; i++) {
          const pl = allPlaylists[i]!;

          // Resume within the current playlist
          let pageToken: string | undefined =
            pl.id === state.currentPlaylistId ? (state.playlistItemsPageToken ?? undefined) : undefined;

          log(`Playlist items: "${pl.title}" (${i + 1}/${allPlaylists.length})`);

          do {
            // Typed params object: with the conditional spread, TS overload
            // resolution ties piRes's type back to pageToken (assigned from
            // piRes below) and reports a circular-inference error.
            const piParams: youtube_v3.Params$Resource$Playlistitems$List = {
              part: ['snippet'],
              playlistId: pl.youtubePlaylistId,
              maxResults: 50,
              pageToken,
            };
            const piRes = await youtube.playlistItems.list(piParams);

            const piItems = piRes.data.items ?? [];
            for (const item of piItems) {
              const ytVideoId = item.snippet?.resourceId?.videoId;
              const position: number = item.snippet?.position ?? 0;
              if (!ytVideoId) continue;

              // Only link videos that are already in our library (skip cross-channel vids)
              const libVideo = await this.prisma.libraryVideo.findUnique({
                where: { channelId_youtubeVideoId: { channelId, youtubeVideoId: ytVideoId } },
                select: { id: true },
              });
              if (!libVideo) continue;

              await this.prisma.libraryPlaylistItem.upsert({
                where: { playlistId_libraryVideoId: { playlistId: pl.id, libraryVideoId: libVideo.id } },
                create: { playlistId: pl.id, libraryVideoId: libVideo.id, position },
                update: { position },
              });
            }

            pageToken = piRes.data.nextPageToken ?? undefined;

            state = await this.prisma.channelSyncState.update({
              where: { channelId },
              data: {
                currentPlaylistId: pl.id,
                playlistItemsPageToken: pageToken ?? null,
              },
            });
          } while (pageToken);
        }

        state = await this.prisma.channelSyncState.update({
          where: { channelId },
          data: {
            phase: 'DONE',
            currentPlaylistId: null,
            playlistItemsPageToken: null,
            completedAt: new Date(),
          },
        });
      }

      // ── Mark archived videos (present in DB but not seen this sync) ────────
      if (state.phase === 'DONE') {
        const archived = await this.prisma.libraryVideo.updateMany({
          where: {
            channelId,
            archived: false,
            lastSeenAt: { lt: startedAt },
          },
          data: { archived: true },
        });
        if (archived.count > 0) {
          log(`Archived ${archived.count} video(s) no longer on YouTube`);
        }
        log('Sync complete');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Sync:${channelId}] Error: ${msg}`);
      // Persist ERROR state but LEAVE cursors intact for resume
      await this.prisma.channelSyncState.update({
        where: { channelId },
        data: { phase: 'ERROR', error: msg.slice(0, 1000) },
      });
      throw err;
    }
  }
}
