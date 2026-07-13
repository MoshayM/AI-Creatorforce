import { BadRequestException } from '@nestjs/common';
import { compareLotsForTimeline, creditsForCost, lotTtlDays, planDebit, planLotDebit, type BucketBalances, type LotView } from './wallet.service';

const buckets = (p: number, b: number, r: number, pur: number, trial = 0): BucketBalances => ({
  trialCredits: trial,
  promotionalCredits: p,
  bonusCredits: b,
  referralCredits: r,
  purchasedCredits: pur,
});

describe('planDebit — §5.4 spend priority (promo → bonus → referral → purchased)', () => {
  it('drains buckets in priority order', () => {
    expect(planDebit(buckets(10, 10, 10, 100), 25)).toEqual({
      trialCredits: 0,
      promotionalCredits: 10,
      bonusCredits: 10,
      referralCredits: 5,
      purchasedCredits: 0,
    });
  });

  it('consumes trial credits before everything else (Phase 6 §5)', () => {
    expect(planDebit(buckets(10, 0, 0, 100, 30), 35)).toEqual({
      trialCredits: 30,
      promotionalCredits: 5,
      bonusCredits: 0,
      referralCredits: 0,
      purchasedCredits: 0,
    });
  });

  it('touches purchased credits only after all cheaper buckets are empty', () => {
    expect(planDebit(buckets(0, 0, 0, 50), 20)).toEqual({
      trialCredits: 0,
      promotionalCredits: 0,
      bonusCredits: 0,
      referralCredits: 0,
      purchasedCredits: 20,
    });
  });

  it('drains an exact full balance to zero', () => {
    const split = planDebit(buckets(5, 5, 5, 5), 20);
    expect(Object.values(split).reduce((s, n) => s + n, 0)).toBe(20);
  });

  it('fails closed on insufficient total credits', () => {
    expect(() => planDebit(buckets(1, 1, 1, 1), 5)).toThrow(BadRequestException);
    expect(() => planDebit(buckets(1, 1, 1, 1), 5)).toThrow('INSUFFICIENT_CREDITS');
  });

  it('rejects zero, negative, and fractional amounts', () => {
    expect(() => planDebit(buckets(10, 0, 0, 0), 0)).toThrow(BadRequestException);
    expect(() => planDebit(buckets(10, 0, 0, 0), -3)).toThrow(BadRequestException);
    expect(() => planDebit(buckets(10, 0, 0, 0), 1.5)).toThrow(BadRequestException);
  });
});

describe('planLotDebit — §5.4 lot consumption (bucket priority, soonest-expiry first)', () => {
  const now = new Date('2026-07-07T00:00:00Z');
  const lot = (id: string, bucket: string, remaining: number, expiresAt: Date | null): LotView => ({ id, bucket, remaining, expiresAt });
  const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60_000);

  it('consumes cheaper buckets before purchased regardless of expiry', () => {
    const takes = planLotDebit(
      [lot('pur', 'purchasedCredits', 100, null), lot('promo', 'promotionalCredits', 10, days(5))],
      15, now,
    );
    expect(takes).toEqual([
      { lotId: 'promo', bucket: 'promotionalCredits', take: 10 },
      { lotId: 'pur', bucket: 'purchasedCredits', take: 5 },
    ]);
  });

  it('drains the soonest-expiring lot first within a bucket, never-expiring last', () => {
    const takes = planLotDebit(
      [
        lot('b-never', 'bonusCredits', 50, null),
        lot('b-late', 'bonusCredits', 50, days(30)),
        lot('b-soon', 'bonusCredits', 50, days(2)),
      ],
      120, now,
    );
    expect(takes.map((t) => t.lotId)).toEqual(['b-soon', 'b-late', 'b-never']);
  });

  it('treats already-expired lots as unspendable even before the sweep', () => {
    expect(() => planLotDebit([lot('dead', 'bonusCredits', 100, days(-1))], 1, now))
      .toThrow('INSUFFICIENT_CREDITS');
  });

  it('fails closed when live lots cannot cover the amount', () => {
    expect(() => planLotDebit([lot('a', 'purchasedCredits', 5, null)], 6, now))
      .toThrow('INSUFFICIENT_CREDITS');
  });
});

describe('lotTtlDays — §5.4 expiry policy', () => {
  it('purchased credits never expire; promo expires soonest by default', () => {
    expect(lotTtlDays('purchasedCredits')).toBeNull();
    expect(lotTtlDays('promotionalCredits')).toBe(30);
    expect(lotTtlDays('bonusCredits')).toBe(90);
    expect(lotTtlDays('referralCredits')).toBe(180);
  });
});

describe('creditsForCost — §5.3 settle conversion', () => {
  it('applies rate × markup and rounds up (fractional credits always charge)', () => {
    // $0.011 × 100 credits/USD × 2 markup = 2.2 → 3
    expect(creditsForCost(0.011, 100, 2)).toBe(3);
    expect(creditsForCost(0.5, 100, 2)).toBe(100);
  });

  it('charges at least 1 credit for any nonzero cost', () => {
    expect(creditsForCost(0.000001, 100, 2)).toBe(1);
  });

  it('returns 0 for zero, negative, or non-finite cost', () => {
    expect(creditsForCost(0, 100, 2)).toBe(0);
    expect(creditsForCost(-1, 100, 2)).toBe(0);
    expect(creditsForCost(Number.NaN, 100, 2)).toBe(0);
  });
});

describe('compareLotsForTimeline — Phase 6 §11 expiry view order', () => {
  const at = (iso: string) => new Date(iso);
  const lot = (expiresAt: Date | null, createdAt: Date) => ({ expiresAt, createdAt });

  it('sorts soonest-expiring first, never-expiring last', () => {
    const rows = [
      lot(null, at('2026-01-01')),
      lot(at('2026-08-01'), at('2026-01-01')),
      lot(at('2026-07-15'), at('2026-01-01')),
    ];
    const sorted = [...rows].sort(compareLotsForTimeline);
    expect(sorted.map((l) => l.expiresAt?.toISOString().slice(0, 10) ?? 'never'))
      .toEqual(['2026-07-15', '2026-08-01', 'never']);
  });

  it('orders never-expiring lots oldest-granted first', () => {
    const rows = [
      lot(null, at('2026-06-01')),
      lot(null, at('2026-02-01')),
    ];
    const sorted = [...rows].sort(compareLotsForTimeline);
    expect(sorted.map((l) => l.createdAt.toISOString().slice(0, 10)))
      .toEqual(['2026-02-01', '2026-06-01']);
  });
});
