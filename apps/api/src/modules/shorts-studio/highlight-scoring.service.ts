import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { callAIStructured, HighlightScoringOutputSchema, HIGHLIGHT_DIMENSIONS } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

const SCORING_SYSTEM = `You are a short-form video strategist scoring topic segments for their potential as vertical Shorts (YouTube Shorts / Reels / TikTok).

Score every segment on ALL nine dimensions, 0–100 each:
virality, emotion, retention, hookStrength, education, entertainment, confidence, trendPotential, shortSuitability

Also provide for each segment:
- reason: 1–2 sentences explaining the scores, written for the creator.
- titleSuggestion: a punchy short-form title (max 80 chars, no clickbait lies).
- keywords: up to 10 search/SEO keywords drawn from the content.

Be discriminating — use the full 0–100 range; do not cluster everything at 70–80.
Respond only with valid JSON.`;

/** Segments scored per LLM call — bounds prompt size and enables per-batch resume. */
const BATCH_SIZE = 8;

/**
 * HIGHLIGHT_DETECTION job (ai.md Section 5). Exactly one Highlight per
 * TopicSegment; already-scored segments are never re-scored (per-segment
 * resume, 16.6). finalScore is the equal-weighted mean of the 9 dimensions
 * (per-project weight overrides are a future extension).
 */
@Injectable()
export class HighlightScoringService {
  private readonly logger = new Logger(HighlightScoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureHighlights(importedVideoId: string, onLog?: (msg: string) => void) {
    const video = await this.prisma.importedVideo.findUnique({ where: { id: importedVideoId } });
    if (!video) throw new NotFoundException('Imported video not found');

    const unscored = await this.prisma.topicSegment.findMany({
      where: { importedVideoId, highlight: null },
      orderBy: { startMs: 'asc' },
      select: { id: true, startMs: true, endMs: true, category: true, title: true, summary: true },
    });
    if (unscored.length === 0) {
      const count = await this.prisma.highlight.count({ where: { topicSegment: { importedVideoId } } });
      if (count === 0) throw new Error('No topic segments — run TOPIC_SEGMENTATION first');
      onLog?.(`Highlights already scored (${count}) — reusing`);
      return { skipped: true, highlights: count };
    }

    let scoredCount = 0;
    for (let offset = 0; offset < unscored.length; offset += BATCH_SIZE) {
      const batch = unscored.slice(offset, offset + BATCH_SIZE);
      onLog?.(`Scoring highlights ${offset + 1}–${offset + batch.length}/${unscored.length}…`);

      const listing = batch
        .map((s, i) =>
          `#${i} [${Math.round(s.startMs / 1000)}s–${Math.round(s.endMs / 1000)}s] (${s.category}) ${s.title}\n${s.summary}`)
        .join('\n\n');

      const result = await callAIStructured(
        [{
          role: 'user',
          content: [
            `Video: "${video.title}" (${Math.round(video.durationMs / 60000)} min)`,
            '',
            'Topic segments to score (segmentIndex = the # number):',
            listing,
            '',
            'Respond with JSON: {"scores":[{"segmentIndex":0,"virality":0,"emotion":0,"retention":0,"hookStrength":0,"education":0,"entertainment":0,"confidence":0,"trendPotential":0,"shortSuitability":0,"reason":"...","titleSuggestion":"...","keywords":["..."]}]}',
            'Include every segmentIndex exactly once.',
          ].join('\n'),
        }],
        HighlightScoringOutputSchema,
        { systemPrompt: SCORING_SYSTEM, maxTokens: 4096 },
      );

      for (const score of result.scores) {
        const segment = batch[score.segmentIndex];
        if (!segment) {
          this.logger.warn(`Model returned out-of-range segmentIndex ${score.segmentIndex} — skipping`);
          continue;
        }
        const finalScore =
          HIGHLIGHT_DIMENSIONS.reduce((sum, d) => sum + score[d], 0) / HIGHLIGHT_DIMENSIONS.length;
        // Idempotent per segment: a crashed batch that half-persisted re-runs cleanly
        await this.prisma.highlight.upsert({
          where: { topicSegmentId: segment.id },
          create: {
            topicSegmentId: segment.id,
            virality: score.virality,
            emotion: score.emotion,
            retention: score.retention,
            hookStrength: score.hookStrength,
            education: score.education,
            entertainment: score.entertainment,
            confidence: score.confidence,
            trendPotential: score.trendPotential,
            shortSuitability: score.shortSuitability,
            finalScore,
            reason: score.reason,
            titleSuggestion: score.titleSuggestion,
            keywords: score.keywords,
          },
          update: {},
        });
        scoredCount++;
      }
    }

    const total = await this.prisma.highlight.count({ where: { topicSegment: { importedVideoId } } });
    onLog?.(`Highlight scoring complete — ${total} highlights (${scoredCount} new)`);
    return { skipped: false, highlights: total };
  }
}
