import { effectiveTrialStatus, identityKeyFor, scoreAbuse } from './trial.service';

describe('identityKeyFor — one-trial identity key (§5)', () => {
  it('normalizes case and whitespace so aliases collapse to one identity', () => {
    expect(identityKeyFor('User@Example.com')).toBe(identityKeyFor('  user@example.com  '));
  });

  it('differs for different emails', () => {
    expect(identityKeyFor('a@x.com')).not.toBe(identityKeyFor('b@x.com'));
  });
});

describe('scoreAbuse — §6 fail-closed decisions', () => {
  it('allows a clean signup', () => {
    expect(scoreAbuse({ duplicateDevice: false, duplicateIp: false, isVpn: false }).decision).toBe('ALLOW');
  });

  it('blocks a duplicate device outright', () => {
    expect(scoreAbuse({ duplicateDevice: true, duplicateIp: false, isVpn: false }).decision).toBe('BLOCK');
  });

  it('routes ambiguous signals to REVIEW, never auto-grant', () => {
    expect(scoreAbuse({ duplicateDevice: false, duplicateIp: true, isVpn: true }).decision).toBe('REVIEW');
  });

  it('VPN alone is not enough to punish', () => {
    expect(scoreAbuse({ duplicateDevice: false, duplicateIp: false, isVpn: true }).decision).toBe('ALLOW');
  });
});

describe('effectiveTrialStatus — expiry is derived, not trusted', () => {
  const now = new Date('2026-07-07');
  it('flips an ACTIVE grant past its expiry to EXPIRED', () => {
    expect(effectiveTrialStatus({ status: 'ACTIVE', expiresAt: new Date('2026-07-01') }, now)).toBe('EXPIRED');
  });
  it('leaves CONVERTED and future-dated ACTIVE untouched', () => {
    expect(effectiveTrialStatus({ status: 'CONVERTED', expiresAt: new Date('2026-07-01') }, now)).toBe('CONVERTED');
    expect(effectiveTrialStatus({ status: 'ACTIVE', expiresAt: new Date('2026-08-01') }, now)).toBe('ACTIVE');
  });
});
