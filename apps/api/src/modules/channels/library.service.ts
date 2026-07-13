import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  encodeCursor as encodeDateIdCursor,
  decodeCursor as decodeDateIdCursor,
  type PageResult,
} from '../../common/pagination/cursor';

// ── Pure cursor helpers ───────────────────────────────────────────────────────

/**
 * Encode a keyset cursor for the 'recent' sort (publishedAt DESC, id DESC).
 * Delegates to the shared date+id cursor (common/pagination/cursor).
 */
export function encodeCursor(publishedAt: Date | null, id: string): string {
  return encodeDateIdCursor(publishedAt, id);
}

/**
 * Decode a cursor produced by encodeCursor.
 * Returns null on missing or malformed input — caller treats as first page.
 */
export function decodeCursor(cursor: string | undefined): { publishedAt: Date | null; id: string } | null {
  const decoded = decodeDateIdCursor(cursor);
  return decoded ? { publishedAt: decoded.date, id: decoded.id } : null;
}

/**
 * Encode a keyset cursor for title-sorted lists: base64url of `${title}|${id}`.
 */
export function encodeTitleCursor(title: string, id: string): string {
  return Buffer.from(`${title}|${id}`).toString('base64url');
}

/**
 * Decode a title cursor. Splits on the LAST pipe — titles may contain '|',
 * cuids never do. Returns null on missing/malformed input (→ first page).
 */
export function decodeTitleCursor(cursor: string | undefined): { title: string; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const pipeIdx = raw.lastIndexOf('|');
    if (pipeIdx === -1) return null;
    const id = raw.slice(pipeIdx + 1);
    if (!id) return null;
    return { title: raw.slice(0, pipeIdx), id };
  } catch {
    return null;
  }
}

/**
 * Classify a video as 'short' or 'video' based on duration.
 * YouTube Shorts are ≤ 60 s officially, but the upload UI allows up to ~180 s.
 * We use 183 000 ms (≈ 3 min) as the heuristic upper bound — anything at or
 * below that threshold is treated as a Short.
 */
export function kindForDuration(durationMs: number): 'video' | 'short' {
  return durationMs <= 183_000 ? 'short' : 'video';
}

/**
 * Parse an ISO 8601 duration string (YouTube contentDetails.duration format)
 * into milliseconds. Handles PT#H#M#S with any subset of H/M/S.
 * Returns 0 for null/undefined/unrecognised strings.
 */
