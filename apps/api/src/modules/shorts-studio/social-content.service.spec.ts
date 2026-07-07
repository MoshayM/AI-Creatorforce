import { socialOutputToRows } from './social-content.service';
import type { SocialContentOutput } from '@cf/shared';

const output: SocialContentOutput = {
  quoteCards: [
    { quote: 'Grace changes everything.', attribution: 'Pastor John', startMs: 120_000 },
    { quote: 'x'.repeat(120), attribution: null, startMs: 30_000 },
    { quote: 'Out of range quote.', attribution: null, startMs: 999_000 },
  ],
  carousel: { title: 'Five takeaways', slides: [
    { heading: 'One', body: 'a' },
    { heading: 'Two', body: 'b' },
    { heading: 'Three', body: 'c' },
  ] },
  blogPost: { title: 'On Grace', markdown: '# On Grace\n...' },
  newsletter: { subject: 'This week: grace', markdown: 'Hi friends...' },
};

describe('socialOutputToRows', () => {
  const rows = socialOutputToRows(output, 600_000);

  it('produces one row per quote card plus carousel, blog, and newsletter', () => {
    expect(rows.map((r) => r.kind)).toEqual(['QUOTE_CARD', 'QUOTE_CARD', 'CAROUSEL', 'BLOG_POST', 'NEWSLETTER']);
  });

  it('drops quotes whose timestamp lies outside the video', () => {
    const quotes = rows.filter((r) => r.kind === 'QUOTE_CARD');
    expect(quotes.some((q) => (q.content as { startMs: number }).startMs === 999_000)).toBe(false);
  });

  it('truncates long quote titles with an ellipsis but keeps the full quote in content', () => {
    const long = rows.find((r) => r.title.endsWith('…'))!;
    expect(long.title.length).toBeLessThanOrEqual(80);
    expect((long.content as { quote: string }).quote).toHaveLength(120);
  });

  it('uses the newsletter subject as its row title', () => {
    expect(rows.find((r) => r.kind === 'NEWSLETTER')!.title).toBe('This week: grace');
  });
});
