import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { callAIStructured, PacingSuggestionOutputSchema, type AssistCapability, type TimelineCommand } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runFfmpegCapture } from '../media/adapters/ffmpeg.util';
import { VideoImportService } from './video-import.service';
import { videoSpans, sourceRangeToTimeline, type VideoSpan } from './timeline-map.util';

const PACING_SYSTEM = `You are a short-form video editor improving pacing. Given a clip transcript with timeline timestamps, propose the cuts that tighten the clip: rambling sentences, redundant restatements, slow wind-ups before the point. Keep the clip's meaning intact — never cut a setup whose payoff stays in. Only propose cuts you are confident about. Respond only with valid JSON.`;

const FILLER_RE = /\b(um+|uh+|erm+|ah+|you know|i mean|sort of|kind of|like,)\b/gi;
const MIN_SILENCE_SECS = 0.7;
const SILENCE_PAD_MS = 120;

/**
 * AI Editing Assistant (ai.md Section 9): every capability returns a PROPOSED
 * diff — a TimelineCommand[] the caller reviews and applies via the timeline
 * API. Nothing here mutates the timeline directly (9.2 keeps auto and
 * assisted modes on one code path).
 */
@Injectable()
export class AiEditingAssistantService {
  private readonly logger = new Logger(AiEditingAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly videoImport: VideoImportService,
  ) {}

  async suggest(timelineId: string, capability: AssistCapability): Promise<{ capability: string; commands: TimelineCommand[] }> {
    const timeline = await this.prisma.shortsTimeline.findUnique({
      where: { id: timelineId },
      include: {
        tracks: { where: { type: 'VIDEO' }, include: { items: { orderBy: { startMs: 'asc' } } } },
        shortClip: { include: { topicSegment: { select: { importedVideoId: true } }, chapter: { select: { importedVideoId: true } } } },
      },
    });
    if (!timeline) throw new NotFoundException('Timeline not found');
    const spans = videoSpans(timeline.tracks.flatMap((t) => t.items));
    if (spans.length === 0) throw new BadRequestException('Timeline has no video items to analyze');
    const importedVideoId = timeline.shortClip.topicSegment?.importedVideoId ?? timeline.shortClip.chapter?.importedVideoId;
    if (!importedVideoId) throw new BadRequestException('Clip has no source-video provenance');

    let commands: TimelineCommand[];
    switch (capability) {
      case 'remove-silence':
        commands = await this.removeSilence(importedVideoId, spans);
        break;
      case 'remove-fillers':
        commands = await this.removeFillers(importedVideoId, spans);
        break;
      case 'improve-pacing':
        commands = await this.improvePacing(importedVideoId, spans, timeline.durationMs);
        break;
    }

    // Emit cuts back-to-front so each CUT_RANGE's coordinates stay valid
    // while earlier (ripple-shifting) cuts are applied after it.
    commands.sort((a, b) => (b.type === 'CUT_RANGE' && a.type === 'CUT_RANGE' ? a.startMs - b.startMs : 0)).reverse();
    return { capability, commands };
  }

  /** FFmpeg silencedetect over the clip's source spans → ripple cuts. */
  private async removeSilence(importedVideoId: string, spans: VideoSpan[]): Promise<TimelineCommand[]> {
    const sourcePath = await this.videoImport.getSourcePath(importedVideoId);
    const srcStart = Math.min(...spans.map((s) => s.sourceStartMs));
    const srcEnd = Math.max(...spans.map((s) => s.sourceEndMs));

    const out = await runFfmpegCapture([
      '-ss', String(srcStart / 1000),
      '-t', String((srcEnd - srcStart) / 1000),
      '-i', sourcePath,
      '-af', `silencedetect=noise=-35dB:d=${MIN_SILENCE_SECS}`,
      '-f', 'null', '-',
    ], 600_000);

    // silencedetect logs pairs: silence_start: 12.34 … silence_end: 13.9
    const silences: Array<{ startMs: number; endMs: number }> = [];
    let pending: number | null = null;
    for (const line of out.split('\n')) {
      const s = line.match(/silence_start:\s*([\d.]+)/);
      if (s) { pending = srcStart + parseFloat(s[1]!) * 1000; continue; }
      const e = line.match(/silence_end:\s*([\d.]+)/);
      if (e && pending != null) {
        silences.push({ startMs: pending, endMs: srcStart + parseFloat(e[1]!) * 1000 });
        pending = null;
      }
    }

    const commands: TimelineCommand[] = [];
    for (const silence of silences) {
      // keep a natural breath at both edges
      const cutStart = silence.startMs + SILENCE_PAD_MS;
      const cutEnd = silence.endMs - SILENCE_PAD_MS;
      if (cutEnd <= cutStart) continue;
      for (const range of sourceRangeToTimeline(spans, cutStart, cutEnd)) {
        commands.push({
          type: 'CUT_RANGE',
          startMs: Math.round(range.startMs),
          endMs: Math.round(range.endMs),
          reason: `Silence (${((cutEnd - cutStart) / 1000).toFixed(1)}s)`,
        });
      }
    }
    this.logger.log(`remove-silence: ${silences.length} silences → ${commands.length} cuts`);
    return commands;
  }

