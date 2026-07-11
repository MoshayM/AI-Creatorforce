import { burnForecast, buildRecommendations, type BurnForecast } from './credit-insights.service';

// ── burnForecast ──────────────────────────────────────────────────────────────

describe('burnForecast', () => {
  // Mid-month UTC so month-end projection has a stable remaining-days window.
  const now = new Date('2026-07-15T00:00:00Z');

  it('computes daily burn from the window average of absolute debit amounts', () => {
    // 300 credits over 30 days → 10/day (ledger debits are negative)
    const f = burnForecast({
      balance: 100,
      debits: [{ amount: -200 }, { amount: -100 }],
      monthSpentSoFar: 140,
      now,
    });
    expect(f.totalDebited).toBe(300);
    expect(f.dailyBurn).toBe(10);
  });

  it('projects days-to-empty and the empty date', () => {
    const f = burnForecast({
      balance: 100,
      debits: [{ amount: -300 }],
      monthSpentSoFar: 0,
      now,
    });
    expect(f.daysToEmpty).toBe(10);
    expect(f.emptyOn).toBe('2026-07-25');
  });

  it('returns null days-to-empty when there is no burn', () => {
    const f = burnForecast({ balance: 500, debits: [], monthSpentSoFar: 0, now });
    expect(f.daysToEmpty).toBeNull();
    expect(f.emptyOn).toBeNull();
    expect(f.dailyBurn).toBe(0);
  });

  it('returns null days-to-empty when the balance is already zero', () => {
    const f = burnForecast({ balance: 0, debits: [{ amount: -30 }], monthSpentSoFar: 0, now });
    expect(f.daysToEmpty).toBeNull();
  });

  it('projects month-end spend as month-to-date + burn × remaining days', () => {
    // 10/day, 17 days left in July from the 15th → 140 + 170 = 310
    const f = burnForecast({
      balance: 1000,
      debits: [{ amount: -300 }],
      monthSpentSoFar: 140,
      now,
    });
    expect(f.projectedMonthEndSpend).toBe(310);
  });

  it('respects a custom window', () => {
    const f = burnForecast({
      balance: 100,
      debits: [{ amount: -70 }],
      monthSpentSoFar: 0,
      now,
      windowDays: 7,
    });
    expect(f.windowDays).toBe(7);
    expect(f.dailyBurn).toBe(10);
  });
});

// ── buildRecommendations ──────────────────────────────────────────────────────

describe('buildRecommendations', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  const idleForecast: BurnForecast = {
    windowDays: 30, totalDebited: 0, dailyBurn: 0, balance: 500,
    daysToEmpty: null, emptyOn: null, projectedMonthEndSpend: 0,
  };
  const base = {
    forecast: idleForecast,
    budget: { monthlyLimit: 0, spent: 0, hardCap: false },
    byAction: [] as Array<{ action: string; credits: number }>,
    cacheHitRate: null as number | null,
    copilotTurns: 0,
    expiringLots: [] as Array<{ remaining: number; expiresAt: Date }>,
    now,
  };

  it('is empty for an idle wallet with no history', () => {
    expect(buildRecommendations(base)).toEqual([]);
  });

  it('warns when balance runs out within 7 days', () => {
    const recs = buildRecommendations({
      ...base,
      forecast: { ...idleForecast, totalDebited: 300, dailyBurn: 10, balance: 50, daysToEmpty: 5, emptyOn: '2026-07-20' },
    });
    expect(recs.some((r) => r.type === 'LOW_BALANCE' && r.severity === 'warning')).toBe(true);
  });

  it('does not warn when the balance covers more than 7 days', () => {
    const recs = buildRecommendations({
      ...base,
      forecast: { ...idleForecast, totalDebited: 300, dailyBurn: 10, balance: 500, daysToEmpty: 50, emptyOn: '2026-09-03' },
    });
    expect(recs.some((r) => r.type === 'LOW_BALANCE')).toBe(false);
  });

  it('warns when the projection exceeds the monthly budget', () => {
    const recs = buildRecommendations({
      ...base,
      forecast: { ...idleForecast, totalDebited: 300, dailyBurn: 10, projectedMonthEndSpend: 310 },
      budget: { monthlyLimit: 250, spent: 140, hardCap: true },
    });
    const pace = recs.find((r) => r.type === 'BUDGET_PACE');
    expect(pace?.severity).toBe('warning');
    expect(pace?.meta?.['over']).toBe(60);
  });

  it('flags credits expiring within 7 days and ignores later ones', () => {
    const recs = buildRecommendations({
      ...base,
      expiringLots: [
        { remaining: 40, expiresAt: new Date('2026-07-18T00:00:00Z') },
        { remaining: 60, expiresAt: new Date('2026-08-30T00:00:00Z') },
      ],
    });
    const exp = recs.find((r) => r.type === 'EXPIRING_CREDITS');
    expect(exp?.meta?.['expiring']).toBe(40);
  });

  it('suggests a budget only when there is spend and no budget', () => {
    const spending = { ...idleForecast, totalDebited: 100, dailyBurn: 3.33 };
    expect(
      buildRecommendations({ ...base, forecast: spending }).some((r) => r.type === 'NO_BUDGET'),
    ).toBe(true);
    expect(
      buildRecommendations({
        ...base,
        forecast: spending,
        budget: { monthlyLimit: 500, spent: 100, hardCap: false },
      }).some((r) => r.type === 'NO_BUDGET'),
    ).toBe(false);
  });

  it('flags a dominant action at ≥50% share with ≥50 total credits', () => {
    const recs = buildRecommendations({
      ...base,
      byAction: [
        { action: 'video.analyze', credits: 80 },
        { action: 'chat', credits: 20 },
      ],
    });
    const top = recs.find((r) => r.type === 'TOP_ACTION');
    expect(top?.meta?.['action']).toBe('video.analyze');
  });

  it('ignores a dominant action when total spend is trivial (< 50 credits)', () => {
    const recs = buildRecommendations({
      ...base,
      byAction: [{ action: 'chat', credits: 30 }],
    });
    expect(recs.some((r) => r.type === 'TOP_ACTION')).toBe(false);
  });

  it('flags a low cache-hit rate only with enough turns', () => {
    expect(
      buildRecommendations({ ...base, cacheHitRate: 0.1, copilotTurns: 25 })
        .some((r) => r.type === 'LOW_CACHE_HIT'),
    ).toBe(true);
    expect(
      buildRecommendations({ ...base, cacheHitRate: 0.1, copilotTurns: 5 })
        .some((r) => r.type === 'LOW_CACHE_HIT'),
    ).toBe(false);
    expect(
      buildRecommendations({ ...base, cacheHitRate: 0.85, copilotTurns: 100 })
        .some((r) => r.type === 'LOW_CACHE_HIT'),
    ).toBe(false);
  });
});
