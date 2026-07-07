import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, SocialContentKind } from '@prisma/client';
import { callAIStructured, SocialContentOutputSchema, type SocialContentOutput } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

const SOCIAL_SYSTEM = `You are a social media content strategist repurposing one long-form video into multi-platform text content.

From the video's chapters, top moments, and transcript excerpts, produce:
- quoteCards (3–6): the most striking, shareable lines. Each quote must appear VERBATIM (or with only trivial cleanup: fillers removed, casing fixed) in the provided transcript excerpts — never paraphrase into something that was not said. startMs comes from the excerpt's timestamp markers. attribution only if a speaker is identifiable, else null.
- carousel: an Instagram/LinkedIn carousel — a title plus 5–8 slides, each a short heading and 1–2 sentence body, walking through the video's core message.
- blogPost: an 500–800 word markdown article covering the video's message with section headings; write for someone who has NOT watched the video.
- newsletter: a warm ~200 word email digest in markdown with a compelling subject line and a call to watch the full video.

Rules:
- Ground everything in the provided material; never invent facts, stories, or quotes.
- Match the video's tone (a sermon reads pastoral, a tutorial reads practical).
- Plain language, no hashtag spam (max 3 hashtags, only in the carousel's last slide).

Respond only with valid JSON.`;

export interface SocialContentRow {
  kind: SocialContentKind;
  title: string;
  content: Prisma.InputJsonValue;
}

/**
 * Flatten the model output into social_content rows, clamping quote
 * timestamps into the video and dropping quotes that point outside it.
 * Pure — exported for tests.
 */
export function socialOutputToRows(output: SocialContentOutput, durationMs: number): SocialContentRow[] {
  const rows: SocialContentRow[] = [];
  for (const q of output.quoteCards) {
    if (q.startMs >= durationMs) continue;
    rows.push({
      kind: 'QUOTE_CARD',
      title: q.quote.length > 80 ? `${q.quote.slice(0, 77)}…` : q.quote,
      content: { quote: q.quote, attribution: q.attribution, startMs: q.startMs },
    });
  }
  rows.push({ kind: 'CAROUSEL', title: output.carousel.title, content: { slides: output.carousel.slides } });
  rows.push({ kind: 'BLOG_POST', title: output.blogPost.title, content: { markdown: output.blogPost.markdown } });
  rows.push({ kind: 'NEWSLETTER', title: output.newsletter.subject, content: { subject: output.newsletter.subject, markdown: output.newsletter.markdown } });
  return rows;
}

/**
 * SOCIAL_CONTENT_GENERATION job (Ai-video edit.md §10): quote cards,
 * carousel, blog post, and newsletter in ONE batched call (§12.4) over the
 * stored analysis graph — chapters, top highlights, and the transcript
 * excerpts under those highlights (so quotes can be verbatim). On-demand
 * only; self-skips when the video already has social content.
 */
@Injectable()
export class SocialContentService {
  private readonly logger = new Logger(SocialContentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listForVideo(importedVideoId: string) {
    return this.prisma.socialContent.findMany({
      where: { importedVideoId },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async ensureSocialContent(importedVideoId: string, onLog?: (msg: string) => void) {
    const video = await this.prisma.importedVideo.findUnique({ where: { id: importedVideoId } });
    if (!video) throw new NotFoundException('Imported video not found');

    const existing = await this.prisma.socialContent.count({ where: { importedVideoId } });
    if (existing > 0) {
      onLog?.(`Social content already generated (${existing} pieces) — reusing`);
      return { skipped: true, pieces: existing };
    }

    const [chapters, highlights] = await Promise.all([
      this.prisma.chapter.findMany({
        where: { importedVideoId },
        orderBy: { startMs: 'asc' },
        select: { title: true, summary: true, keyPoints: true },
      }),
      this.prisma.highlight.findMany({
        where: { topicSegment: { importedVideoId } },
        orderBy: { finalScore: 'desc' },
        take: 5,
        select: { titleSuggestion: true, reason: true, topicSegment: { select: { startMs: true, endMs: true } } },
      }),
    ]);
    if (chapters.length === 0 && highlights.length === 0) {
      throw new Error('No chapters or highlights — run the analysis pipeline first');
    }

    // Transcript under the top highlights → verbatim quote material with stamps
    const excerpts: string[] = [];
    for (const h of highlights) {
      const segs = await this.prisma.transcriptSegment.findMany({
        where: {
          importedVideoId,
          startMs: { lt: h.topicSegment.endMs },
          endMs: { gt: h.topicSegment.startMs },
        },
        orderBy: { startMs: 'asc' },
        select: { startMs: true, text: true },
      });
      const text = segs.map((s) => `[${s.startMs}] ${s.text}`).join(' ');
      excerpts.push(`— ${h.titleSuggestion}: ${text.slice(0, 1500)}`);
    }

    onLog?.(`Generating social content from ${chapters.length} chapters + ${highlights.length} highlights in one batched call…`);
    const result = await callAIStructured(
      [{
        role: 'user',
        content: [
          `Video: "${video.title}" (${Math.round(video.durationMs / 60000)} min)`,
          '',
          'Chapters:',
          chapters.map((c) => `• ${c.title} — ${c.summary.slice(0, 200)}${c.keyPoints.length ? ` (${c.keyPoints.join('; ')})` : ''}`).join('\n') || '(none)',
          '',
          'Top moments with transcript excerpts (each excerpt word-group is prefixed "[startMs]"):',
          excerpts.join('\n') || '(none)',
          '',
          'Respond with JSON: {"quoteCards":[{"quote":"...","attribution":null,"startMs":0}],"carousel":{"title":"...","slides":[{"heading":"...","body":"..."}]},"blogPost":{"title":"...","markdown":"..."},"newsletter":{"subject":"...","markdown":"..."}}',
        ].join('\n'),
      }],
      SocialContentOutputSchema,
      { systemPrompt: SOCIAL_SYSTEM, maxTokens: 8192 },
    );

    const rows = socialOutputToRows(result, video.durationMs);
    await this.prisma.socialContent.createMany({
      data: rows.map((r) => ({ importedVideoId, kind: r.kind, title: r.title, content: r.content })),
    });

    onLog?.(`Social content ready — ${rows.length} pieces (${rows.filter((r) => r.kind === 'QUOTE_CARD').length} quote cards, carousel, blog, newsletter)`);
    return { skipped: false, pieces: rows.length };
  }
}
