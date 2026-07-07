import { mergePackIntoChapters } from './church-pack.service';
import type { ChapterChurchPack } from '@cf/shared';

const entry = (chapterIndex: number, overrides: Partial<ChapterChurchPack> = {}): ChapterChurchPack => ({
  chapterIndex,
  bibleRefs: ['John 3:16'],
  discussionQuestions: ['What stood out to you?'],
  devotional: 'A reflection.',
  ...overrides,
});

describe('mergePackIntoChapters', () => {
  const ids = ['ch-a', 'ch-b', 'ch-c'];

  it('maps entries to chapters by index', () => {
    const out = mergePackIntoChapters(ids, [entry(0), entry(2)]);
    expect(out.map((u) => u.chapterId)).toEqual(['ch-a', 'ch-c']);
  });

  it('drops entries with out-of-range indexes instead of mis-assigning', () => {
    const out = mergePackIntoChapters(ids, [entry(0), entry(7)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.chapterId).toBe('ch-a');
  });

  it('keeps only the first entry for a duplicated index', () => {
    const out = mergePackIntoChapters(ids, [
      entry(1, { devotional: 'first' }),
      entry(1, { devotional: 'second' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.devotional).toBe('first');
  });

  it('trims and drops blank strings in list fields', () => {
    const out = mergePackIntoChapters(ids, [
      entry(0, { bibleRefs: [' John 3:16 ', '  '], discussionQuestions: [' Why? ', ''] }),
    ]);
    expect(out[0]!.bibleRefs).toEqual(['John 3:16']);
    expect(out[0]!.discussionQuestions).toEqual(['Why?']);
  });
});
