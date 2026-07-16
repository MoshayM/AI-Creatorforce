// Pure helpers for turning per-sample face/motion positions into a smooth
// crop-center path and into the ffmpeg crop-x expression the renderer uses.
// Kept free of I/O so every branch is unit testable.

import type { ReframeKeyframe } from './smart-reframe.service';

export interface PathSample {
  /** Clip-relative time of the sampled frame. */
  ms: number;
  cx: number;
  cy: number;
  /** Where the position came from — faces are trusted more than motion. */
  source: 'face' | 'motion' | 'none';
}

/**
 * Exponential-moving-average smoothing over the sampled path. Face samples
 * get full weight; motion samples are blended at half strength (they are
 * noisier); 'none' samples simply hold the previous position — a subject
 * standing still must not drag the crop back to center.
 */
export function smoothPath(samples: PathSample[], alpha = 0.35): ReframeKeyframe[] {
  const keyframes: ReframeKeyframe[] = [];
  let cx: number | null = null;
  let cy: number | null = null;
  for (const s of samples) {
    if (s.source === 'none') {
      if (cx === null || cy === null) continue; // nothing to hold yet
    } else {
      const a = s.source === 'face' ? alpha : alpha / 2;
      cx = cx === null ? s.cx : cx + a * (s.cx - cx);
      cy = cy === null ? s.cy : cy + a * (s.cy - cy);
    }
    keyframes.push({ ms: s.ms, cx: round3(cx!), cy: round3(cy!) });
  }
  return keyframes.length > 0 ? keyframes : [{ ms: 0, cx: 0.5, cy: 0.5 }];
}

/** Linear interpolation of the crop-center x at an arbitrary clip time. */
export function cxAt(keyframes: ReframeKeyframe[], ms: number): number {
  if (keyframes.length === 0) return 0.5;
  if (ms <= keyframes[0]!.ms) return keyframes[0]!.cx;
  const last = keyframes[keyframes.length - 1]!;
  if (ms >= last.ms) return last.cx;
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1]!;
    const b = keyframes[i]!;
    if (ms <= b.ms) {
      const t = (ms - a.ms) / (b.ms - a.ms);
      return a.cx + t * (b.cx - a.cx);
    }
  }
  return last.cx;
}

/** Evenly resample the keyframes covering [startMs, endMs] to at most `points` control points. */
export function resampleRange(
  keyframes: ReframeKeyframe[],
  startMs: number,
  endMs: number,
  points: number,
): Array<{ ms: number; cx: number }> {
  const n = Math.max(2, points);
  const out: Array<{ ms: number; cx: number }> = [];
  for (let i = 0; i < n; i++) {
    const ms = startMs + ((endMs - startMs) * i) / (n - 1);
    out.push({ ms, cx: round3(cxAt(keyframes, ms)) });
  }
  return out;
}

/**
 * Build the ffmpeg expression for the normalized crop-center x over one
 * rendered segment, as a piecewise-linear function of segment-relative time
 * `t` (seconds). The caller embeds it inside a SINGLE-QUOTED crop x option —
 * the expression contains commas (if/min/max), which split the filtergraph
 * when unquoted (the drawtext x/y bug all over again).
 *
 * Returns a plain constant when the path doesn't move (cheaper and byte-for-
 * byte identical to the old static-crop behavior).
 */
export function buildCxExpr(
  keyframes: ReframeKeyframe[],
  segStartMsClip: number,
  segEndMsClip: number,
  maxPoints = 12,
): string {
  const pts = resampleRange(keyframes, segStartMsClip, segEndMsClip, maxPoints);
  const moves = pts.some((p) => Math.abs(p.cx - pts[0]!.cx) > 0.005);
  if (!moves) return pts[0]!.cx.toFixed(3);

  // Nested if() chain over segment-relative seconds, innermost = last span.
  // clip() keeps the crop window inside the frame even if detection strayed.
  let expr = pts[pts.length - 1]!.cx.toFixed(3);
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const t0 = ((a.ms - segStartMsClip) / 1000).toFixed(3);
    const t1 = ((b.ms - segStartMsClip) / 1000).toFixed(3);
    const dur = Math.max(0.001, (b.ms - a.ms) / 1000).toFixed(3);
    const lerp = `${a.cx.toFixed(3)}+(${(b.cx - a.cx).toFixed(3)})*(t-${t0})/${dur}`;
    expr = `if(lt(t,${t1}),${lerp},${expr})`;
  }
  return `clip(${expr},0,1)`;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
