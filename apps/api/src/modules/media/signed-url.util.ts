import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed media URLs (docs4/09): S3-presigned-style capability URLs so media
// can be consumed by plain <video src> / a future CDN without an Authorization
// header. Ownership is proven once at issuance; the signature then covers one
// exact resource until expiry.

/** Secret for media signatures — dedicated env var, JWT secret as fallback. */
export function signingSecret(): string {
  return process.env['MEDIA_SIGNING_SECRET'] || process.env['JWT_SECRET'] || '';
}

/** Canonical resource string for the two media file routes. */
export function mediaResource(params: {
  versionId?: string;
  projectId?: string;
  fileName?: string;
}): string | null {
  if (params.versionId) return `version:${params.versionId}`;
  if (params.projectId && params.fileName) return `export:${params.projectId}/${params.fileName}`;
  return null;
}

/** HMAC-SHA256 over `${resource}|${expEpochSec}`, hex-encoded. */
export function signMedia(resource: string, expEpochSec: number, secret: string): string {
  return createHmac('sha256', secret).update(`${resource}|${expEpochSec}`).digest('hex');
}

/**
 * Verify a media signature. False on: missing secret, expired, malformed
 * expiry, or mismatch. Comparison is constant-time.
 */
export function verifySignedMedia(
  resource: string,
  expEpochSec: number,
  sig: string,
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (!secret || !sig) return false;
  if (!Number.isFinite(expEpochSec) || expEpochSec * 1000 < nowMs) return false;
  const expected = Buffer.from(signMedia(resource, expEpochSec, secret), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, 'hex');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Clamp a requested TTL (seconds) to [60, 86400]; absent/invalid → 900 (15 min). */
export function clampTtl(ttl: number | undefined): number {
  if (ttl === undefined || !Number.isFinite(ttl)) return 900;
  return Math.min(Math.max(Math.trunc(ttl), 60), 86_400);
}
