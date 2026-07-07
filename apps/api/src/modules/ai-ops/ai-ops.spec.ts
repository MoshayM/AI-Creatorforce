import { resolveRule } from './pricing.service';
import { computeMargin } from './profit-guard.service';

const base = { isActive: true, effectiveFrom: new Date('2026-01-01'), effectiveTo: null };
const rule = (over: Partial<Parameters<typeof resolveRule>[0][number]> & { creditCost: number }) => ({
  action: 'chat', model: null, provider: null, plan: null, priority: 0, ...base, ...over,
});

describe('resolveRule — Phase 5 §7 most-specific-wins', () => {
  const now = new Date('2026-07-07');

  it('prefers plan+model over model over action default', () => {
    const rules = [
      rule({ creditCost: 10 }),
      rule({ creditCost: 8, model: 'claude-sonnet-4-6' }),
      rule({ creditCost: 5, model: 'claude-sonnet-4-6', plan: 'PRO' }),
    ];
    expect(resolveRule(rules, { action: 'chat', model: 'claude-sonnet-4-6', plan: 'PRO' }, now)!.creditCost).toBe(5);
    expect(resolveRule(rules, { action: 'chat', model: 'claude-sonnet-4-6', plan: 'FREE' }, now)!.creditCost).toBe(8);
    expect(resolveRule(rules, { action: 'chat' }, now)!.creditCost).toBe(10);
  });

  it('a non-null matcher must match — no partial credit', () => {
    const rules = [rule({ creditCost: 8, model: 'gpt-4o' })];
    expect(resolveRule(rules, { action: 'chat', model: 'claude-sonnet-4-6' }, now)).toBeNull();
  });

  it('respects effective windows and isActive', () => {
    const rules = [
      rule({ creditCost: 3, effectiveTo: new Date('2026-06-01') }),
      rule({ creditCost: 4, isActive: false }),
      rule({ creditCost: 7, effectiveFrom: new Date('2026-08-01') }),
    ];
    expect(resolveRule(rules, { action: 'chat' }, now)).toBeNull();
  });

  it('breaks specificity ties by priority', () => {
    const rules = [rule({ creditCost: 9, priority: 1 }), rule({ creditCost: 12, priority: 5 })];
    expect(resolveRule(rules, { action: 'chat' }, now)!.creditCost).toBe(12);
  });
});

describe('computeMargin — Phase 5 §8 fail-closed margin guard', () => {
  it('allows at or above the minimum margin, rejects below', () => {
    // 100 credits @ 100/USD = $1 net; $0.60 cost → 40% margin
    expect(computeMargin({ creditCost: 100, expectedProviderCostUsd: 0.6, creditsPerUsd: 100, minMargin: 0.3 }).allow).toBe(true);
    expect(computeMargin({ creditCost: 100, expectedProviderCostUsd: 0.6, creditsPerUsd: 100, minMargin: 0.5 }).allow).toBe(false);
  });

  it('boundary: exactly the minimum margin passes', () => {
    const v = computeMargin({ creditCost: 100, expectedProviderCostUsd: 0.7, creditsPerUsd: 100, minMargin: 0.3 });
    expect(v.margin).toBeCloseTo(0.3, 6);
    expect(v.allow).toBe(true);
  });

  it('never sells below cost', () => {
    expect(computeMargin({ creditCost: 10, expectedProviderCostUsd: 0.2, creditsPerUsd: 100, minMargin: 0 }).allow).toBe(false);
  });

  it('fails closed on zero/invalid net value or unknown (Infinity) cost', () => {
    expect(computeMargin({ creditCost: 0, expectedProviderCostUsd: 0.1, creditsPerUsd: 100, minMargin: 0.3 }).allow).toBe(false);
    expect(computeMargin({ creditCost: 100, expectedProviderCostUsd: Number.POSITIVE_INFINITY, creditsPerUsd: 100, minMargin: 0.3 }).allow).toBe(false);
  });
});
