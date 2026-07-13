import {
  movingAverageForecast,
  linearForecast,
  churnRate,
  bucketByPeriod,
  northStarRate,
} from './bi.service';

// ── movingAverageForecast ─────────────────────────────────────────────────────

describe('movingAverageForecast', () => {
  it('returns zeros for an empty points array', () => {
    expect(movingAverageForecast([], 1)).toEqual({ value: 0, low: 0, high: 0 });
  });

  it('returns zeros for an empty points array with larger horizon', () => {
    expect(movingAverageForecast([], 6)).toEqual({ value: 0, low: 0, high: 0 });
  });

  it('produces a zero-width interval for a constant series (zero stddev)', () => {
    // All points the same → stddev = 0 → low === high === value
    const result = movingAverageForecast([100, 100, 100, 100], 1);
    expect(result.value).toBeCloseTo(100);
    expect(result.low).toBeCloseTo(100);
    expect(result.high).toBeCloseTo(100);
  });

  it('computes the correct mean for a known series', () => {
    // Last 4 of [10, 20, 30, 40, 50] = [20, 30, 40, 50] → window capped at min(6,5)=5
    // window = [10, 20, 30, 40, 50], mean = 30
    const result = movingAverageForecast([10, 20, 30, 40, 50], 1);
    expect(result.value).toBeCloseTo(30);
  });

  it('uses at most the last 6 points', () => {
    // 8 points: last 6 = [3,4,5,6,7,8], mean = 5.5
    const result = movingAverageForecast([1, 2, 3, 4, 5, 6, 7, 8], 1);
    expect(result.value).toBeCloseTo(5.5);
  });

  it('scales value by horizon period', () => {
    // constant [10,10,10], mean=10, horizon=3 → value=30
    const result = movingAverageForecast([10, 10, 10], 3);
    expect(result.value).toBeCloseTo(30);
    // zero stddev → low = max(0, 30-0) = 30, high = 30
    expect(result.low).toBeCloseTo(30);
    expect(result.high).toBeCloseTo(30);
  });

  it('confidence band widens with higher horizon', () => {
    const narrow = movingAverageForecast([10, 20, 30], 1);
    const wide = movingAverageForecast([10, 20, 30], 4);
    expect(wide.high - wide.value).toBeGreaterThan(narrow.high - narrow.value);
  });

  it('low is never negative', () => {
    // Very high stddev relative to mean → without clamping low could go negative
    const result = movingAverageForecast([0, 0, 1000], 1);
    expect(result.low).toBeGreaterThanOrEqual(0);
  });

  it('single-point series returns value = point (no stddev available)', () => {
    const result = movingAverageForecast([42], 1);
    expect(result.value).toBeCloseTo(42);
    expect(result.low).toBeCloseTo(42);
    expect(result.high).toBeCloseTo(42);
  });
});

// ── linearForecast ────────────────────────────────────────────────────────────

describe('linearForecast', () => {
  it('returns 0 for an empty points array', () => {
    expect(linearForecast([], 5)).toEqual({ value: 0, low: 0, high: 0 });
  });

  it('returns last y value for a single point', () => {
    expect(linearForecast([{ x: 0, y: 77 }], 10)).toEqual({ value: 77, low: 77, high: 77 });
  });

  it('fits a perfect line exactly', () => {
    // y = 2x → at x=4, y should be 8
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
    ];
    const result = linearForecast(points, 4);
    expect(result.value).toBeCloseTo(8);
    // Perfect fit → residual stddev = 0 → zero-width interval
    expect(result.low).toBeCloseTo(8);
    expect(result.high).toBeCloseTo(8);
  });

  it('produces a non-trivial confidence band on imperfect data', () => {
    const points = [
      { x: 0, y: 10 },
      { x: 1, y: 15 },
      { x: 2, y: 9 },  // noisy
      { x: 3, y: 20 },
    ];
    const result = linearForecast(points, 4);
    // There should be some non-zero margin
    expect(result.high).toBeGreaterThan(result.value);
    expect(result.low).toBeLessThan(result.value);
  });

  it('low is never negative', () => {
    const points = [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ];
    const result = linearForecast(points, 100);
    expect(result.low).toBeGreaterThanOrEqual(0);
  });

  it('handles two-point perfect line', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 5 }];
    const result = linearForecast(points, 2);
    expect(result.value).toBeCloseTo(10);
  });
});

