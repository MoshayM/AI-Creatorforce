import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Normalized crop-center keyframe: cx/cy in 0..1 of the source frame. */
export interface ReframeKeyframe {
  ms: number; // clip-relative
  cx: number;
  cy: number;
}

/**
 * Smart Reframing (ai.md Section 12) — computes and caches the crop-center
 * path consumed by the render's crop filter, stored on the clip as
 * reframeKeyframes so re-renders never re-run detection (rule 22.5).
 *
 * Current strategy: static center crop. The keyframe interface matches the
 * spec's face/active-speaker tracking output, so a detector can replace
 * computeKeyframes() without touching the renderer. No face-detection
 * dependency exists in the stack yet — flagged as a known simplification.
 */
@Injectable()
export class SmartReframeService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureKeyframes(shortClipId: string): Promise<ReframeKeyframe[]> {
    const clip = await this.prisma.shortClip.findUnique({
      where: { id: shortClipId },
      select: { id: true, reframeKeyframes: true },
    });
    if (!clip) throw new NotFoundException('Clip not found');

    const cached = clip.reframeKeyframes as ReframeKeyframe[] | null;
    if (Array.isArray(cached) && cached.length > 0) return cached;

    const keyframes = this.computeKeyframes();
    await this.prisma.shortClip.update({
      where: { id: shortClipId },
      data: { reframeKeyframes: keyframes as never },
    });
    return keyframes;
  }

  private computeKeyframes(): ReframeKeyframe[] {
    return [{ ms: 0, cx: 0.5, cy: 0.5 }];
  }
}
