import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { callAIStructured, ChurchPackOutputSchema, type ChapterChurchPack } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

const CHURCH_PACK_SYSTEM = `You are a pastoral content assistant preparing study material from a sermon/teaching video's chapters.

For EACH chapter you are given (title, summary, key points), produce:
- bibleRefs: scripture passages explicitly cited or clearly alluded to in that chapter (standard notation, e.g. "John 3:16", "Psalm 23:1-4"). Empty array if the chapter has no scriptural content — NEVER invent references.
- discussionQuestions: 3–5 small-group questions grounded in that chapter's actual message; open-ended, practical, no yes/no questions.
- devotional: a ~100–150 word reflection a reader could use in daily devotions — rooted in the chapter's message, warm and direct, ending with a one-sentence prayer or application.

Rules:
- Include every chapterIndex exactly once.
- Work only from the provided chapter content; do not invent events, quotes, or scripture.
- If the video is not faith content, keep bibleRefs empty and write the devotional as a practical reflection on the chapter's message instead.

Respond only with valid JSON.`;

export interface ChurchPackUpdate {
  chapterId: string;
  bibleRefs: string[];
  discussionQuestions: string[];
  devotional: string;
}

/**
 * Match model output entries back to chapters by chapterIndex, dropping
 * entries with unknown/duplicate indexes rather than mis-assigning them.
 * Pure — exported for tests.
 */
export function mergePackIntoChapters(
  chapterIds: string[],
  outputs: ChapterChurchPack[],
): ChurchPackUpdate[] {
  const seen = new Set<number>();
  const updates: ChurchPackUpdate[] = [];
  for (const o of outputs) {
    const chapterId = chapterIds[o.chapterIndex];
    if (!chapterId || seen.has(o.chapterIndex)) continue;
    seen.add(o.chapterIndex);
    updates.push({
      chapterId,
      bibleRefs: o.bibleRefs.map((r) => r.trim()).filter(Boolean),
      discussionQuestions: o.discussionQuestions.map((q) => q.trim()).filter(Boolean),
      devotional: o.devotional.trim(),
    });
  }
  return updates;
}

/**
 * CHURCH_PACK_GENERATION job (Ai-video edit.md §11): bible references,
 * discussion questions, and a devotional per chapter — ONE batched call over
 * the stored chapter graph (§12.4), never the transcript. On-demand only
 * (not part of the default analysis pipeline). Chapters that already have a
 * devotional are skipped, so re-runs only fill gaps and never clobber.
 */
@Injectable()
export class ChurchPackService {
  private readonly logger = new Logger(ChurchPackService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureChurchPack(importedVideoId: string, onLog?: (msg: string) => void) {
    const video = await this.prisma.importedVideo.findUnique({ where: { id: importedVideoId } });
    if (!video) throw new NotFoundException('Imported video not found');

    const chapters = await this.prisma.chapter.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
      select: { id: true, title: true, summary: true, keyPoints: true, devotional: true },
    });
    if (chapters.length === 0) throw new Error('No chapters — run CHAPTER_DETECTION first');

    const pending = chapters.filter((c) => !c.devotional);
    if (pending.length === 0) {
      onLog?.(`Church pack already complete (${chapters.length} chapters) — reusing`);
      return { skipped: true, chapters: chapters.length };
    }
    if (pending.length < chapters.length) {
      onLog?.(`Resuming church pack — ${chapters.length - pending.length}/${chapters.length} chapters already done`);
    }

    onLog?.(`Generating study material for ${pending.length} chapter(s) in one batched call…`);
    const listing = pending
      .map((c, i) => {
        const points = c.keyPoints.length ? ` Key points: ${c.keyPoints.join('; ')}` : '';
        return `${i}. "${c.title}" — ${c.summary.slice(0, 300)}${points}`;
      })
      .join('\n');
    const result = await callAIStructured(
      [{
        role: 'user',
        content: [
          `Video: "${video.title}"`,
          '',
          'Chapters (each line is "chapterIndex. \"title\" — summary"):',
          listing,
          '',
          'Respond with JSON: {"chapters":[{"chapterIndex":0,"bibleRefs":["..."],"discussionQuestions":["..."],"devotional":"..."}]}',
          'Include every chapterIndex exactly once.',
        ].join('\n'),
      }],
      ChurchPackOutputSchema,
      { systemPrompt: CHURCH_PACK_SYSTEM, maxTokens: 8192 },
    );

    const updates = mergePackIntoChapters(pending.map((c) => c.id), result.chapters);
    if (updates.length === 0) throw new Error('Church pack call produced no usable chapter entries');

    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.chapter.update({
          where: { id: u.chapterId },
          data: {
            bibleRefs: u.bibleRefs,
            discussionQuestions: u.discussionQuestions,
            devotional: u.devotional,
          },
        }),
      ),
    );

    onLog?.(`Church pack complete — ${updates.length} chapter(s) updated`);
    return { skipped: false, chapters: chapters.length, updated: updates.length };
  }
}
