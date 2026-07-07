import { planSmallVideos } from './small-video-generation.service';

const ch = (id: string, startMs: number, endMs: number) => ({ id, title: id, startMs, endMs });

describe('planSmallVideos', () => {
  const MAX = 600_000;

  it('plans one video per chapter spanning the chapter range', () => {
    const { plans, skippedTooShort } = planSmallVideos(
      [ch('a', 0, 120_000), ch('b', 120_000, 420_000)],
      MAX,
    );
    expect(skippedTooShort).toBe(0);
    expect(plans).toEqual([
      { chapterId: 'a', title: 'a', sourceStartMs: 0, sourceEndMs: 120_000 },
      { chapterId: 'b', title: 'b', sourceStartMs: 120_000, sourceEndMs: 420_000 },
    ]);
  });

  it('skips chapters under 60s instead of producing degenerate videos', () => {
    const { plans, skippedTooShort } = planSmallVideos(
      [ch('intro', 0, 45_000), ch('body', 45_000, 200_000)],
      MAX,
    );
    expect(skippedTooShort).toBe(1);
    expect(plans.map((p) => p.chapterId)).toEqual(['body']);
  });

  it('clips chapters longer than the cap to 10 minutes from their start', () => {
    const { plans } = planSmallVideos([ch('long', 100_000, 1_000_000)], MAX);
    expect(plans[0]).toMatchObject({ sourceStartMs: 100_000, sourceEndMs: 700_000 });
  });

  it('returns empty for no chapters', () => {
    expect(planSmallVideos([], MAX)).toEqual({ plans: [], skippedTooShort: 0 });
  });
});
