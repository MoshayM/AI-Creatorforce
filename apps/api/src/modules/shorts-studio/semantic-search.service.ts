import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { embedTexts } from '@cf/shared';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { newAccumulator, runWithAiContext } from '../../common/ai-usage.context';
import { WalletService, billingEnforced, creditsForCost } from '../wallet/wallet.service';

export interface RankedSegment<T> {
  item: T;
  score: number;
}

/**
 * Rank items by cosine similarity to the query vector. All vectors are
 * unit-normalized (embedTexts guarantees it), so cosine is a plain dot
 * product. Items whose stored vector has a different dimensionality (embedded
 * by an older model/config) are skipped rather than mis-scored.
 * Pure — exported for tests.
 */
export function rankBySimilarity<T>(
  query: number[],
  items: Array<{ item: T; vector: number[] }>,
  limit: number,
): RankedSegment<T>[] {
  const scored: RankedSegment<T>[] = [];
  for (const { item, vector } of items) {
    if (vector.length !== query.length || query.length === 0) continue;
    let dot = 0;
    for (let i = 0; i < query.length; i++) dot += query[i]! * vector[i]!;
    scored.push({ item, score: dot });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
}

/**
 * Natural-language search over one video's transcript (Ai-video edit.md §5
 * "Natural-Language Search", Search tab §22). One embedding call for the
 * query, then an in-process dot-product scan over the stored segment vectors.
 *
 * Deliberate deviation from the spec's pgvector: this deployment runs a
 * native Windows Postgres without the vector extension, and a single video
 * is a few thousand 768-dim vectors — an in-process scan is milliseconds.
 * Revisit pgvector if cross-library search at scale lands.
 */
@Injectable()
export class SemanticSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async search(importedVideoId: string, query: string, limit = 10, userId?: string) {
    const video = await this.prisma.importedVideo.findUnique({ where: { id: importedVideoId } });
    if (!video) throw new NotFoundException('Imported video not found');

    const segments = await this.prisma.transcriptSegment.findMany({
      where: { importedVideoId, embedding: { isEmpty: false } },
      orderBy: { startMs: 'asc' },
      select: { id: true, startMs: true, endMs: true, text: true, embedding: true },
    });
    const totalSegments = await this.prisma.transcriptSegment.count({ where: { importedVideoId } });
    if (segments.length === 0) {
      return { query, results: [], embeddedSegments: 0, totalSegments, needsEmbeddings: totalSegments > 0 };
    }

    // §5.3/§9.1 fail closed: a query embedding is a real (tiny) spend
    if (billingEnforced() && userId) {
      const { available } = await this.wallet.availableCredits(userId);
      if (available < 1) throw new BadRequestException('INSUFFICIENT_CREDITS');
    }

    // Query embeddings run outside any job — attribute them to the video here
    const accumulator = newAccumulator();
    const { embeddings } = await runWithAiContext({ importedVideoId, userId, accumulator }, () => embedTexts([query]));

    // Post-hoc debit (no hold — the call is sub-second); min 1 credit, and
    // never fail the search the user already paid the provider for
    if (billingEnforced() && userId && accumulator.costUsd > 0) {
      await this.wallet.debit(userId, {
        entryType: 'USAGE_DEBIT',
        amount: Math.max(1, creditsForCost(accumulator.costUsd)),
        referenceType: 'AI_REQUEST',
        referenceId: importedVideoId,
        idempotencyKey: `search:${randomUUID()}`,
        metadata: { kind: 'semantic-search', costUsd: accumulator.costUsd },
      }).catch(() => undefined);
    }
    const ranked = rankBySimilarity(
      embeddings[0]!,
      segments.map((s) => ({ item: s, vector: s.embedding })),
      limit,
    );

    // Chapter context: which chapter each hit lands in (zero extra AI calls)
    const chapters = await this.prisma.chapter.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
      select: { title: true, startMs: true, endMs: true },
    });

    return {
      query,
      results: ranked.map(({ item, score }) => ({
        segmentId: item.id,
        startMs: item.startMs,
        endMs: item.endMs,
        text: item.text,
        score: Number(score.toFixed(4)),
        chapter: chapters.find((c) => item.startMs >= c.startMs && item.startMs < c.endMs)?.title ?? null,
      })),
      embeddedSegments: segments.length,
      totalSegments,
      needsEmbeddings: false,
    };
  }

  /**
   * Cross-video NL search (Ai-video edit.md §11: "list all sermons that
   * mention grace") — one embedding call, then a dot-product scan over
   * every embedded segment in the user's library, results grouped per
   * video with each video's best moments. In-process scan is fine at this
   * deployment's scale (single user, thousands of segments — see the
   * pgvector deviation note in docs/video-hub.md).
   */
  async searchLibrary(userId: string, query: string, limitVideos = 5, limitPerVideo = 3) {
    if (billingEnforced()) {
      const { available } = await this.wallet.availableCredits(userId);
      if (available < 1) throw new BadRequestException('INSUFFICIENT_CREDITS');
    }

    const segments = await this.prisma.transcriptSegment.findMany({
      where: { embedding: { isEmpty: false }, importedVideo: { project: { userId } } },
      select: {
        id: true, startMs: true, endMs: true, text: true, embedding: true,
        importedVideo: { select: { id: true, title: true } },
      },
    });
    if (segments.length === 0) {
      return { query, videos: [], embeddedSegments: 0 };
    }

    const accumulator = newAccumulator();
    const { embeddings } = await runWithAiContext({ userId, accumulator }, () => embedTexts([query]));
    if (billingEnforced() && accumulator.costUsd > 0) {
      await this.wallet.debit(userId, {
        entryType: 'USAGE_DEBIT',
        amount: Math.max(1, creditsForCost(accumulator.costUsd)),
        referenceType: 'AI_REQUEST',
        idempotencyKey: `library-search:${randomUUID()}`,
        metadata: { kind: 'library-search', costUsd: accumulator.costUsd },
      }).catch(() => undefined);
    }

    const ranked = rankBySimilarity(
      embeddings[0]!,
      segments.map((s) => ({ item: s, vector: s.embedding })),
      limitVideos * limitPerVideo * 4,
    );

    // Group by video, keep each video's best hits, rank videos by top score
    const byVideo = new Map<string, { videoId: string; title: string; topScore: number; matches: Array<{ startMs: number; text: string; score: number }> }>();
    for (const { item, score } of ranked) {
      const v = byVideo.get(item.importedVideo.id) ?? {
        videoId: item.importedVideo.id,
        title: item.importedVideo.title,
        topScore: score,
        matches: [],
      };
      if (v.matches.length < limitPerVideo) {
        v.matches.push({ startMs: item.startMs, text: item.text, score: Number(score.toFixed(4)) });
      }
      byVideo.set(item.importedVideo.id, v);
    }
    const videos = [...byVideo.values()]
      .sort((a, b) => b.topScore - a.topScore)
      .slice(0, limitVideos)
      .map((v) => ({ ...v, topScore: Number(v.topScore.toFixed(4)) }));

    return { query, videos, embeddedSegments: segments.length };
  }
}
