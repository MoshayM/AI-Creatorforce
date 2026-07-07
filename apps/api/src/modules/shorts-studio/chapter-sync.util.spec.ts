import { formatChapterBlock, parseChapterBlock, upsertChapterBlock } from './chapter-sync.util';

describe('formatChapterBlock', () => {
  it('renders m:ss under an hour and h:mm:ss above', () => {
    expect(formatChapterBlock([
      { startMs: 0, title: 'Intro' },
      { startMs: 95_000, title: 'Main point' },
      { startMs: 3_723_000, title: 'Closing' },
    ])).toBe('0:00 Intro\n1:35 Main point\n1:02:03 Closing');
  });
});

describe('parseChapterBlock', () => {
  it('parses a valid chapter list out of a larger description', () => {
    const desc = 'Sermon from Sunday.\n\nChapters:\n0:00 Welcome\n2:30 Worship\n15:00 Message\n\nFollow us!';
    expect(parseChapterBlock(desc)).toEqual([
      { startMs: 0, title: 'Welcome' },
      { startMs: 150_000, title: 'Worship' },
      { startMs: 900_000, title: 'Message' },
    ]);
  });

  it('accepts bullets and dash separators', () => {
    const desc = '- 0:00 - Intro\n• 1:00 – Body\n* 2:00 — End';
    expect(parseChapterBlock(desc).map((c) => c.title)).toEqual(['Intro', 'Body', 'End']);
  });

  it('rejects lists YouTube would not render', () => {
    // fewer than 3
    expect(parseChapterBlock('0:00 A\n1:00 B')).toEqual([]);
    // first not at 0:00
    expect(parseChapterBlock('0:30 A\n1:00 B\n2:00 C')).toEqual([]);
    // not ascending
    expect(parseChapterBlock('0:00 A\n2:00 B\n1:00 C')).toEqual([]);
    // no description
    expect(parseChapterBlock(null)).toEqual([]);
  });

  it('ignores prose containing stray timestamps', () => {
    expect(parseChapterBlock('We start at 0:00 every Sunday')).toEqual([]);
  });
});

describe('upsertChapterBlock', () => {
  const block = '0:00 New intro\n3:00 New body\n9:00 New end';

  it('appends a Chapters section when the description has none', () => {
    expect(upsertChapterBlock('Great sermon.', block)).toBe(`Great sermon.\n\nChapters:\n${block}`);
  });

  it('replaces an existing chapter list in place, keeping surrounding text', () => {
    const desc = 'Intro text.\n\nChapters:\n0:00 Old\n1:00 Older\n2:00 Oldest\n\nOutro text.';
    expect(upsertChapterBlock(desc, block)).toBe(`Intro text.\n\nChapters:\n${block}\n\nOutro text.`);
  });

  it('replaces a header-less timestamp run', () => {
    const desc = '0:00 Old\n1:00 Older\n\nSubscribe!';
    expect(upsertChapterBlock(desc, block)).toBe(`Chapters:\n${block}\n\nSubscribe!`);
  });

  it('handles an empty description', () => {
    expect(upsertChapterBlock('', block)).toBe(`Chapters:\n${block}`);
  });
});
