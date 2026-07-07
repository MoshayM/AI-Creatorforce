import { BadRequestException } from '@nestjs/common';
import { planDebit, type BucketBalances } from './wallet.service';

const buckets = (p: number, b: number, r: number, pur: number): BucketBalances => ({
  promotionalCredits: p,
  bonusCredits: b,
  referralCredits: r,
  purchasedCredits: pur,
});

describe('planDebit — §5.4 spend priority (promo → bonus → referral → purchased)', () => {
  it('drains buckets in priority order', () => {
    expect(planDebit(buckets(10, 10, 10, 100), 25)).toEqual({
      promotionalCredits: 10,
      bonusCredits: 10,
      referralCredits: 5,
      purchasedCredits: 0,
    });
  });

  it('touches purchased credits only after all cheaper buckets are empty', () => {
    expect(planDebit(buckets(0, 0, 0, 50), 20)).toEqual({
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
