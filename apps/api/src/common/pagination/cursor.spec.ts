import { encodeCursor, decodeCursor, keysetWhereDesc, clampLimit, pageResult } from './cursor';

describe('encodeCursor / decodeCursor — shared keyset cursor round-trip', () => {
  it('round-trips a non-null date', () => {
    const date = new Date('2026-01-15T10:00:00.000Z');
    const id = 'clabcdef1234567890';
    const decoded = decodeCursor(encodeCursor(date, id));
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(id);
    expect(decoded!.date?.toISOString()).toBe(date.toISOString());
  });

  it('round-trips a null date', () => {
    const id = 'clzzzz0000000000xx';
    const decoded = decodeCursor(encodeCursor(null, id));
    expect(decoded).not.toBeNull();
    expect(decoded!.date).toBeNull();
    expect(decoded!.id).toBe(id);
  });

  it('returns null for undefined cursor', () => {
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('returns null for empty string cursor', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for garbage cursor', () => {
    expect(decodeCursor('notvalidbase64!!!!')).toBeNull();
  });

  it('returns null for a valid base64url that has no pipe separator', () => {
    const noPipe = Buffer.from('nopipeinhere').toString('base64url');
    expect(decodeCursor(noPipe)).toBeNull();
  });

  it('returns null for a tampered date segment', () => {
    const tampered = Buffer.from('not-a-date|clabc123').toString('base64url');
    expect(decodeCursor(tampered)).toBeNull();
  });

  it('returns null when the id segment is empty', () => {
    const noId = Buffer.from('2026-01-15T10:00:00.000Z|').toString('base64url');
    expect(decodeCursor(noId)).toBeNull();
  });
});

describe('keysetWhereDesc', () => {
  it('returns an empty fragment for no cursor (first page)', () => {
    expect(keysetWhereDesc('createdAt', null)).toEqual({});
  });

  it('returns an empty fragment when the cursor has no date', () => {
    expect(keysetWhereDesc('createdAt', { date: null, id: 'x' })).toEqual({});
  });

  it('builds the strictly-after-cursor OR clause with id tiebreaker', () => {
    const date = new Date('2026-07-13T10:00:00.000Z');
    expect(keysetWhereDesc('updatedAt', { date, id: 'abc' })).toEqual({
      OR: [
        { updatedAt: { lt: date } },
        { updatedAt: date, id: { lt: 'abc' } },
      ],
    });
  });
});

describe('clampLimit', () => {
  it('returns the fallback for undefined', () => {
    expect(clampLimit(undefined, 50, 100)).toBe(50);
  });

  it('returns the fallback for NaN (unparseable query param)', () => {
    expect(clampLimit(Number.NaN, 20, 50)).toBe(20);
  });

  it('clamps to the max', () => {
    expect(clampLimit(9999, 50, 100)).toBe(100);
  });

  it('clamps to at least 1', () => {
    expect(clampLimit(0, 50, 100)).toBe(1);
    expect(clampLimit(-5, 50, 100)).toBe(1);
  });

  it('truncates fractional values and passes valid values through', () => {
    expect(clampLimit(25.9, 50, 100)).toBe(25);
    expect(clampLimit(30, 50, 100)).toBe(30);
  });
});

describe('pageResult', () => {
  const row = (id: string, iso: string) => ({ id, createdAt: new Date(iso) });

  it('returns all rows and a null cursor when there is no extra row', () => {
    const rows = [row('a', '2026-01-03T00:00:00Z'), row('b', '2026-01-02T00:00:00Z')];
    const page = pageResult(rows, 2, (r) => r.createdAt);
    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('trims the sentinel row and encodes the cursor off the last kept row', () => {
    const rows = [
      row('a', '2026-01-03T00:00:00.000Z'),
      row('b', '2026-01-02T00:00:00.000Z'),
      row('c', '2026-01-01T00:00:00.000Z'), // sentinel — proves another page exists
    ];
    const page = pageResult(rows, 2, (r) => r.createdAt);
    expect(page.data.map((r) => r.id)).toEqual(['a', 'b']);
    const decoded = decodeCursor(page.nextCursor!);
    expect(decoded).toEqual({ date: new Date('2026-01-02T00:00:00.000Z'), id: 'b' });
  });

  it('returns an empty page with a null cursor for no rows', () => {
    expect(pageResult([], 10, () => null)).toEqual({ data: [], nextCursor: null });
  });
});
