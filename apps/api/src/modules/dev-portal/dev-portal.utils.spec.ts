import { createHmac } from 'node:crypto';
import { generateDeveloperKey, scopeAllows, signWebhookPayload, nextBackoff, buildUsageSummary } from './dev-portal.utils';

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

describe('buildUsageSummary — per-key request analytics (Wave 10)', () => {
  const key = (id: string, over: Partial<Parameters<typeof buildUsageSummary>[0][number]> = {}) => ({
    id,
    name: `Key ${id}`,
    keyPrefix: 'cfk_live_XXX',
    sandbox: false,
    lastUsedAt: null,
    revokedAt: null,
    ...over,
  });

  it('groups sparse daily rows under their key and totals them', () => {
    const out = buildUsageSummary(
      [key('k1'), key('k2')],
      [
        { keyId: 'k1', day: new Date('2026-07-10T00:00:00Z'), requests: 5 },
        { keyId: 'k1', day: new Date('2026-07-12T00:00:00Z'), requests: 2 },
        { keyId: 'k2', day: new Date('2026-07-12T00:00:00Z'), requests: 7 },
      ],
      30,
    );
    expect(out.windowDays).toBe(30);
    expect(out.totalRequests).toBe(14);
    const k1 = out.keys.find((k) => k.id === 'k1')!;
    expect(k1.totalRequests).toBe(7);
    expect(k1.byDay).toEqual([
      { day: '2026-07-10', requests: 5 },
      { day: '2026-07-12', requests: 2 },
    ]);
  });

  it('keys with no traffic still appear, with zero totals', () => {
    const out = buildUsageSummary([key('idle')], [], 7);
    expect(out.keys[0]!.totalRequests).toBe(0);
    expect(out.keys[0]!.byDay).toEqual([]);
    expect(out.keys[0]!.tokens).toEqual({ tokensIn: 0, tokensOut: 0, costUsd: 0, calls: 0 });
    expect(out.totalRequests).toBe(0);
  });

  it('merges per-key token totals under `tokens`, zeroing keys without AI spend', () => {
    const out = buildUsageSummary(
      [key('k1'), key('k2')],
      [],
      30,
      [{ developerKeyId: 'k1', tokensIn: 12_000, tokensOut: 3_000, costUsd: 0.42, calls: 4 }],
    );
    const k1 = out.keys.find((k) => k.id === 'k1')!;
    expect(k1.tokens).toEqual({ tokensIn: 12_000, tokensOut: 3_000, costUsd: 0.42, calls: 4 });
    const k2 = out.keys.find((k) => k.id === 'k2')!;
    expect(k2.tokens.calls).toBe(0);
  });

  it('drops rows for keys not in the list (deleted between queries)', () => {
    const out = buildUsageSummary(
      [key('k1')],
      [{ keyId: 'ghost', day: new Date('2026-07-12T00:00:00Z'), requests: 99 }],
      30,
    );
    expect(out.totalRequests).toBe(0);
  });

  it('preserves key metadata on each row', () => {
    const revoked = new Date('2026-07-01T00:00:00Z');
    const out = buildUsageSummary([key('k1', { revokedAt: revoked, sandbox: true })], [], 30);
    expect(out.keys[0]!.revokedAt).toBe(revoked);
    expect(out.keys[0]!.sandbox).toBe(true);
    expect(out.keys[0]!.name).toBe('Key k1');
  });
});