export function parseIsoDuration(iso: string): number {
  // Pattern: P[nD]T[nH][nM][nS] — we only care about the time part
  const m = iso.match(/^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  const [, h, min, s] = m;
  return (
    (parseInt(h ?? '0', 10) * 3_600 +
      parseInt(min ?? '0', 10) * 60 +
      parseFloat(s ?? '0')) *
    1_000
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ListVideosOpts {
  cursor?: string;
  q?: string;
  type?: 'video' | 'short';
  sort?: 'recent' | 'title';
  take?: number;
}

export type { PageResult };

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class LibraryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cursor-paginated list of library videos for a channel.
   * Default sort: recent (publishedAt DESC, id DESC).
   * q: case-insensitive contains on title.
   * Excludes archived rows by default.
   */
  async listVideos(channelId: string, opts: ListVideosOpts = {}): Promise<PageResult<unknown>> {
    const take = Math.min(opts.take ?? 50, 100);
    const sort = opts.sort ?? 'recent';

    // @reason: Prisma OR filter requires a typed 'where' that varies by cursor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cursorWhere: any = {};
    if (sort === 'recent') {
      // recent cursor: base64url("iso|id"); decodeCursor validates the date part.
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        cursorWhere = decoded.publishedAt
          ? {
              OR: [
                { publishedAt: { lt: decoded.publishedAt } },
                { publishedAt: decoded.publishedAt, id: { lt: decoded.id } },
              ],
            }
          : { publishedAt: null, id: { lt: decoded.id } };
      }
    } else if (opts.cursor) {
      // title cursor: base64url("title|id") — the title segment is arbitrary text,
      // so it must NOT go through decodeCursor (date validation would reject it).
      const decoded = decodeTitleCursor(opts.cursor);
      if (decoded) {
        cursorWhere = {
          OR: [
            { title: { gt: decoded.title } },
            { title: decoded.title, id: { gt: decoded.id } },
          ],
        };
      }
    }

    // @reason: dynamic where shape built from user options
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      channelId,
      archived: false,
      ...cursorWhere,
      ...(opts.q ? { title: { contains: opts.q, mode: 'insensitive' } } : {}),
      ...(opts.type ? { kind: opts.type } : {}),
    };

    const orderBy =
      sort === 'recent'
        ? [{ publishedAt: 'desc' as const }, { id: 'desc' as const }]
        : [{ title: 'asc' as const }, { id: 'asc' as const }];

    const rows = await this.prisma.libraryVideo.findMany({
      where,
      orderBy,
      take: take + 1,
      select: {
        id: true,
        youtubeVideoId: true,
        kind: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        durationMs: true,
        publishedAt: true,
        viewCount: true,
        likeCount: true,
        commentCount: true,
        archived: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > take;
    const data = hasMore ? rows.slice(0, take) : rows;
    let nextCursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1]!;
      if (sort === 'recent') {
        nextCursor = encodeCursor(last.publishedAt ?? null, last.id);
      } else {
        nextCursor = encodeTitleCursor(last.title, last.id);
      }
    }

    return { data, nextCursor };
  }

  /**
   * Cursor-paginated list of playlists for a channel (title ASC, id ASC).
   */
  async listPlaylists(channelId: string, cursor?: string): Promise<PageResult<unknown>> {
    const take = 50;
    // @reason: dynamic where varies on cursor presence
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cursorWhere: any = {};
    const decoded = decodeTitleCursor(cursor);
    if (decoded) {
      cursorWhere = {
        OR: [
          { title: { gt: decoded.title } },
          { title: decoded.title, id: { gt: decoded.id } },
        ],
      };
    }

    const rows = await this.prisma.libraryPlaylist.findMany({
      where: { channelId, ...cursorWhere },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
      take: take + 1,
      select: {
        id: true,
        youtubePlaylistId: true,
        title: true,
        description: true,
        thumbnailUrl: true,
        itemCount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const hasMore = rows.length > take;
    const data = hasMore ? rows.slice(0, take) : rows;
    let nextCursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1]!;
      nextCursor = encodeTitleCursor(last.title, last.id);
    }
    return { data, nextCursor };
  }

  /**
   * Cursor-paginated items within a playlist (position ASC).
   * Verifies the playlist belongs to the channel (404 if not).
   */
  async listPlaylistItems(channelId: string, playlistId: string, cursor?: string): Promise<PageResult<unknown>> {
    const playlist = await this.prisma.libraryPlaylist.findFirst({
      where: { id: playlistId, channelId },
      select: { id: true },
    });
    if (!playlist) throw new NotFoundException('Playlist not found');

    const take = 50;
    const afterPosition = cursor ? parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10) : -1;

    const rows = await this.prisma.libraryPlaylistItem.findMany({
      where: {
        playlistId,
        position: afterPosition >= 0 ? { gt: afterPosition } : undefined,
      },
      orderBy: { position: 'asc' },
      take: take + 1,
      select: {
        id: true,
        position: true,
        video: {
          select: {
            id: true,
            youtubeVideoId: true,
            kind: true,
            title: true,
            thumbnailUrl: true,
            durationMs: true,
            publishedAt: true,
            viewCount: true,
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const data = hasMore ? rows.slice(0, take) : rows;
    let nextCursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1]!;
      nextCursor = Buffer.from(String(last.position)).toString('base64url');
    }
    return { data, nextCursor };
  }

  /**
   * Reorder playlist items. The supplied itemIds array sets the new positions
   * (0-based index = position). Items not listed keep their relative order after
   * the listed items (positions compacted). Last-writer-wins.
   */
  async reorderPlaylist(channelId: string, playlistId: string, itemIds: string[]): Promise<void> {
    const playlist = await this.prisma.libraryPlaylist.findFirst({
      where: { id: playlistId, channelId },
      select: { id: true },
    });
    if (!playlist) throw new NotFoundException('Playlist not found');

    await this.prisma.$transaction(
      itemIds.map((itemId, index) =>
        this.prisma.libraryPlaylistItem.updateMany({
          where: { id: itemId, playlistId },
          data: { position: index },
        }),
      ),
    );
  }

  /**
   * Return the ChannelSyncState for a channel, or a synthetic IDLE shape when
   * no state row exists yet.
   */
  async syncStatus(channelId: string): Promise<unknown> {
    const state = await this.prisma.channelSyncState.findUnique({
      where: { channelId },
    });
    return state ?? { phase: 'IDLE' };
  }
}
