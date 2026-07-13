import { mediaResource, signMedia, verifySignedMedia, clampTtl } from './signed-url.util';

const SECRET = 'test-secret';
const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);
const FUTURE = Math.floor(NOW / 1000) + 900;

describe('mediaResource', () => {
  it('maps version params', () => {
    expect(mediaResource({ versionId: 'v1' })).toBe('version:v1');
  });

  it('maps export params', () => {
    expect(mediaResource({ projectId: 'p1', fileName: 'clip.mp4' })).toBe('export:p1/clip.mp4');
  });

  it('returns null for unknown shapes', () => {
    expect(mediaResource({})).toBeNull();
    expect(mediaResource({ projectId: 'p1' })).toBeNull();
  });
});

describe('signMedia / verifySignedMedia', () => {
  it('round-trips a valid signature', () => {
    const sig = signMedia('version:v1', FUTURE, SECRET);
    expect(verifySignedMedia('version:v1', FUTURE, sig, SECRET, NOW)).toBe(true);
  });

  it('rejects an expired signature', () => {
    const past = Math.floor(NOW / 1000) - 1;
    const sig = signMedia('version:v1', past, SECRET);
    expect(verifySignedMedia('version:v1', past, sig, SECRET, NOW)).toBe(false);
  });

  it('rejects a tampered resource', () => {
    const sig = signMedia('version:v1', FUTURE, SECRET);
    expect(verifySignedMedia('version:v2', FUTURE, sig, SECRET, NOW)).toBe(false);
  });

  it('rejects a tampered expiry', () => {
    const sig = signMedia('version:v1', FUTURE, SECRET);
    expect(verifySignedMedia('version:v1', FUTURE + 1000, sig, SECRET, NOW)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    const sig = signMedia('version:v1', FUTURE, 'other-secret');
    expect(verifySignedMedia('version:v1', FUTURE, sig, SECRET, NOW)).toBe(false);
  });

  it('rejects when the secret is empty (unconfigured)', () => {
    const sig = signMedia('version:v1', FUTURE, '');
    expect(verifySignedMedia('version:v1', FUTURE, sig, '', NOW)).toBe(false);
  });

  it('rejects malformed signature strings without throwing', () => {
    expect(verifySignedMedia('version:v1', FUTURE, 'zz-not-hex', SECRET, NOW)).toBe(false);
    expect(verifySignedMedia('version:v1', FUTURE, '', SECRET, NOW)).toBe(false);
  });

  it('rejects a non-finite expiry', () => {
    const sig = signMedia('version:v1', FUTURE, SECRET);
    expect(verifySignedMedia('version:v1', NaN, sig, SECRET, NOW)).toBe(false);
  });
});

describe('clampTtl', () => {
  it('defaults to 900 when absent or invalid', () => {
    expect(clampTtl(undefined)).toBe(900);
    expect(clampTtl(NaN)).toBe(900);
  });

  it('clamps to [60, 86400] and truncates fractions', () => {
    expect(clampTtl(1)).toBe(60);
    expect(clampTtl(1_000_000)).toBe(86_400);
    expect(clampTtl(120.9)).toBe(120);
  });
});
