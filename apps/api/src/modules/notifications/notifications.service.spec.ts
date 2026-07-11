import { dedupeKeyWindow, shouldNotifyTrialExpiry } from './notifications.service';

// ── Fixed reference dates ─────────────────────────────────────────────────────

const NOW = new Date('2026-07-11T12:00:00.000Z');

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60_000);
}

// ── shouldNotifyTrialExpiry ───────────────────────────────────────────────────

describe('shouldNotifyTrialExpiry', () => {
  it('returns 7 when daysRemaining crosses the 7-day mark and mark not yet sent', () => {
    const expiresAt = daysFromNow(6.9); // < 7 days remaining
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [])).toBe(7);
  });

  it('returns 3 when daysRemaining crosses the 3-day mark and 7 already sent', () => {
    const expiresAt = daysFromNow(2.5); // < 3 days remaining
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [7])).toBe(3);
  });

  it('returns 1 when daysRemaining crosses the 1-day mark and 7+3 already sent', () => {
    const expiresAt = daysFromNow(0.9); // < 1 day remaining
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [7, 3])).toBe(1);
  });

  it('returns null when all applicable marks are already sent', () => {
    const expiresAt = daysFromNow(0.5); // < 1 day
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [7, 3, 1])).toBeNull();
  });

  it('returns null when trial is already expired (expiresAt <= now)', () => {
    const expiresAt = daysFromNow(-0.1);
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [])).toBeNull();
  });

  it('returns null when exactly at expiry (zero ms remaining)', () => {
    expect(shouldNotifyTrialExpiry(NOW, NOW, [])).toBeNull();
  });

  it('returns null when far in the future (> 7 days)', () => {
    const expiresAt = daysFromNow(14);
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [])).toBeNull();
  });

  it('returns null when exactly at 7-day boundary and mark already sent', () => {
    const expiresAt = daysFromNow(6.99);
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [7])).toBeNull();
  });

  it('returns 7 (not 3) when daysRemaining is between 3 and 7 — lowest crossing mark wins', () => {
    // 4.5 days remaining: crosses 7 but not 3, 7 not yet sent
    const expiresAt = daysFromNow(4.5);
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [])).toBe(7);
  });

  it('returns 3 on a first run when daysRemaining < 3 but > 1 — lowest applicable mark wins', () => {
    // 2 days remaining: crosses both 7 and 3, but smallest pending is 1? No — 1 not crossed.
    // daysRemaining=2 → crosses 7 (2<7) and 3 (2<3) but not 1 (2>1).
    // With no marks sent, we should get 1 (smallest mark within daysRemaining).
    // Wait — 2 days > 1, so 1 mark is NOT crossed. Should return 3.
    const expiresAt = daysFromNow(2.0);
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [])).toBe(3);
  });

  it('returns 1 on a first run when daysRemaining < 1 — fires only 1-mark', () => {
    const expiresAt = daysFromNow(0.3);
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [])).toBe(1);
  });

  it('suppresses 1-mark if already sent even when daysRemaining < 1', () => {
    const expiresAt = daysFromNow(0.4);
    expect(shouldNotifyTrialExpiry(expiresAt, NOW, [1])).toBeNull();
  });
});

// ── dedupeKeyWindow ───────────────────────────────────────────────────────────

describe('dedupeKeyWindow', () => {
  it('produces a stable key regardless of meta property insertion order', () => {
    const a = dedupeKeyWindow('trial.expiring', { grantId: 'g1', dayMark: 7 });
    const b = dedupeKeyWindow('trial.expiring', { dayMark: 7, grantId: 'g1' });
    expect(a).toBe(b);
  });

  it('differs when type differs', () => {
    const a = dedupeKeyWindow('trial.expiring', { grantId: 'g1' });
    const b = dedupeKeyWindow('trial.expired', { grantId: 'g1' });
    expect(a).not.toBe(b);
  });

  it('differs when meta values differ', () => {
    const a = dedupeKeyWindow('trial.expiring', { grantId: 'g1', dayMark: 7 });
    const b = dedupeKeyWindow('trial.expiring', { grantId: 'g1', dayMark: 3 });
    expect(a).not.toBe(b);
  });

  it('differs when meta keys differ', () => {
    const a = dedupeKeyWindow('referral.reward', { credits: 50 });
    const b = dedupeKeyWindow('referral.reward', { amount: 50 });
    expect(a).not.toBe(b);
  });

  it('produces an empty-meta key consistently', () => {
    const a = dedupeKeyWindow('recharge.success', {});
    const b = dedupeKeyWindow('recharge.success', {});
    expect(a).toBe(b);
  });

  it('includes all meta fields in the key', () => {
    const key = dedupeKeyWindow('bonus.granted', { offerId: 'o1', amount: 100 });
    expect(key).toContain('offerId:o1');
    expect(key).toContain('amount:100');
  });
});
