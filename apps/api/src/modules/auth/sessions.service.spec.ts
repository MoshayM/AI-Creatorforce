import { hashRefreshToken, newRefreshToken, refreshDecision } from './sessions.service';

// ── hashRefreshToken ──────────────────────────────────────────────────────────

describe('hashRefreshToken — SHA-256 hex digest', () => {
  it('is deterministic for the same input', () => {
    const token = 'some-raw-token';
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it('differs for different tokens', () => {
    expect(hashRefreshToken('token-a')).not.toBe(hashRefreshToken('token-b'));
  });

  it('returns a 64-character hex string', () => {
    expect(hashRefreshToken('any-token')).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── newRefreshToken ───────────────────────────────────────────────────────────

describe('newRefreshToken — 48-byte base64url token', () => {
  it('generates a non-empty string', () => {
    expect(newRefreshToken().length).toBeGreaterThan(0);
  });

  it('each call produces a unique value', () => {
    expect(newRefreshToken()).not.toBe(newRefreshToken());
  });

  it('output is base64url (no +, /, = padding)', () => {
    // base64url uses - and _ in place of + and /; no = padding
    expect(newRefreshToken()).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

// ── refreshDecision ───────────────────────────────────────────────────────────

describe('refreshDecision — §session-management rotation logic', () => {
  const now = new Date('2026-07-11T06:00:00.000Z');
  const future = new Date('2026-08-11T06:00:00.000Z');
  const past = new Date('2026-06-01T06:00:00.000Z');

  it('returns INVALID when row is null (token not found)', () => {
    expect(refreshDecision(null, now)).toBe('INVALID');
  });

  it('returns INVALID when session is expired', () => {
    expect(
      refreshDecision({ revokedAt: null, rotatedAt: null, expiresAt: past }, now),
    ).toBe('INVALID');
  });

  it('returns INVALID when expiresAt equals now (boundary — not yet expired is > now)', () => {
    // expiresAt === now means expiresAt <= now → INVALID
    expect(
      refreshDecision({ revokedAt: null, rotatedAt: null, expiresAt: now }, now),
    ).toBe('INVALID');
  });

  it('returns REUSE_DETECTED when revokedAt is set (post-revocation replay)', () => {
    expect(
      refreshDecision({ revokedAt: new Date('2026-07-10T00:00:00Z'), rotatedAt: null, expiresAt: future }, now),
    ).toBe('REUSE_DETECTED');
  });

  it('returns REUSE_DETECTED when rotatedAt is set (token was already consumed)', () => {
    expect(
      refreshDecision({ revokedAt: null, rotatedAt: new Date('2026-07-10T00:00:00Z'), expiresAt: future }, now),
    ).toBe('REUSE_DETECTED');
  });

  it('returns REUSE_DETECTED when both revokedAt and rotatedAt are set', () => {
    expect(
      refreshDecision(
        {
          revokedAt: new Date('2026-07-10T00:00:00Z'),
          rotatedAt: new Date('2026-07-09T00:00:00Z'),
          expiresAt: future,
        },
        now,
      ),
    ).toBe('REUSE_DETECTED');
  });

  it('returns ROTATE for a healthy session (not expired, not revoked, not rotated)', () => {
    expect(
      refreshDecision({ revokedAt: null, rotatedAt: null, expiresAt: future }, now),
    ).toBe('ROTATE');
  });
});
