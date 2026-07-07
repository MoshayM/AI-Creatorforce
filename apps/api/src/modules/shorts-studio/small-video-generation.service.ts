import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CLIP_TYPE_PRESETS } from './clip-type-presets';
import { seededTimelineCreate } from './shorts-generation.service';

/** Below this a "small video" is really a Short — leave it to the Shorts flow. */
const MIN_SMALL_VIDEO_MS = 60_000;

export interface SmallVideoPlan {
  chapterId: string;
  title: string;
  sourceStartMs: number;
  sourceEndMs: number;
}

/**
 * Chapter → small-video cut plan (Ai-video edit.md §10: 1–10 min horizontal
 * videos). One video per chapter; chapters shorter than a minute are skipped,
 * longer-than-cap chapters are clipped to the preset max from their start.
 * Pure — exported for tests.
 */
export function planSmallVideos(
  chapters: Array<{ id: string; title: string; startMs: number; endMs: number }>,
  maxDurationMs: number,
): { plans: SmallVideoPlan[]; skippedTooShort: number } {
  const plans: SmallVideoPlan[] = [];
  let skippedTooShort = 0;
  for (const c of chapters) {
    const len = c.endMs - c.startMs;
    if (len < MIN_SMALL_VIDEO_MS) {
      skippedTooShort += 1;
      continue;
    }
    plans.push({
      chapterId: c.id,
      title: c.title,
      sourceStartMs: c.startMs,
      sourceEndMs: Math.min(c.endMs, c.startMs + maxDurationMs),
    });
  }
  return { plans, skippedTooShort };
}

/**
 * Batched small-video generation (Ai-video edit.md §10, "batched, not
 * per-request" §12.4): one SMALL_VIDEO ShortClip per chapter, seeded with the
 * same timeline shape as Shorts so the whole existing edit → captions →
 * render (16:9 preset) → export → publish path applies unchanged. Zero AI
 * calls — chapters are already the analysis graph. Resumable per chapter:
 * existing chapter clips are reused.
 */
@Injectable()
export class SmallVideoGenerationService {
  private readonly logger = new Logger(SmallVideoGenerationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateFromChapters(importedVideoId: string, onLog?: (msg: string) => void) {
    const video = await this.prisma.importedVideo.findUnique({
      where: { id: importedVideoId },
      select: { projectId: true, sourceAssetId: true },
    });
    if (!video) throw new NotFoundException('Imported video not found');

    const chapters = await this.prisma.chapter.findMany({
      where: { importedVideoId },
      orderBy: { startMs: 'asc' },
      select: { id: true, title: true, startMs: true, endMs: true },
    });
    if (chapters.length === 0) throw new Error('No chapters — run CHAPTER_DETECTION first');

    const { plans, skippedTooShort } = planSmallVideos(chapters, CLIP_TYPE_PRESETS.SMALL_VIDEO.maxDurationMs);
    if (skippedTooShort > 0) onLog?.(`Skipping ${skippedTooShort} chapter(s) under 60s — Shorts territory`);

    const clips = [];
    let created = 0;
    for (const plan of plans) {
      const existing = await this.prisma.shortClip.findFirst({
        where: { chapterId: plan.chapterId, clipType: 'SMALL_VIDEO' },
      });
      if (existing) {
        clips.push(existing);
        continue;
      }
      const clip = await this.prisma.shortClip.create({
        data: {
          chapterId: plan.chapterId,
          projectId: video.projectId,
          clipType: 'SMALL_VIDEO',
          status: 'CANDIDATE',
          sourceStartMs: plan.sourceStartMs,
          sourceEndMs: plan.sourceEndMs,
          timeline: seededTimelineCreate(video.sourceAssetId, plan.sourceStartMs, plan.sourceEndMs),
        },
      });
      onLog?.(`Created small video "${plan.title}" (${Math.round((plan.sourceEndMs - plan.sourceStartMs) / 1000)}s)`);
      clips.push(clip);
      created += 1;
    }

    onLog?.(`Small videos ready — ${clips.length} total (${created} new, ${skippedTooShort} chapters skipped)`);
    return { clips, created, reused: clips.length - created, skippedTooShort };
  }
}
