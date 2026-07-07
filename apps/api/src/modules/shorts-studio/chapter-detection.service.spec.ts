import { normalizeChapters } from './chapter-detection.service';
import type { ChapterCandidate } from '@cf/shared';

const cand = (startMs: number, overrides: Partial<ChapterCandidate> = {}): ChapterCandidate => ({
  startMs,
  title: `Chapter at ${startMs}`,
  summary: 'summary',
  keyPoints: [],
  confidence: 0.8,
  ...overrides,
});

describe('normalizeChapters', () => {
  const topicStarts = [0, 30_000, 95_000, 180_000, 240_000];
  const durationMs = 300_000;

  it('produces a contiguous partition ending at the video duration', () => {
    const out = normalizeChapters([cand(0), cand(95_000), cand(240_000)], topicStarts, durationMs);
    expect(out.map((c) => [c.startMs, c.endMs])).toEqual([
      [0, 95_000],
      [95_000, 240_000],
      [240_000, 300_000],
    ]);
  });

  it('snaps boundaries to the nearest topic-segment start', () => {
    const out = normalizeChapters([cand(0), cand(97_500), cand(238_000)], topicStarts, durationMs);
    expect(out.map((c) => c.startMs)).toEqual([0, 95_000, 240_000]);
  });

  it('anchors the first chapter to 0 even when the model starts later', () => {
    const out = normalizeChapters([cand(30_000), cand(180_000)], topicStarts, durationMs);
    expect(out[0]!.startMs).toBe(0);
    expect(out[0]!.endMs).toBe(180_000);
  });

  it('sorts chapters returned out of order', () => {
    const out = normalizeChapters([cand(180_000), cand(0), cand(95_000)], topicStarts, durationMs);
    expect(out.map((c) => c.startMs)).toEqual([0, 95_000, 180_000]);
  });

  it('merges boundaries closer than 10s, keeping higher-confidence metadata', () => {
    // 30_000 and 35_000 both snap near each other; 35_000 → nearest 30_000 so
    // they collide exactly; higher-confidence title must survive on the earlier start
    const out = normalizeChapters(
      [cand(0), cand(30_000, { confidence: 0.5, title: 'weak' }), cand(35_000, { confidence: 0.9, title: 'strong' })],
      topicStarts,
      durationMs,
    );
    expect(out).toHaveLength(2);
    expect(out[1]!.startMs).toBe(30_000);
    expect(out[1]!.title).toBe('strong');
  });

  it('folds a too-short tail chapter into the previous one', () => {
    const out = normalizeChapters([cand(0), cand(295_000)], [0, 295_000], durationMs);
    expect(out).toHaveLength(1);
    expect(out[0]!.endMs).toBe(durationMs);
  });

  it('clamps out-of-range boundaries into the video', () => {
    const out = normalizeChapters([cand(0), cand(999_999_999)], topicStarts, durationMs);
    expect(out.every((c) => c.startMs < durationMs && c.endMs <= durationMs)).toBe(true);
  });

  it('returns empty for empty input or zero duration', () => {
    expect(normalizeChapters([], topicStarts, durationMs)).toEqual([]);
    expect(normalizeChapters([cand(0)], topicStarts, 0)).toEqual([]);
  });
});
