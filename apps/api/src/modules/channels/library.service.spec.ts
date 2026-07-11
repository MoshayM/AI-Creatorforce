import {
  encodeCursor,
  decodeCursor,
  encodeTitleCursor,
  decodeTitleCursor,
  kindForDuration,
  parseIsoDuration,
} from './library.service';

describe('encodeCursor / decodeCursor — keyset cursor round-trip', () => {
  it('round-trips a non-null publishedAt', () => {
    const date = new Date('2024-03-15T10:00:00.000Z');
    const id = 'clabcdef1234567890';
    const cursor = encodeCursor(date, id);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe(id);
    expect(decoded!.publishedAt?.toISOString()).toBe(date.toISOString());
  });

  it('round-trips a null publishedAt', () => {
    const id = 'clzzzz0000000000xx';
    const cursor = encodeCursor(null, id);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.publishedAt).toBeNull();
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
});

describe('encodeTitleCursor / decodeTitleCursor — title-sort keyset cursor', () => {
  it('round-trips a plain title', () => {
    const cursor = encodeTitleCursor('My Video Title', 'clabc123');
    expect(decodeTitleCursor(cursor)).toEqual({ title: 'My Video Title', id: 'clabc123' });
  });

  it('round-trips a title containing pipe characters (splits on last pipe)', () => {
    const cursor = encodeTitleCursor('Ep. 4 | The Reckoning | Part 2', 'clabc123');
    expect(decodeTitleCursor(cursor)).toEqual({ title: 'Ep. 4 | The Reckoning | Part 2', id: 'clabc123' });
  });

  it('round-trips a title that looks like an ISO date (must not be date-validated)', () => {
    const cursor = encodeTitleCursor('2024-01-01 Year in Review', 'clabc123');
    expect(decodeTitleCursor(cursor)).toEqual({ title: '2024-01-01 Year in Review', id: 'clabc123' });
  });

  it('returns null for undefined, empty, or pipe-less input', () => {
    expect(decodeTitleCursor(undefined)).toBeNull();
    expect(decodeTitleCursor('')).toBeNull();
    expect(decodeTitleCursor(Buffer.from('nopipe').toString('base64url'))).toBeNull();
  });
});

describe('kindForDuration — Short/Video boundary', () => {
  it('classifies 0 ms as short', () => {
    expect(kindForDuration(0)).toBe('short');
  });

  it('classifies 60 000 ms (60 s) as short', () => {
    expect(kindForDuration(60_000)).toBe('short');
  });

  it('classifies 183 000 ms (≈3 min) as short — boundary', () => {
    expect(kindForDuration(183_000)).toBe('short');
  });

  it('classifies 183 001 ms as video — one ms above boundary', () => {
    expect(kindForDuration(183_001)).toBe('video');
  });

  it('classifies 600 000 ms (10 min) as video', () => {
    expect(kindForDuration(600_000)).toBe('video');
  });
});

describe('parseIsoDuration — ISO 8601 duration to milliseconds', () => {
  it('parses PT30S → 30 000 ms', () => {
    expect(parseIsoDuration('PT30S')).toBe(30_000);
  });

  it('parses PT2M → 120 000 ms', () => {
    expect(parseIsoDuration('PT2M')).toBe(120_000);
  });

  it('parses PT2M3S → 123 000 ms', () => {
    expect(parseIsoDuration('PT2M3S')).toBe(123_000);
  });

  it('parses PT1H2M3S → 3 723 000 ms', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3_723_000);
  });

  it('parses PT1H → 3 600 000 ms', () => {
    expect(parseIsoDuration('PT1H')).toBe(3_600_000);
  });

  it('returns 0 for empty string', () => {
    expect(parseIsoDuration('')).toBe(0);
  });

  it('returns 0 for unrecognised format', () => {
    expect(parseIsoDuration('garbage')).toBe(0);
  });
});
