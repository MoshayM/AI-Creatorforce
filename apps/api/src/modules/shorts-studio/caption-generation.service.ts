import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { callAIStructured, CaptionStylingOutputSchema } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { videoSpans, sourceRangeToTimeline } from './timeline-map.util';

const STYLING_SYSTEM = `You style captions for a vertical short-form video. For each caption line decide:
- emphasis: true only for the lines carrying the key message/keywords a viewer must not miss (at most ~30% of lines).
- emoji: a single fitting emoji for lines where it adds energy, otherwise null. Never more than one, never on consecutive lines.
Respond only with valid JSON.`;

/**
 * CAPTION_GENERATION job (ai.md Section 11): transcript segments overlapping
 * the clip's video spans become clip-relative ShortsCaption rows; one
 * caption-styling AI call marks emphasis + emoji (Section 22.3 — a single
 * combined call, reusing the already-loaded transcript). Resume rule: a
 * timeline that already has captions is never regenerated.
 */
@Injectable()
export class CaptionGenerationService {
  private readonly logger = new Logger(CaptionGenerationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureCaptions(shortClipId: string, onLog?: (msg: string) => void) {
    const clip = await this.prisma.shortClip.findUnique({
      where: { id: shortClipId },
      include: {
        timeline: { include: { tracks: { where: { type: 'VIDEO' }, include: { items: true } }, captions: true } },
        topicSegment: { select: { importedVideoId: true } },
        chapter: { select: { importedVideoId: true } },
      },
    });
    if (!clip?.timeline) throw new NotFoundException('Clip or timeline not found');
    if (clip.timeline.captions.length > 0) {
      onLog?.(`Captions already exist (${clip.timeline.captions.length}) — reusing`);
      return { skipped: true, captions: clip.timeline.captions.length };
    }

    const spans = videoSpans(clip.timeline.tracks.flatMap((t) => t.items));
    if (spans.length === 0) throw new BadRequestException('Timeline has no video items');
    const srcStart = Math.min(...spans.map((s) => s.sourceStartMs));
    const srcEnd = Math.max(...spans.map((s) => s.sourceEndMs));

    const importedVideoId = clip.topicSegment?.importedVideoId ?? clip.chapter?.importedVideoId;
    if (!importedVideoId) throw new BadRequestException('Clip has no source-video provenance');
    const segments = await this.prisma.transcriptSegment.findMany({
      where: { importedVideoId, endMs: { gt: srcStart }, startMs: { lt: srcEnd } },
      orderBy: { startMs: 'asc' },
    });
    if (segments.length === 0) throw new BadRequestException('No transcript for this clip range — run the analysis pipeline first');

    // Clip-relative cues through the current edit state
    const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
    for (const seg of segments) {
      for (const range of sourceRangeToTimeline(spans, seg.startMs, seg.endMs)) {
        if (range.endMs - range.startMs < 200) continue;
        cues.push({ startMs: Math.round(range.startMs), endMs: Math.round(range.endMs), text: seg.text.trim() });
      }
    }
    cues.sort((a, b) => a.startMs - b.startMs);

    onLog?.(`Styling ${cues.length} captions…`);
    const styling = await callAIStructured(
      [{
        role: 'user',
        content: [
          'Caption lines (index: text):',
          cues.map((c, i) => `${i}: ${c.text}`).join('\n'),
          '',
          'Respond with JSON: {"captions":[{"index":0,"emphasis":false,"emoji":null}]}',
          'Include every index exactly once.',
        ].join('\n'),
      }],
      CaptionStylingOutputSchema,
      { systemPrompt: STYLING_SYSTEM, maxTokens: 4096 },
    );
    const styleByIndex = new Map(styling.captions.map((c) => [c.index, c]));

    await this.prisma.shortsCaption.createMany({
      data: cues.map((cue, i) => ({
        timelineId: clip.timeline!.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        emphasis: styleByIndex.get(i)?.emphasis ?? false,
        emoji: styleByIndex.get(i)?.emoji ?? null,
      })),
    });
    // Captions change the render output — bump the timeline so the render
    // job's is-up-to-date check re-renders instead of reusing the old file
    await this.prisma.shortsTimeline.update({
      where: { id: clip.timeline!.id },
      data: { updatedAt: new Date() },
    });
    onLog?.(`Captions generated — ${cues.length} lines`);
    return { skipped: false, captions: cues.length };
  }
}
