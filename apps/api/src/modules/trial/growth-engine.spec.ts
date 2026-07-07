import { evaluateUpgradeRules, shouldNudge } from './upgrade-engine.service';
import { bonusWithinMargin, offerQualifies, pickFirstRechargeOffer } from './offers.service';
import { packWithinMargin } from './marketplace.service';

const behaviour = (over: Partial<Parameters<typeof evaluateUpgradeRules>[0]> = {}) => ({
  chatsSent: 0, videosAnalyzed: 0, clipsGenerated: 0, rendersRun: 0, ...over,
});
const noTrial = { active: false, usedPct: 0, daysToExpiry: null };

describe('evaluateUpgradeRules — §8 behavior triggers', () => {
  it('nudges when trial credits run low or expiry is near', () => {
    expect(evaluateUpgradeRules(behaviour(), { active: true, usedPct: 0.85, daysToExpiry: 10 }).map((r) => r.reasonCode))
      .toContain('low_trial_credits');
    expect(evaluateUpgradeRules(behaviour(), { active: true, usedPct: 0.1, daysToExpiry: 2 }).map((r) => r.reasonCode))
      .toContain('trial_expiring');
  });

  it('recommends PRO for video-heavy users', () => {
    const rules = evaluateUpgradeRules(behaviour({ videosAnalyzed: 6 }), noTrial);
    expect(rules).toEqual([{ reasonCode: 'video_heavy', recommendedPlan: 'PRO', confidence: 0.8 }]);
  });

  it('stays silent for light usage with no trial pressure', () => {
    expect(evaluateUpgradeRules(behaviour({ chatsSent: 5, clipsGenerated: 3 }), noTrial)).toEqual([]);
  });
});

describe('shouldNudge — §8 frequency cap', () => {
  const now = new Date('2026-07-07');
  const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60_000);

  it('suppresses a repeat of the same reason within 7 days', () => {
    expect(shouldNudge('video_heavy', [{ reasonCode: 'video_heavy', createdAt: days(3), dismissedAt: null }], now)).toBe(false);
    expect(shouldNudge('video_heavy', [{ reasonCode: 'video_heavy', createdAt: days(10), dismissedAt: null }], now)).toBe(true);
  });

  it('respects dismissals for 14 days', () => {
    expect(shouldNudge('chat_heavy', [{ reasonCode: 'chat_heavy', createdAt: days(20), dismissedAt: days(5) }], now)).toBe(false);
  });

  it('different reason codes do not interfere', () => {
    expect(shouldNudge('chat_heavy', [{ reasonCode: 'video_heavy', createdAt: days(1), dismissedAt: null }], now)).toBe(true);
  });
});

describe('bonusWithinMargin — §9 profit gate', () => {
  // 100 credits/USD, 30% min margin: a $5.00 recharge can carry ≤ $3.50 of bonus = 350 credits
  it('allows a bonus inside the margin envelope and rejects one outside', () => {
    expect(bonusWithinMargin(500, 350, 100, 0.3)).toBe(true);
    expect(bonusWithinMargin(500, 351, 100, 0.3)).toBe(false);
  });

  it('fails closed on nonsense inputs', () => {
    expect(bonusWithinMargin(0, 10, 100, 0.3)).toBe(false);
    expect(bonusWithinMargin(500, -1, 100, 0.3)).toBe(false);
  });
});

describe('offerQualifies — §10.1 behavior targeting', () => {
  const ctx = (over: Partial<Parameters<typeof offerQualifies>[1]> = {}) => ({
    hasPaid: false, lifetimePurchased: 0, inactiveDays: 0, balanceCredits: 500, ...over,
  });

  it('WELCOME/FIRST_RECHARGE only before the first payment', () => {
    expect(offerQualifies({ type: 'WELCOME' }, ctx())).toBe(true);
    expect(offerQualifies({ type: 'WELCOME' }, ctx({ hasPaid: true }))).toBe(false);
  });

  it('WINBACK respects the targetRule inactivity threshold', () => {
    expect(offerQualifies({ type: 'WINBACK', targetRule: { inactiveDaysMin: 30 } }, ctx({ inactiveDays: 20 }))).toBe(false);
    expect(offerQualifies({ type: 'WINBACK', targetRule: { inactiveDaysMin: 30 } }, ctx({ inactiveDays: 31 }))).toBe(true);
    expect(offerQualifies({ type: 'WINBACK' }, ctx({ inactiveDays: 14 }))).toBe(true); // default 14
  });

  it('LOW_CREDIT triggers on a near-empty wallet, LOYALTY on spend history', () => {
    expect(offerQualifies({ type: 'LOW_CREDIT' }, ctx({ balanceCredits: 20 }))).toBe(true);
    expect(offerQualifies({ type: 'LOW_CREDIT' }, ctx({ balanceCredits: 400 }))).toBe(false);
    expect(offerQualifies({ type: 'LOYALTY' }, ctx({ lifetimePurchased: 2_000 }))).toBe(true);
    expect(offerQualifies({ type: 'LOYALTY' }, ctx({ lifetimePurchased: 10 }))).toBe(false);
  });

  it('unknown types fail closed', () => {
    expect(offerQualifies({ type: 'MYSTERY' }, ctx())).toBe(false);
  });
});

describe('packWithinMargin — §12 marketplace profit gate', () => {
  // rate 100, markup 2, minMargin 0.3: $10 pack → expected cost = credits/200; cap = 1400 credits
  it('allows up to a 40% bonus at defaults and rejects beyond', () => {
    expect(packWithinMargin(1000, 1400, 100, 2, 0.3)).toBe(true);
    expect(packWithinMargin(1000, 1401, 100, 2, 0.3)).toBe(false);
  });

  it('plain 1:1 packs pass comfortably', () => {
    expect(packWithinMargin(1000, 1000, 100, 2, 0.3)).toBe(true);
  });

  it('fails closed on nonsense inputs', () => {
    expect(packWithinMargin(0, 100, 100, 2, 0.3)).toBe(false);
    expect(packWithinMargin(1000, 0, 100, 2, 0.3)).toBe(false);
  });
});

describe('pickFirstRechargeOffer — §9 highest qualifying threshold', () => {
  const now = new Date('2026-07-07');
  const offer = (minRechargeMinor: number, over: Partial<Parameters<typeof pickFirstRechargeOffer>[0][number]> = {}) => ({
    minRechargeMinor, status: 'active', validFrom: new Date('2026-01-01'), validTo: null, ...over,
  });

  it('picks the highest threshold the amount qualifies for', () => {
    const picked = pickFirstRechargeOffer([offer(500), offer(1000), offer(2500)], 1200, now);
    expect(picked!.minRechargeMinor).toBe(1000);
  });

  it('returns null when nothing qualifies or offers are inactive/expired', () => {
    expect(pickFirstRechargeOffer([offer(1000)], 500, now)).toBeNull();
    expect(pickFirstRechargeOffer([offer(100, { status: 'paused' })], 500, now)).toBeNull();
    expect(pickFirstRechargeOffer([offer(100, { validTo: new Date('2026-06-01') })], 500, now)).toBeNull();
  });
});
