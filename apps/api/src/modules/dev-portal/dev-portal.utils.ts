import { createHash, createHmac, randomBytes } from 'node:crypto';

// ── Character sets ─────────────────────────────────────────────────────────────

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomBase62(length: number): string {
  // Use rejection sampling to avoid modulo bias.
  const out: string[] = [];
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      const v = bytes[i]!;
      if (v < 248) {
        // 248 = 4 * 62 — reject values ≥ 248 to avoid bias
        out.push(BASE62_CHARS[v % 62]!);
      }
    }
  }
  return out.join('');
}

// ── Key generation ─────────────────────────────────────────────────────────────

export interface GeneratedKey {
  /** Full plaintext key — shown to the user exactly once. */
  key: string;
  /** First 12 characters of the key (incl. 'cfk_' prefix) — stored in DB for UI display. */
  prefix: string;
  /** SHA-256 hex digest of the full key — stored in DB. */
  hash: string;
}

/**
 * Generates a new developer API key.
 *
 * Format: `cfk_live_<40 base62 chars>` (sandbox: `cfk_test_<40 base62 chars>`)
 * Prefix  = first 12 characters (e.g. `cfk_live_XXX`)
 * Hash    = SHA-256 hex of the full key — plaintext is NEVER persisted.
 */
export function generateDeveloperKey(sandbox: boolean): GeneratedKey {
  const suffix = randomBase62(40);
  const key = `cfk_${sandbox ? 'test' : 'live'}_${suffix}`;
  const prefix = key.slice(0, 12);
  const hash = createHash('sha256').update(key).digest('hex');
  return { key, prefix, hash };
}

// ── Scope resolution ───────────────────────────────────────────────────────────

/**
 * Returns true when `required` is satisfied by any entry in `scopes`.
 *
 * Rules:
 * - Exact match: `library:read` satisfies `library:read`
 * - Wildcard namespace: `library:*` satisfies `library:read` (but not `library:read:extra`)
 * - Empty scopes array → deny all.
 */
export function scopeAllows(scopes: string[], required: string): boolean {
  if (scopes.length === 0) return false;
  const [reqNs] = required.split(':');
  for (const s of scopes) {
    if (s === required) return true;
    // namespace:* wildcard — must match exactly the same namespace prefix
    if (s.endsWith(':*') && reqNs !== undefined) {
      const grantedNs = s.slice(0, -2); // strip ':*'
      if (grantedNs === reqNs) return true;
    }
  }
  return false;
}

// ── Webhook signing ────────────────────────────────────────────────────────────

/**
 * Returns the `sha256=<hex>` HMAC-SHA256 signature for a webhook delivery.
 *
 * Signing input: `${timestamp}.${body}` — Stripe-style.
 * The `secret` must be the raw plaintext signing secret (not the hash).
 */
export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  const data = `${timestamp}.${body}`;
  const sig = createHmac('sha256', secret).update(data).digest('hex');
  return `sha256=${sig}`;
}

// ── Retry backoff ──────────────────────────────────────────────────────────────

const BACKOFF_MS: readonly number[] = [
  1 * 60_000,   // attempt 1 → 1 min
  5 * 60_000,   // attempt 2 → 5 min
  30 * 60_000,  // attempt 3 → 30 min
  2 * 60 * 60_000,  // attempt 4 → 2 h
  12 * 60 * 60_000, // attempt 5 → 12 h
] as const;

/**
 * Returns the number of milliseconds to wait before the next delivery attempt.
 * Returns -1 when `attempts` > 5 — the delivery should be moved to dead-letter.
 */
export function nextBackoff(attempts: number): number {
  if (attempts <= 0 || attempts > 5) return -1;
  return BACKOFF_MS[attempts - 1]!;
}

// ── Per-key usage summary (Wave 10) ────────────────────────────────────────────

export interface KeyUsageDayRow {
  keyId: string;
  day: Date;
  requests: number;
}

export interface KeyUsageMeta {
  id: string;
  name: string;
  keyPrefix: string;
  sandbox: boolean;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Shape the per-key usage response from daily rollup rows.
 *
 * Rollup rows are sparse (no row for a zero-request day) and stay sparse in
 * the output — `byDay` lists only days with traffic, `day` as `YYYY-MM-DD`.
 * Rows for keys not in `keys` (e.g. deleted between queries) are dropped.
 */
export function buildUsageSummary(keys: KeyUsageMeta[], rows: KeyUsageDayRow[], windowDays: number) {
  const byKey = new Map<string, { totalRequests: number; byDay: Array<{ day: string; requests: number }> }>(
    keys.map((k) => [k.id, { totalRequests: 0, byDay: [] }]),
  );
  for (const r of rows) {
    const bucket = byKey.get(r.keyId);
    if (!bucket) continue;
    bucket.totalRequests += r.requests;
    bucket.byDay.push({ day: r.day.toISOString().slice(0, 10), requests: r.requests });
  }
  const keysOut = keys.map((k) => ({ ...k, ...byKey.get(k.id)! }));
  return {
    windowDays,
    totalRequests: keysOut.reduce((n, k) => n + k.totalRequests, 0),
    keys: keysOut,
  };
}