// ── churnRate ─────────────────────────────────────────────────────────────────

describe('churnRate', () => {
  it('returns 0 when activeStart is 0 (no denominator)', () => {
    expect(churnRate(0, 0)).toBe(0);
    expect(churnRate(0, 10)).toBe(0);
  });

  it('computes the correct fraction', () => {
    expect(churnRate(100, 10)).toBeCloseTo(0.1);
  });

  it('clamps to 1 when lost > activeStart', () => {
    expect(churnRate(10, 20)).toBe(1);
  });

  it('returns 0 when no one was lost', () => {
    expect(churnRate(100, 0)).toBe(0);
  });

  it('returns exactly 1 when all were lost', () => {
    expect(churnRate(50, 50)).toBe(1);
  });
});

// ── northStarRate ─────────────────────────────────────────────────────────────

describe('northStarRate', () => {
  it('returns 0 when there are no active channels (no denominator)', () => {
    expect(northStarRate(0, 0)).toBe(0);
    expect(northStarRate(12, 0)).toBe(0);
  });

  it('computes published videos per active channel', () => {
    expect(northStarRate(12, 4)).toBeCloseTo(3);
    expect(northStarRate(5, 2)).toBeCloseTo(2.5);
  });

  it('returns 0 when nothing was published', () => {
    expect(northStarRate(0, 7)).toBe(0);
  });

  it('supports rates below one video per channel', () => {
    expect(northStarRate(1, 4)).toBeCloseTo(0.25);
  });
});

// ── bucketByPeriod ────────────────────────────────────────────────────────────

describe('bucketByPeriod', () => {
  // Use a fixed reference point: 2026-07-11T00:00:00.000Z
  const now = new Date('2026-07-11T00:00:00.000Z');
  const dayMs = 24 * 60 * 60 * 1000;

  it('returns an array of the right length filled with zeros when no rows', () => {
    const result = bucketByPeriod([], 30, 6, now);
    expect(result).toHaveLength(6);
    expect(result.every((v) => v === 0)).toBe(true);
  });

  it('assigns a row to the correct bucket based on its timestamp', () => {
    // 3 periods × 30 days each, ending at `now`
    // Period 0 (oldest): [now - 90d, now - 60d)
    // Period 1:          [now - 60d, now - 30d)
    // Period 2 (newest): [now - 30d, now]

    // Place one row in each period
    const rows = [
      { at: new Date(now.getTime() - 75 * dayMs), amount: 10 }, // bucket 0
      { at: new Date(now.getTime() - 45 * dayMs), amount: 20 }, // bucket 1
      { at: new Date(now.getTime() - 10 * dayMs), amount: 30 }, // bucket 2
    ];

    const result = bucketByPeriod(rows, 30, 3, now);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(20);
    expect(result[2]).toBe(30);
  });

  it('ignores rows outside the total range', () => {
    // Row 200 days ago is outside 6×30=180 day window
    const rows = [
      { at: new Date(now.getTime() - 200 * dayMs), amount: 999 }, // out of range
      { at: new Date(now.getTime() - 10 * dayMs), amount: 5 },    // in range
    ];
    const result = bucketByPeriod(rows, 30, 6, now);
    expect(result[5]).toBe(5); // newest bucket
    expect(result[0]).toBe(0); // oldest bucket — the out-of-range row is ignored
  });

  it('sums multiple rows in the same bucket', () => {
    const rows = [
      { at: new Date(now.getTime() - 5 * dayMs), amount: 7 },
      { at: new Date(now.getTime() - 3 * dayMs), amount: 3 },
    ];
    const result = bucketByPeriod(rows, 30, 3, now);
    // Both rows fall in the newest (last) bucket
    expect(result[2]).toBe(10);
  });

  it('oldest-first ordering: bucket 0 is the oldest period', () => {
    // Single row at the very start of the range
    const rangeStartMs = now.getTime() - 3 * 30 * dayMs;
    const rows = [{ at: new Date(rangeStartMs + dayMs), amount: 42 }];
    const result = bucketByPeriod(rows, 30, 3, now);
    expect(result[0]).toBe(42);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
  });
});