  /**
   * Transcript pattern match; word timing is estimated by character offset
   * within the segment (segment-level timestamps only — no forced alignment
   * yet), so cuts carry a small pad and stay conservative.
   */
  private async removeFillers(importedVideoId: string, spans: VideoSpan[]): Promise<TimelineCommand[]> {
    const srcStart = Math.min(...spans.map((s) => s.sourceStartMs));
    const srcEnd = Math.max(...spans.map((s) => s.sourceEndMs));
    const segments = await this.prisma.transcriptSegment.findMany({
      where: { importedVideoId, endMs: { gt: srcStart }, startMs: { lt: srcEnd } },
      orderBy: { startMs: 'asc' },
    });

    const commands: TimelineCommand[] = [];
    for (const seg of segments) {
      const segLen = seg.endMs - seg.startMs;
      if (segLen <= 0 || seg.text.length === 0) continue;
      for (const match of seg.text.matchAll(FILLER_RE)) {
        const idx = match.index ?? 0;
        const wordStartMs = seg.startMs + (idx / seg.text.length) * segLen;
        const wordEndMs = seg.startMs + ((idx + match[0].length) / seg.text.length) * segLen;
        for (const range of sourceRangeToTimeline(spans, wordStartMs - 40, wordEndMs + 40)) {
          commands.push({
            type: 'CUT_RANGE',
            startMs: Math.round(range.startMs),
            endMs: Math.round(range.endMs),
            reason: `Filler: "${match[0]}"`,
          });
        }
      }
    }
    return commands;
  }

  /** LLM cut suggestions from the clip-relative transcript (ai.md 9.1 pacing). */
  private async improvePacing(importedVideoId: string, spans: VideoSpan[], durationMs: number): Promise<TimelineCommand[]> {
    const srcStart = Math.min(...spans.map((s) => s.sourceStartMs));
    const srcEnd = Math.max(...spans.map((s) => s.sourceEndMs));
    const segments = await this.prisma.transcriptSegment.findMany({
      where: { importedVideoId, endMs: { gt: srcStart }, startMs: { lt: srcEnd } },
      orderBy: { startMs: 'asc' },
    });
    if (segments.length === 0) throw new BadRequestException('No transcript for this clip range');

    const lines: string[] = [];
    for (const seg of segments) {
      for (const range of sourceRangeToTimeline(spans, seg.startMs, seg.endMs)) {
        lines.push(`[${Math.round(range.startMs)}–${Math.round(range.endMs)}] ${seg.text}`);
      }
    }

    const result = await callAIStructured(
      [{
        role: 'user',
        content: [
          `Clip length: ${Math.round(durationMs / 1000)}s. Transcript with clip-relative timestamps (ms):`,
          lines.join('\n'),
          '',
          'Propose pacing cuts. Respond with JSON: {"cuts":[{"startMs":0,"endMs":0,"reason":"..."}]}',
          'Return an empty cuts array if the pacing is already tight.',
        ].join('\n'),
      }],
      PacingSuggestionOutputSchema,
      { systemPrompt: PACING_SYSTEM, maxTokens: 2048 },
    );

    return result.cuts
      .filter((c) => c.endMs > c.startMs && c.startMs >= 0 && c.endMs <= durationMs)
      .map((c) => ({
        type: 'CUT_RANGE' as const,
        startMs: Math.round(c.startMs),
        endMs: Math.round(c.endMs),
        reason: c.reason,
      }));
  }
}
