import { monthWindow, budgetStatus, wouldExceed, type BudgetStatus } from './budget.service';

// ── monthWindow ───────────────────────────────────────────────────────────────

describe('monthWindow', () => {
  it('returns start of January and start of February for a mid-January date', () => {
    const { start, end } = monthWindow(new Date('2026-01-15T12:00:00Z'));
    expect(start).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(end).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('handles Jan 31 → the end is Feb 1 UTC', () => {
    const { start, end } = monthWindow(new Date('2026-01-31T23:59:59Z'));
    expect(start).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(end).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('handles year rollover: Dec 31 → next January', () => {
    const { start, end } = monthWindow(new Date('2025-12-31T00:00:00Z'));
    expect(start).toEqual(new Date('2025-12-01T00:00:00Z'));
    expect(end).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('handles Feb 28 in a non-leap year → March 1', () => {
    const { start, end } = monthWindow(new Date('2025-02-28T00:00:00Z'));
    expect(start).toEqual(new Date('2025-02-01T00:00:00Z'));
    expect(end).toEqual(new Date('2025-03-01T00:00:00Z'));
  });
});

// ── budgetStatus ──────────────────────────────────────────────────────────────

describe('budgetStatus', () => {
  it('returns NONE when limit is 0', () => {
    expect(budgetStatus(0, 0, 80)).toBe('NONE');
    expect(budgetStatus(0, 9999, 80)).toBe('NONE');
  });

  it('returns NONE when limit is negative', () => {
    expect(budgetStatus(-1, 0, 80)).toBe('NONE');
  });

  it('returns EXCEEDED when spent equals limit', () => {
    expect(budgetStatus(100, 100, 80)).toBe('EXCEEDED');
  });

  it('returns EXCEEDED when spent exceeds limit', () => {
    expect(budgetStatus(100, 150, 80)).toBe('EXCEEDED');
  });

  it('returns ALERT when spent/limit*100 equals alertThreshold exactly', () => {
    // 80/100*100 = 80 = alertThreshold
    expect(budgetStatus(100, 80, 80)).toBe('ALERT');
  });

  it('returns ALERT when spend is above threshold but below limit', () => {
    expect(budgetStatus(100, 90, 80)).toBe('ALERT');
  });

  it('returns OK when spend is below threshold', () => {
    expect(budgetStatus(100, 50, 80)).toBe('OK');
  });

  it('returns OK when spend is 0', () => {
    expect(budgetStatus(1000, 0, 80)).toBe('OK');
  });

  // matrix: all four status values
  const cases: [number, number, number, BudgetStatus][] = [
    [0,   0,   80, 'NONE'],
    [100, 0,   80, 'OK'],
    [100, 79,  80, 'OK'],
    [100, 80,  80, 'ALERT'],
    [100, 99,  80, 'ALERT'],
    [100, 100, 80, 'EXCEEDED'],
    [100, 200, 80, 'EXCEEDED'],
  ];
  it.each(cases)('budgetStatus(%i, %i, %i) → %s', (limit, spent, threshold, expected) => {
    expect(budgetStatus(limit, spent, threshold)).toBe(expected);
  });
});

// ── wouldExceed ───────────────────────────────────────────────────────────────

describe('wouldExceed', () => {
  it('returns false when limit is 0 (no budget)', () => {
    expect(wouldExceed(0, 0, 1000)).toBe(false);
  });

  it('returns false when limit is negative', () => {
    expect(wouldExceed(-1, 0, 1000)).toBe(false);
  });

  it('returns true when spent + nextCost exceeds limit', () => {
    expect(wouldExceed(100, 90, 20)).toBe(true);
  });

  it('returns false when spent + nextCost equals limit exactly (boundary)', () => {
    // equal is NOT exceeding
    expect(wouldExceed(100, 80, 20)).toBe(false);
  });

  it('returns false when spent + nextCost is below limit', () => {
    expect(wouldExceed(100, 50, 40)).toBe(false);
  });

  it('returns true when nextCost alone exceeds limit', () => {
    expect(wouldExceed(100, 0, 101)).toBe(true);
  });

  it('returns false when nextCost is 0', () => {
    expect(wouldExceed(100, 100, 0)).toBe(false);
  });
});
