import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { callAIStructured, TopicSegmentationOutputSchema, type TopicSegmentCandidate } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

const TOPIC_SYSTEM = `You are an expert video editor segmenting a long-form video transcript into self-contained topics for short-form clips.

Rules:
- Boundaries follow SEMANTIC DISCOURSE STRUCTURE: where one self-contained idea ends and another begins. NEVER slice at fixed time intervals.
- Use the provided scene changes and speaker changes only as supporting evidence, not as the splitting mechanism.
- Each segment must stand alone: a viewer with no other context should understand it.
- Prefer segments 15–90 seconds long; ignore filler/dead air between topics.
- category must be one of exactly:
  QUESTION_ANSWERED | STORY | TUTORIAL_STEP | FUNNY_MOMENT | IMPORTANT_STATEMENT | HOOK | PROBLEM | SOLUTION | STATISTIC | TIP | MISTAKE | WARNING | QUOTE | OPINION | LESSON | SUCCESS_STORY | FAILURE | CALL_TO_ACTION
- startMs/endMs must come from the transcript timestamps you were given (milliseconds).
- confidence is 0–1: how certain you are this is a clean, self-contained topic.

Respond only with valid JSON.`;

/** ~2,000-token windows with ~200-token overlap (ai.md 4.3), estimated at 4 chars/token. */
const WINDOW_CHARS = 8_000;
const OVERLAP_CHARS = 800;

interface TranscriptRow {
  startMs: number;
  endMs: number;
  speakerId: string | null;
  text: string;
}

interface Window {
  startMs: number;
  endMs: number;
  rows: TranscriptRow[];
}

function buildWindows(rows: TranscriptRow[]): Window[] {
  const windows: Window[] = [];
  let current: TranscriptRow[] = [];
  let chars = 0;
  for (let i = 0; i < rows.length; i++) {
    current.push(rows[i]!);
    chars += rows[i]!.text.length;
    if (chars >= WINDOW_CHARS) {
      windows.push({ startMs: current[0]!.startMs, endMs: current[current.length - 1]!.endMs, rows: current });
      // Walk back rows totalling ~OVERLAP_CHARS to seed the next window
      let overlap = 0;
      let j = current.length - 1;
      while (j > 0 && overlap < OVERLAP_CHARS) {
        overlap += current[j]!.text.length;
        j--;
      }
      current = current.slice(j + 1);
      chars = current.reduce((n, r) => n + r.text.length, 0);
    }
  }
  if (current.length > 0) {
    windows.push({ startMs: current[0]!.startMs, endMs: current[current.length - 1]!.endMs, rows: current });
  }
  return windows;
}

/**
 * TOPIC_SEGMENTATION job (ai.md Section 4). Windows are processed in order and
 * each window's merged segments are persisted immediately, so a crashed job
 * resumes at the first window not yet covered by existing rows (16.6-style
 * partial resume without a schema change).
 */
@Injectable()
export class TopicSegmentationService {
  private readonly logger = new Logger(TopicSegmentationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureTopics(importedVideoId: string, onLog?: (msg: string) => void) {
    const video = await this.prisma.importedVideo.findUnique({ where: { id: importedVideoId } });
    if (!video) throw new NotFoundException('Imported video not found');

    const transcript = await this.prisma.transcriptSegment.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
      select: { startMs: true, endMs: true, speakerId: true, text: true },
    });
    if (transcript.length === 0) throw new Error('No transcript segments — run TRANSCRIPT_ANALYSIS first');

    const windows = buildWindows(transcript);

    // Partial resume: skip windows whose full range is already covered by rows
    const lastCovered = await this.prisma.topicSegment.aggregate({
      where: { importedVideoId },
      _max: { endMs: true },
    });
    const coveredUpTo = lastCovered._max.endMs ?? -1;
    const pending = windows.filter((w) => w.endMs > coveredUpTo);
    if (pending.length === 0) {
      const count = await this.prisma.topicSegment.count({ where: { importedVideoId } });
      onLog?.(`Topic segmentation already complete (${count} segments) — reusing`);
      return { skipped: true, segments: count };
    }
    if (pending.length < windows.length) {
      onLog?.(`Resuming topic segmentation — ${windows.length - pending.length}/${windows.length} windows already done`);
    }

