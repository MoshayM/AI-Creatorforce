import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fsp } from 'fs';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runFfmpeg } from '../media/adapters/ffmpeg.util';
import {
  clusterDetections,
  detectFaces,
  motionCentroid,
  parsePgm,
  unpackCascade,
  type GrayFrame,
  type PicoCascade,
} from './pico-face';
import { smoothPath, type PathSample } from './reframe-path';
import type { VideoSpan } from './timeline-map.util';

/** Normalized crop-center keyframe: cx/cy in 0..1 of the source frame. */
export interface ReframeKeyframe {
  ms: number; // clip-relative
  cx: number;
  cy: number;
}

/** Context the renderer already has in hand — avoids re-resolving the source. */
export interface ReframeContext {
  /** Absolute path of the source video file. */
  sourcePath: string;
  /** Timeline spans (clip-relative + source-relative ranges). */
  spans: VideoSpan[];
}

/** Sampled frames per second of source video. */
const SAMPLE_FPS = 2;
/** Width frames are downscaled to before detection (height keeps aspect). */
const SAMPLE_WIDTH = 512;
/** Minimum clustered score for a face to be trusted (sum over overlapping windows). */
const FACE_SCORE_MIN = 15;
/** Minimum motion mass before the motion centroid is trusted. */
const MOTION_MASS_MIN = 2000;

/**
 * Smart Reframing (ai.md Section 12) — computes and caches the crop-center
 * path consumed by the render's crop filter, stored on the clip as
 * reframeKeyframes so re-renders never re-run detection (rule 22.5).
 *
 * Strategy (spec §27 face/active-subject tracking):
 *  1. Sample the clip's source spans at SAMPLE_FPS as small grayscale frames.
 *  2. Per frame, detect faces with the bundled pico cascade (pico-face.ts);
 *     the strongest face cluster gives the crop center.
 *  3. When no face clears FACE_SCORE_MIN, fall back to the movement centroid
 *     (frame difference vs the previous sample) — presenters gesturing,
 *     robots moving, screen action.
 *  4. When nothing is detected, hold the previous position (a still subject
 *     must not snap the crop back to center).
 *  5. EMA-smooth the path (reframe-path.ts) so the rendered pan is calm.
 *
 * Fails soft: any detection error logs and falls back to static center-crop —
 * a broken cascade asset must never block a render.
 */
@Injectable()
export class SmartReframeService {
  private readonly logger = new Logger(SmartReframeService.name);
  private cascade: PicoCascade | null | undefined; // undefined = not loaded yet

  constructor(private readonly prisma: PrismaService) {}

  async ensureKeyframes(shortClipId: string, ctx?: ReframeContext): Promise<ReframeKeyframe[]> {
    const clip = await this.prisma.shortClip.findUnique({
      where: { id: shortClipId },
      select: { id: true, reframeKeyframes: true },
    });
    if (!clip) throw new NotFoundException('Clip not found');

    const cached = clip.reframeKeyframes as ReframeKeyframe[] | null;
    // A single static keyframe is the legacy placeholder — recompute when we
    // now have the context to do real tracking.
    if (Array.isArray(cached) && cached.length > 1) return cached;
    if (Array.isArray(cached) && cached.length === 1 && !ctx) return cached;

    const keyframes = await this.computeKeyframes(ctx);
    await this.prisma.shortClip.update({
      where: { id: shortClipId },
      data: { reframeKeyframes: keyframes as never },
    });
    return keyframes;
  }

  private async computeKeyframes(ctx?: ReframeContext): Promise<ReframeKeyframe[]> {
    if (!ctx || ctx.spans.length === 0) return [{ ms: 0, cx: 0.5, cy: 0.5 }];
    try {
      const samples = await this.samplePath(ctx);
      const keyframes = smoothPath(samples);
      const faces = samples.filter((s) => s.source === 'face').length;
      const motion = samples.filter((s) => s.source === 'motion').length;
      this.logger.log(
        `Reframe path: ${keyframes.length} keyframes from ${samples.length} samples (${faces} face, ${motion} motion)`,
      );
      return keyframes;
    } catch (err) {
      this.logger.warn(
        `Face/motion tracking failed — falling back to center crop: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [{ ms: 0, cx: 0.5, cy: 0.5 }];
    }
  }

  /** Extract sampled frames per span and turn each into a PathSample. */
  private async samplePath(ctx: ReframeContext): Promise<PathSample[]> {
    const cascade = this.loadCascade();
    const samples: PathSample[] = [];

    for (const span of ctx.spans) {
      const durSecs = (span.sourceEndMs - span.sourceStartMs) / 1000;
      if (durSecs <= 0) continue;
      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-reframe-'));
      try {
        await runFfmpeg([
          '-ss', String(span.sourceStartMs / 1000),
          '-t', String(durSecs),
          '-i', ctx.sourcePath,
          '-vf', `fps=${SAMPLE_FPS},scale=${SAMPLE_WIDTH}:-2`,
          '-f', 'image2',
          path.join(tmpDir, 'f-%05d.pgm'),
        ]);

        const files = (await fsp.readdir(tmpDir)).filter((f) => f.endsWith('.pgm')).sort();
        let prev: GrayFrame | null = null;
        for (let i = 0; i < files.length; i++) {
          const frame = parsePgm(await fsp.readFile(path.join(tmpDir, files[i]!)));
          const ms = span.timelineStartMs + Math.round((i * 1000) / SAMPLE_FPS);
          samples.push(this.sampleFrom(cascade, frame, prev, ms));
          prev = frame;
        }
      } finally {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    return samples;
  }

  /** Face first, movement second, hold-position last. */
  private sampleFrom(
    cascade: PicoCascade | null,
    frame: GrayFrame,
    prev: GrayFrame | null,
    ms: number,
  ): PathSample {
    if (cascade) {
      const faces = clusterDetections(detectFaces(cascade, frame, { minSize: 24 }));
      const best = faces[0];
      if (best && best.score >= FACE_SCORE_MIN) {
        return { ms, cx: best.col / frame.width, cy: best.row / frame.height, source: 'face' };
      }
    }
    if (prev) {
      const m = motionCentroid(prev, frame);
      if (m.mass >= MOTION_MASS_MIN) return { ms, cx: m.cx, cy: m.cy, source: 'motion' };
    }
    return { ms, cx: 0.5, cy: 0.5, source: 'none' };
  }

  /** Lazy-load the bundled cascade; a missing asset degrades to motion-only. */
  private loadCascade(): PicoCascade | null {
    if (this.cascade !== undefined) return this.cascade;
    const candidates = [
      process.env['FACEFINDER_PATH'],
      path.join(process.cwd(), 'assets', 'facefinder'),
      path.join(__dirname, '..', '..', '..', 'assets', 'facefinder'),
    ].filter((p): p is string => !!p);
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      this.logger.warn('facefinder cascade not found — reframe will use motion tracking only');
      this.cascade = null;
      return null;
    }
    this.cascade = unpackCascade(readFileSync(found));
    return this.cascade;
  }
}
