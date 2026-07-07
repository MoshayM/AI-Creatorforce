import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { callAIStructured, ChapterDetectionOutputSchema, type ChapterCandidate } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseChapterBlock } from './chapter-sync.util';

const CHAPTER_SYSTEM = `You are an expert video editor creating YouTube-style chapters for a long-form video.

You are given the video's topic segments (already analyzed). Group them into chapters a viewer would use to navigate the video.

Rules:
- Chapters partition the WHOLE video: typically 3–12 chapters, each ideally 1–10 minutes; never shorter than 10 seconds.
- Each chapter's startMs MUST be the startMs of one of the provided topic segments — never invent timestamps.
- The first chapter starts at the first topic segment (the platform anchors it to 0:00).
- title: viewer-facing, max ~50 characters, no numbering, no timestamps.
- summary: 1–2 sentences on what this chapter covers.
- keyPoints: up to 5 short takeaway bullets (plain phrases, no numbering).
- confidence is 0–1: how clean this chapter boundary and grouping is.

Respond only with valid JSON.`;

/** YouTube's own minimum chapter duration. */
const MIN_CHAPTER_MS = 10_000;

export type NormalizedChapter = ChapterCandidate & { endMs: number };

/**
 * Turn raw model output into a valid contiguous chapter partition:
 * boundaries snapped to real topic starts, sorted, deduped, first anchored to
 * 0, sub-10s chapters merged into their neighbour (higher-confidence metadata
 * wins), endMs derived from the next boundary (last ends at durationMs).
 * Pure — exported for tests.
 */
export function normalizeChapters(
  candidates: ChapterCandidate[],
  topicStartsMs: number[],
  durationMs: number,
): NormalizedChapter[] {
  if (durationMs <= 0) return [];

  const snapped = candidates
    .map((c) => {
      const startMs = Math.max(0, Math.min(c.startMs, durationMs - 1));
      if (topicStartsMs.length === 0) return { ...c, startMs };
      const nearest = topicStartsMs.reduce((best, t) =>
        Math.abs(t - startMs) < Math.abs(best - startMs) ? t : best);
      return { ...c, startMs: Math.min(nearest, durationMs - 1) };
    })
    .sort((a, b) => a.startMs - b.startMs);

  // Merge same/near boundaries: within a MIN_CHAPTER_MS span only one chapter
  // survives — keep the earlier start, but the higher-confidence metadata.
  const merged: ChapterCandidate[] = [];
  for (const c of snapped) {
    const prev = merged[merged.length - 1];
    if (prev && c.startMs - prev.startMs < MIN_CHAPTER_MS) {
      if (c.confidence > prev.confidence) merged[merged.length - 1] = { ...c, startMs: prev.startMs };
    } else {
      merged.push(c);
    }
  }
  if (merged.length === 0) return [];

  // A chapter list that doesn't start at the beginning confuses navigation —
  // anchor the first chapter to 0 (YouTube requires a 0:00 chapter).
  merged[0] = { ...merged[0]!, startMs: 0 };

  // Tail too short to stand alone → fold into the previous chapter.
  while (merged.length > 1 && durationMs - merged[merged.length - 1]!.startMs < MIN_CHAPTER_MS) {
    merged.pop();
  }

  return merged.map((c, i) => ({
    ...c,
    endMs: i + 1 < merged.length ? merged[i + 1]!.startMs : durationMs,
  }));
}

/**
 * CHAPTER_DETECTION job (Ai-video edit.md §5, Phase 5). Consumes the stored
 * topic-segment analysis graph — never the raw transcript (§12 token rules) —
 * in a single batched call, and self-skips when chapters already exist
 * (pipeline resume semantics, ai.md 16.1).
 */
@Injectable()
export class ChapterDetectionService {
  private readonly logger = new Logger(ChapterDetectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureChapters(importedVideoId: string, onLog?: (msg: string) => void) {
    const video = await this.prisma.importedVideo.findUnique({ where: { id: importedVideoId } });
    if (!video) throw new NotFoundException('Imported video not found');

    const existing = await this.prisma.chapter.count({ where: { importedVideoId } });
    if (existing > 0) {
      onLog?.(`Chapters already detected (${existing}) — reusing`);
      return { skipped: true, chapters: existing };
    }

    // §11 deterministic-first: a description that already defines YouTube
    // chapters IS the chapter list — import it, zero tokens, no LLM.
    const described = parseChapterBlock(video.description);
    if (described.length > 0) {
      await this.prisma.chapter.createMany({
        data: described.map((c, i) => ({
          importedVideoId,
          startMs: c.startMs,
          endMs: i + 1 < described.length ? described[i + 1]!.startMs : video.durationMs,
          title: c.title,
          summary: c.title,
          confidence: 1,
          source: 'IMPORTED' as const,
        })),
      });
      onLog?.(`Imported ${described.length} chapters from the YouTube description — zero tokens`);
      return { skipped: false, chapters: described.length, imported: true };
    }

    const topics = await this.prisma.topicSegment.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
      select: { startMs: true, endMs: true, category: true, title: true, summary: true },
    });
    if (topics.length === 0) throw new Error('No topic segments — run TOPIC_SEGMENTATION first');

    onLog?.(`Detecting chapters from ${topics.length} topic segments…`);
    const listing = topics
      .map((t) => `[${t.startMs}] (${t.category}) ${t.title} — ${t.summary.slice(0, 160)}`)
      .join('\n');
    const result = await callAIStructured(
      [{
        role: 'user',
        content: [
          `Video: "${video.title}" (${Math.round(video.durationMs / 60000)} min, ${video.durationMs} ms total)`,
          '',
          'Topic segments (each line is "[startMs] (category) title — summary"):',
          listing,
          '',
          'Group these into YouTube-style chapters covering the whole video.',
          'Respond with JSON: {"chapters":[{"startMs":0,"title":"...","summary":"...","keyPoints":["..."],"confidence":0.9}]}',
        ].join('\n'),
      }],
      ChapterDetectionOutputSchema,
      { systemPrompt: CHAPTER_SYSTEM, maxTokens: 4096 },
    );

    const chapters = normalizeChapters(result.chapters, topics.map((t) => t.startMs), video.durationMs);
    if (chapters.length === 0) throw new Error('Chapter detection produced no usable chapters');

    await this.prisma.chapter.createMany({
      data: chapters.map((c) => ({
        importedVideoId,
        startMs: c.startMs,
        endMs: c.endMs,
        title: c.title,
        summary: c.summary,
        keyPoints: c.keyPoints,
        confidence: c.confidence,
      })),
    });

    onLog?.(`Chapter detection complete — ${chapters.length} chapters`);
    return { skipped: false, chapters: chapters.length };
  }
}