    const scenes = await this.prisma.videoScene.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
      select: { startMs: true },
    });

    let created = 0;
    for (let i = 0; i < pending.length; i++) {
      const w = pending[i]!;
      onLog?.(`Segmenting window ${i + 1}/${pending.length} (${Math.round(w.startMs / 1000)}s–${Math.round(w.endMs / 1000)}s)…`);

      const sceneCuts = scenes.filter((s) => s.startMs >= w.startMs && s.startMs <= w.endMs).map((s) => s.startMs);
      const speakerChanges: number[] = [];
      for (let r = 1; r < w.rows.length; r++) {
        if (w.rows[r]!.speakerId !== w.rows[r - 1]!.speakerId) speakerChanges.push(w.rows[r]!.startMs);
      }

      const transcriptText = w.rows.map((r) => `[${r.startMs}–${r.endMs}] ${r.text}`).join('\n');
      const result = await callAIStructured(
        [{
          role: 'user',
          content: [
            `Transcript window (each line is "[startMs–endMs] text"):`,
            transcriptText,
            '',
            `Scene changes at (ms): ${sceneCuts.slice(0, 60).join(', ') || 'none detected'}`,
            `Speaker changes at (ms): ${speakerChanges.slice(0, 60).join(', ') || 'none detected'}`,
            '',
            'Identify the self-contained topic segments in this window.',
            'Respond with JSON: {"segments":[{"startMs":0,"endMs":0,"category":"STORY","title":"...","summary":"...","confidence":0.9}]}',
          ].join('\n'),
        }],
        TopicSegmentationOutputSchema,
        { systemPrompt: TOPIC_SYSTEM, maxTokens: 4096 },
      );

      const clean = this.sanitize(result.segments, w, video.durationMs);
      const merged = await this.mergeAgainstExisting(importedVideoId, clean);
      if (merged.length > 0) {
        await this.prisma.topicSegment.createMany({
          data: merged.map((s) => ({
            importedVideoId,
            startMs: s.startMs,
            endMs: s.endMs,
            category: s.category,
            title: s.title,
            summary: s.summary,
            confidence: s.confidence,
          })),
        });
        created += merged.length;
      }
    }

    const total = await this.prisma.topicSegment.count({ where: { importedVideoId } });
    onLog?.(`Topic segmentation complete — ${total} segments (${created} new)`);
    return { skipped: false, segments: total };
  }

  /** Clamp to window/video bounds and drop degenerate segments. */
  private sanitize(segments: TopicSegmentCandidate[], w: Window, durationMs: number): TopicSegmentCandidate[] {
    return segments
      .map((s) => ({
        ...s,
        startMs: Math.max(0, Math.min(s.startMs, durationMs)),
        endMs: Math.max(0, Math.min(s.endMs, durationMs)),
      }))
      .filter((s) => s.endMs - s.startMs >= 5_000) // < 5s is not a usable topic
      .filter((s) => s.startMs >= w.startMs - 1_000 && s.endMs <= w.endMs + 1_000);
  }

  /**
   * Overlap-zone dedup (ai.md 4.3 step 3): a new segment overlapping an
   * existing row by >50% of either span is a duplicate from the window
   * overlap — keep the higher-confidence one.
   */
  private async mergeAgainstExisting(
    importedVideoId: string,
    candidates: TopicSegmentCandidate[],
  ): Promise<TopicSegmentCandidate[]> {
    if (candidates.length === 0) return [];
    const minStart = Math.min(...candidates.map((c) => c.startMs));
    const existing = await this.prisma.topicSegment.findMany({
      where: { importedVideoId, endMs: { gte: minStart } },
      select: { id: true, startMs: true, endMs: true, confidence: true },
    });

    const out: TopicSegmentCandidate[] = [];
    for (const c of candidates) {
      const dup = existing.find((e) => {
        const overlap = Math.min(c.endMs, e.endMs) - Math.max(c.startMs, e.startMs);
        if (overlap <= 0) return false;
        return overlap > 0.5 * Math.min(c.endMs - c.startMs, e.endMs - e.startMs);
      });
      if (!dup) {
        out.push(c);
      } else if (c.confidence > dup.confidence) {
        // Replace the lower-confidence duplicate (cascade clears any highlight)
        await this.prisma.topicSegment.delete({ where: { id: dup.id } });
        out.push(c);
      }
    }
    return out;
  }
}
