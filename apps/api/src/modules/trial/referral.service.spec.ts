import { generateReferralCode, referralDecision, fraudFlags, milestoneFor, rewardCredits } from './referral.service';

describe('generateReferralCode — §10.2 deterministic unambiguous code', () => {
  it('is deterministic for the same seed', () => {
    expect(generateReferralCode('user-abc')).toBe(generateReferralCode('user-abc'));
  });

  it('produces exactly 8 characters', () => {
    expect(generateReferralCode('any-seed')).toHaveLength(8);
  });

  it('contains only unambiguous uppercase characters (no 0, O, 1, I)', () => {
    const code = generateReferralCode('test-seed-12345');
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(code).not.toMatch(/[0O1I]/);
  });

  it('differs for different seeds', () => {
    expect(generateReferralCode('user-a')).not.toBe(generateReferralCode('user-b'));
  });
});

describe('referralDecision — §10.2 acceptance rules + precedence', () => {
  it('accepts a clean referral', () => {
    expect(referralDecision({ selfReferral: false, alreadyReferred: false, codeActive: true })).toBe('ACCEPT');
  });

  it('rejects inactive code (highest precedence)', () => {
    expect(referralDecision({ selfReferral: true, alreadyReferred: true, codeActive: false })).toBe('REJECT_INACTIVE');
  });

  it('rejects self-referral (second precedence)', () => {
    expect(referralDecision({ selfReferral: true, alreadyReferred: false, codeActive: true })).toBe('REJECT_SELF');
  });

  it('rejects already-referred user', () => {
    expect(referralDecision({ selfReferral: false, alreadyReferred: true, codeActive: true })).toBe('REJECT_ALREADY');
  });

  it('inactive beats self-referral', () => {
    expect(referralDecision({ selfReferral: true, alreadyReferred: false, codeActive: false })).toBe('REJECT_INACTIVE');
  });
});

describe('fraudFlags — §10.2 shared-signal detection', () => {
  it('detects shared device fingerprint', () => {
    expect(fraudFlags({ deviceFingerprint: 'fp-abc' }, { deviceFingerprint: 'fp-abc' })).toContain('SHARED_DEVICE');
  });

  it('detects shared IP hash', () => {
    expect(fraudFlags({ ipHash: 'ip-xyz' }, { ipHash: 'ip-xyz' })).toContain('SHARED_IP');
  });

  it('detects both signals simultaneously', () => {
    const flags = fraudFlags({ deviceFingerprint: 'fp', ipHash: 'ip' }, { deviceFingerprint: 'fp', ipHash: 'ip' });
    expect(flags).toContain('SHARED_DEVICE');
    expect(flags).toContain('SHARED_IP');
  });

  it('null/undefined values never match', () => {
    expect(fraudFlags({ deviceFingerprint: null }, { deviceFingerprint: null })).toEqual([]);
    expect(fraudFlags({ deviceFingerprint: undefined }, { deviceFingerprint: undefined })).toEqual([]);
    expect(fraudFlags({}, {})).toEqual([]);
    expect(fraudFlags({ ipHash: null }, { ipHash: null })).toEqual([]);
  });

  it('different values do not flag', () => {
    expect(fraudFlags({ deviceFingerprint: 'fp-a' }, { deviceFingerprint: 'fp-b' })).toEqual([]);
  });
});

describe('milestoneFor — §10.2 tier boundaries', () => {
  it('returns 0 when no tier is met', () => {
    expect(milestoneFor(0)).toBe(0);
    expect(milestoneFor(2)).toBe(0);
  });

  it('returns tier 1 at exactly 3 qualified', () => {
    expect(milestoneFor(3)).toBe(1);
    expect(milestoneFor(4)).toBe(1);
  });

  it('returns tier 2 at exactly 10 qualified', () => {
    expect(milestoneFor(10)).toBe(2);
    expect(milestoneFor(11)).toBe(2);
  });

  it('returns tier 3 at exactly 25 qualified', () => {
    expect(milestoneFor(25)).toBe(3);
    expect(milestoneFor(100)).toBe(3);
  });

  it('supports custom tiers', () => {
    expect(milestoneFor(5, [5, 15])).toBe(1);
    expect(milestoneFor(15, [5, 15])).toBe(2);
    expect(milestoneFor(3, [5, 15])).toBe(0);
  });
});

describe('rewardCredits — §10.2 env-tunable rewards', () => {
  afterEach(() => {
    delete process.env['REFERRAL_REFERRER_CREDITS'];
    delete process.env['REFERRAL_REFERRED_CREDITS'];
    delete process.env['REFERRAL_MILESTONE_CREDITS'];
  });

  it('returns defaults when env not set', () => {
    expect(rewardCredits('REFERRER')).toBe(50);
    expect(rewardCredits('REFERRED')).toBe(25);
    expect(rewardCredits('MILESTONE', 1)).toBe(200);
    expect(rewardCredits('MILESTONE', 2)).toBe(400);
    expect(rewardCredits('MILESTONE', 3)).toBe(600);
  });

  it('respects env overrides', () => {
    process.env['REFERRAL_REFERRER_CREDITS'] = '100';
    process.env['REFERRAL_REFERRED_CREDITS'] = '50';
    process.env['REFERRAL_MILESTONE_CREDITS'] = '500';
    expect(rewardCredits('REFERRER')).toBe(100);
    expect(rewardCredits('REFERRED')).toBe(50);
    expect(rewardCredits('MILESTONE', 2)).toBe(1000);
  });
});
