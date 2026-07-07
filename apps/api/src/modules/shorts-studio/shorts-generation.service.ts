import { Injectable, NotFoundException } from '@nestjs/common';
import type { ClipType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CLIP_TYPE_PRESETS } from './clip-type-presets';

/**
 * Nested-create payload for a fresh clip timeline: one VIDEO item spanning the
 * source range plus empty AUDIO/CAPTION/OVERLAY tracks for the editor. Shared
 * by highlight-based Shorts and chapter-based Small Videos so both enter the
 * exact same edit → captions → render → export path.
 */
export function seededTimelineCreate(sourceAssetId: string | null, sourceStartMs: number, sourceEndMs: number) {
  const durationMs = sourceEndMs - sourceStartMs;
  return {
    create: {
      durationMs,
      tracks: {
        create: [
          {
            type: 'VIDEO' as const,
            orderIndex: 0,
            items: {
              create: [{
                startMs: 0,
                endMs: durationMs,
                sourceAssetId,
                properties: { sourceStartMs, sourceEndMs } as never,
              }],
            },
          },
          { type: 'AUDIO' as const, orderIndex: 1 },
          { type: 'CAPTION' as const, orderIndex: 2 },
          { type: 'OVERLAY' as const, orderIndex: 3 },
        ],
      },
    },
  };
}

/**
 * SHORTS_GENERATION (ai.md Section 15): one candidate ShortClip per
 * highlight × clip type, each with its own ShortsTimeline seeded with a
 * VIDEO track item spanning the source range (clamped to the preset's max
 * duration) plus empty AUDIO/CAPTION/OVERLAY tracks for the editor.
 * Resumable per highlight × clip type: existing pairs are skipped.
 */
@Injectable()
export class ShortsGenerationService {
  constructor(private readonly prisma: PrismaService) {}

  async generateClips(highlightId: string, clipTypes: ClipType[], onLog?: (msg: string) => void) {
    const highlight = await this.prisma.highlight.findUnique({
      where: { id: highlightId },
      include: { topicSegment: { include: { importedVideo: { select: { projectId: true, sourceAssetId: true } } } } },
    });
    if (!highlight) throw new NotFoundException('Highlight not found');
    const segment = highlight.topicSegment;
    const { projectId, sourceAssetId } = segment.importedVideo;

    const clips = [];
    for (const clipType of clipTypes) {
      const existing = await this.prisma.shortClip.findFirst({
        where: { topicSegmentId: segment.id, clipType },
      });
      if (existing) {
        onLog?.(`${clipType} clip already exists for this highlight — reusing`);
        clips.push(existing);
        continue;
      }

      const preset = CLIP_TYPE_PRESETS[clipType];
      const sourceStartMs = segment.startMs;
      const sourceEndMs = Math.min(segment.endMs, segment.startMs + preset.maxDurationMs);
      const durationMs = sourceEndMs - sourceStartMs;

      const clip = await this.prisma.shortClip.create({
        data: {
          topicSegmentId: segment.id,
          projectId,
          clipType,
          status: 'CANDIDATE',
          sourceStartMs,
          sourceEndMs,
          timeline: seededTimelineCreate(sourceAssetId, sourceStartMs, sourceEndMs),
        },
        include: { timeline: true },
      });
      onLog?.(`Created ${clipType} candidate clip (${Math.round(durationMs / 1000)}s)`);
      clips.push(clip);
    }
    return clips;
  }

  async listClips(projectId: string) {
    return this.prisma.shortClip.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        topicSegment: { select: { title: true, importedVideoId: true, highlight: { select: { titleSuggestion: true, finalScore: true } } } },
        chapter: { select: { title: true, importedVideoId: true } },
        timeline: { select: { id: true, durationMs: true } },
      },
    });
  }
}
