import { createHmac } from 'node:crypto';
import { generateDeveloperKey, scopeAllows, signWebhookPayload, nextBackoff } from './dev-portal.utils';

describe('generateDeveloperKey — key format + hashing (§13)', () => {
  it('live keys carry the cfk_live_ marker and a 40-char base62 suffix', () => {
    const { key } = generateDeveloperKey(false);
    expect(key).toMatch(/^cfk_live_[0-9A-Za-z]{40}$/);
  });

  it('sandbox keys carry the cfk_test_ marker', () => {
    const { key } = generateDeveloperKey(true);
    expect(key).toMatch(/^cfk_test_[0-9A-Za-z]{40}$/);
  });

  it('prefix is the first 12 chars of the key', () => {
    const { key, prefix } = generateDeveloperKey(false);
    expect(prefix).toBe(key.slice(0, 12));
    expect(prefix).toHaveLength(12);
  });

  it('hash is a sha256 hex digest and differs from the key', () => {
    const { key, hash } = generateDeveloperKey(false);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
  });

  it('each call produces a unique key', () => {
    expect(generateDeveloperKey(false).key).not.toBe(generateDeveloperKey(false).key);
  });
});

describe('scopeAllows — exact + wildcard scope resolution', () => {
  it('exact match allows', () => {
    expect(scopeAllows(['wallet:read'], 'wallet:read')).toBe(true);
  });

  it('namespace wildcard allows any action in that namespace', () => {
    expect(scopeAllows(['library:*'], 'library:read')).toBe(true);
    expect(scopeAllows(['library:*'], 'library:write')).toBe(true);
  });

  it('wildcard does not leak across namespaces', () => {
    expect(scopeAllows(['library:*'], 'wallet:read')).toBe(false);
  });

  it('empty scopes deny everything', () => {
    expect(scopeAllows([], 'wallet:read')).toBe(false);
  });

  it('unrelated scope denies', () => {
    expect(scopeAllows(['channels:read'], 'wallet:read')).toBe(false);
  });
});

describe('signWebhookPayload — Stripe-style HMAC signature', () => {
  it('matches an independently computed known vector', () => {
    const secret = 'whsec_fixed_test_secret';
    const timestamp = 1760000000;
    const body = '{"event":"test.ping"}';
    const expected = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    expect(signWebhookPayload(secret, timestamp, body)).toBe(expected);
  });

  it('changes when any input changes', () => {
    const base = signWebhookPayload('s', 1, 'b');
    expect(signWebhookPayload('s2', 1, 'b')).not.toBe(base);
    expect(signWebhookPayload('s', 2, 'b')).not.toBe(base);
    expect(signWebhookPayload('s', 1, 'b2')).not.toBe(base);
  });
});

describe('nextBackoff — retry ladder + dead-letter', () => {
  it('follows the 1m/5m/30m/2h/12h ladder', () => {
    expect(nextBackoff(1)).toBe(60_000);
    expect(nextBackoff(2)).toBe(5 * 60_000);
    expect(nextBackoff(3)).toBe(30 * 60_000);
    expect(nextBackoff(4)).toBe(2 * 60 * 60_000);
    expect(nextBackoff(5)).toBe(12 * 60 * 60_000);
  });

  it('returns -1 (dead-letter) past attempt 5 and for invalid attempts', () => {
    expect(nextBackoff(6)).toBe(-1);
    expect(nextBackoff(0)).toBe(-1);
    expect(nextBackoff(-1)).toBe(-1);
  });
});
