import type { ShortsTimelineItem } from '@prisma/client';
import { videoSpans, sourceRangeToTimeline } from './timeline-map.util';
import { CLIP_TYPE_PRESETS } from './clip-type-presets';

function item(startMs: number, endMs: number, sourceStartMs?: number): ShortsTimelineItem {
  return {
    id: `i-${startMs}`,
    trackId: 't1',
    startMs,
    endMs,
    sourceAssetId: null,
    cropRect: null,
    rotationDeg: 0,
    speed: 1,
    volume: 1,
    properties: sourceStartMs === undefined ? null : { sourceStartMs },
  } as ShortsTimelineItem;
}

describe('videoSpans', () => {
  it('derives source spans from item bounds + sourceStartMs (speed 1)', () => {
    const spans = videoSpans([item(0, 5_000, 60_000)]);
    expect(spans).toEqual([
      { timelineStartMs: 0, timelineEndMs: 5_000, sourceStartMs: 60_000, sourceEndMs: 65_000 },
    ]);
  });

  it('skips items without a source mapping and sorts by timeline position', () => {
    const spans = videoSpans([item(10_000, 12_000, 90_000), item(0, 5_000, 60_000), item(5_000, 10_000)]);
    expect(spans.map((s) => s.timelineStartMs)).toEqual([0, 10_000]);
  });
});

describe('sourceRangeToTimeline', () => {
  // Timeline: [0–5s ← src 60–65s] [5–8s ← src 80–83s] (a cut removed 65–80s)
  const spans = videoSpans([item(0, 5_000, 60_000), item(5_000, 8_000, 80_000)]);

  it('maps a source range inside one span', () => {
    expect(sourceRangeToTimeline(spans, 61_000, 62_000)).toEqual([{ startMs: 1_000, endMs: 2_000 }]);
  });

  it('clamps a range that straddles a span boundary', () => {
    expect(sourceRangeToTimeline(spans, 64_000, 66_000)).toEqual([{ startMs: 4_000, endMs: 5_000 }]);
  });

  it('returns [] for source time that was cut out', () => {
    expect(sourceRangeToTimeline(spans, 70_000, 75_000)).toEqual([]);
  });

  it('returns multiple ranges when the source appears in multiple spans', () => {
    const dup = videoSpans([item(0, 5_000, 60_000), item(5_000, 10_000, 60_000)]);
    expect(sourceRangeToTimeline(dup, 61_000, 62_000)).toEqual([
      { startMs: 1_000, endMs: 2_000 },
      { startMs: 6_000, endMs: 7_000 },
    ]);
  });

  it('maps a range spanning the cut into both surviving sides', () => {
    expect(sourceRangeToTimeline(spans, 64_000, 81_000)).toEqual([
      { startMs: 4_000, endMs: 5_000 },
      { startMs: 5_000, endMs: 6_000 },
    ]);
  });
});

describe('CLIP_TYPE_PRESETS', () => {
  it('covers every ClipType with sane constraints', () => {
    for (const [type, preset] of Object.entries(CLIP_TYPE_PRESETS)) {
      expect(['9:16', '1:1', '16:9']).toContain(preset.aspect);
      expect(preset.maxDurationMs).toBeGreaterThanOrEqual(60_000);
      // Short-form platform caps; SMALL_VIDEO is long-form by design (§10)
      expect(preset.maxDurationMs).toBeLessThanOrEqual(type === 'SMALL_VIDEO' ? 600_000 : 180_000);
      expect(preset.safeZone.bottom).toBeGreaterThanOrEqual(0);
      expect(preset.safeZone.bottom).toBeLessThan(0.3);
      expect(type).toBeTruthy();
    }
  });

  it('keeps YouTube Shorts within the 60s hard limit', () => {
    expect(CLIP_TYPE_PRESETS.YOUTUBE_SHORTS.maxDurationMs).toBe(60_000);
    expect(CLIP_TYPE_PRESETS.YOUTUBE_SHORTS.aspect).toBe('9:16');
  });

  it('keeps small videos horizontal and within the 10-minute cap', () => {
    expect(CLIP_TYPE_PRESETS.SMALL_VIDEO.aspect).toBe('16:9');
    expect(CLIP_TYPE_PRESETS.SMALL_VIDEO.maxDurationMs).toBe(600_000);
  });
});
