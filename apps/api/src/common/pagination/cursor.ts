// Shared keyset-cursor pagination helpers (docs4/03: list endpoints paginate
// with cursors over a non-null sort column + id tiebreaker — never OFFSET/skip).

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageResult<T> {
  data: T[];
  nextCursor: string | null;
}

// ── Pure cursor helpers ───────────────────────────────────────────────────────

/**
 * Encode a keyset cursor for (dateColumn, id) sorts.
 * base64url of `${isoDate|''}|${id}` — empty date segment when the column is null.
 */
export function encodeCursor(date: Date | null, id: string): string {
  const iso = date ? date.toISOString() : '';
  return Buffer.from(`${iso}|${id}`).toString('base64url');
}

/**
 * Decode a cursor produced by encodeCursor.
 * Returns null on missing or malformed input — caller treats as first page.
 */
export function decodeCursor(cursor: string | undefined): { date: Date | null; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const pipeIdx = raw.indexOf('|');
    if (pipeIdx === -1) return null;
    const isoStr = raw.slice(0, pipeIdx);
    const id = raw.slice(pipeIdx + 1);
    if (!id) return null;
    const date = isoStr ? new Date(isoStr) : null;
    if (date && isNaN(date.getTime())) return null;
    return { date, id };
  } catch {
    return null;
  }
}

/**
 * Prisma where-fragment continuing a (dateField DESC, id DESC) keyset over a
 * non-null date column. Empty object for no/invalid cursor (first page).
 */
export function keysetWhereDesc(
  dateField: string,
  decoded: { date: Date | null; id: string } | null,
): Record<string, unknown> {
  if (!decoded?.date) return {};
  return {
    OR: [
      { [dateField]: { lt: decoded.date } },
      { [dateField]: decoded.date, id: { lt: decoded.id } },
    ],
  };
}

/** Clamp a requested page size to [1, max]; absent or non-numeric → fallback. */
export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

/**
 * Build a PageResult from a `take + 1` fetch: trims the sentinel row and
 * encodes the next cursor off the last row actually returned.
 */
export function pageResult<T extends { id: string }>(
  rows: T[],
  take: number,
  dateOf: (row: T) => Date | null,
): PageResult<T> {
  const hasMore = rows.length > take;
  const data = hasMore ? rows.slice(0, take) : rows;
  const last = data[data.length - 1];
  return {
    data,
    nextCursor: hasMore && last ? encodeCursor(dateOf(last), last.id) : null,
  };
}
