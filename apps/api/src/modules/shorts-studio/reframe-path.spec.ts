import { buildCxExpr, cxAt, resampleRange, smoothPath, type PathSample } from './reframe-path';
import type { ReframeKeyframe } from './smart-reframe.service';

describe('smoothPath', () => {
  it('EMA-smooths face samples toward the subject', () => {
    const samples: PathSample[] = [
      { ms: 0, cx: 0.5, cy: 0.5, source: 'face' },
      { ms: 500, cx: 0.9, cy: 0.5, source: 'face' },
      { ms: 1000, cx: 0.9, cy: 0.5, source: 'face' },
    ];
    const kf = smoothPath(samples);
    expect(kf).toHaveLength(3);
    expect(kf[0]!.cx).toBe(0.5);
    // Moves toward 0.9 but never overshoots or jumps the full distance at once
    expect(kf[1]!.cx).toBeGreaterThan(0.5);
    expect(kf[1]!.cx).toBeLessThan(0.9);
    expect(kf[2]!.cx).toBeGreaterThan(kf[1]!.cx);
  });

  it("holds position on 'none' samples instead of snapping back to center", () => {
    const kf = smoothPath([
      { ms: 0, cx: 0.8, cy: 0.5, source: 'face' },
      { ms: 500, cx: 0.5, cy: 0.5, source: 'none' },
      { ms: 1000, cx: 0.5, cy: 0.5, source: 'none' },
    ]);
    expect(kf[1]!.cx).toBe(0.8);
    expect(kf[2]!.cx).toBe(0.8);
  });

  it('weights motion samples at half the face strength', () => {
    const face = smoothPath([
      { ms: 0, cx: 0.5, cy: 0.5, source: 'face' },
      { ms: 500, cx: 1, cy: 0.5, source: 'face' },
    ]);
    const motion = smoothPath([
      { ms: 0, cx: 0.5, cy: 0.5, source: 'face' },
      { ms: 500, cx: 1, cy: 0.5, source: 'motion' },
    ]);
    // Keyframes are rounded to 3 decimals, so compare at 2-decimal precision
    expect(motion[1]!.cx - 0.5).toBeCloseTo((face[1]!.cx - 0.5) / 2, 2);
  });

  it('falls back to a single centered keyframe for empty input', () => {
    expect(smoothPath([])).toEqual([{ ms: 0, cx: 0.5, cy: 0.5 }]);
  });
});

describe('cxAt', () => {
  const kf: ReframeKeyframe[] = [
    { ms: 0, cx: 0.2, cy: 0.5 },
    { ms: 1000, cx: 0.8, cy: 0.5 },
  ];

  it('interpolates linearly between keyframes', () => {
    expect(cxAt(kf, 500)).toBeCloseTo(0.5);
  });

  it('clamps before the first and after the last keyframe', () => {
    expect(cxAt(kf, -100)).toBe(0.2);
    expect(cxAt(kf, 5000)).toBe(0.8);
  });

  it('returns center for an empty path', () => {
    expect(cxAt([], 100)).toBe(0.5);
  });
});

describe('resampleRange', () => {
  it('produces evenly spaced control points over the range', () => {
    const kf: ReframeKeyframe[] = [
      { ms: 0, cx: 0, cy: 0.5 },
      { ms: 1000, cx: 1, cy: 0.5 },
    ];
    const pts = resampleRange(kf, 0, 1000, 5);
    expect(pts.map((p) => p.ms)).toEqual([0, 250, 500, 750, 1000]);
    expect(pts.map((p) => p.cx)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

describe('buildCxExpr', () => {
  it('returns a plain constant when the subject does not move', () => {
    const kf: ReframeKeyframe[] = [{ ms: 0, cx: 0.7, cy: 0.5 }];
    expect(buildCxExpr(kf, 0, 10_000)).toBe('0.700');
  });

  it('builds a clamped piecewise-linear expression when the subject moves', () => {
    const kf: ReframeKeyframe[] = [
      { ms: 0, cx: 0.3, cy: 0.5 },
      { ms: 10_000, cx: 0.7, cy: 0.5 },
    ];
    const expr = buildCxExpr(kf, 0, 10_000, 3);
    expect(expr).toMatch(/^clip\(/);
    expect(expr).toContain('if(lt(t,');
    // Segment-relative seconds: last control point at 10s
    expect(expr).toContain('10.000');
  });

  it('uses segment-relative time for mid-clip segments', () => {
    const kf: ReframeKeyframe[] = [
      { ms: 5000, cx: 0.2, cy: 0.5 },
      { ms: 8000, cx: 0.8, cy: 0.5 },
    ];
    // Segment covering clip time 5s..8s → expression t runs 0..3
    const expr = buildCxExpr(kf, 5000, 8000, 2);
    expect(expr).toContain('(t-0.000)');
    expect(expr).toContain('lt(t,3.000)');
    expect(expr).not.toContain('lt(t,8.000)');
  });

  it('never emits an unquotable character set (only expr-safe tokens)', () => {
    const kf: ReframeKeyframe[] = [
      { ms: 0, cx: 0.1, cy: 0.5 },
      { ms: 2000, cx: 0.9, cy: 0.5 },
      { ms: 4000, cx: 0.4, cy: 0.5 },
    ];
    const expr = buildCxExpr(kf, 0, 4000);
    // Everything the ffmpeg expression parser accepts inside a quoted option
    expect(expr).toMatch(/^[\w+\-*/().,<>=]+$/);
    expect(expr).not.toContain("'");
  });
});
