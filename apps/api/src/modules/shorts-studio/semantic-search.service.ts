import { Injectable, NotFoundException } from '@nestjs/common';
import { embedTexts } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async search(importedVideoId: string, query: string, limit = 10) {
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

    const { embeddings } = await embedTexts([query]);
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
}
