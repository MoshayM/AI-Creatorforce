import { wrapQuote } from './quote-card-render.service';

describe('wrapQuote — drawtext word wrap', () => {
  it('wraps greedily at the width without splitting normal words', () => {
    const lines = wrapQuote('Grace changes everything for everyone who receives it', 26);
    expect(lines.every((l) => l.length <= 26)).toBe(true);
    expect(lines.join(' ')).toBe('Grace changes everything for everyone who receives it');
  });

  it('keeps a short quote on one line', () => {
    expect(wrapQuote('Amazing grace', 26)).toEqual(['Amazing grace']);
  });

  it('hard-splits a single overlong word', () => {
    const lines = wrapQuote('a'.repeat(60), 26);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveLength(26);
  });

  it('truncates with an ellipsis past the line cap', () => {
    const lines = wrapQuote('word '.repeat(100).trim(), 26, 8);
    expect(lines).toHaveLength(8);
    expect(lines[7]!.endsWith('…')).toBe(true);
  });

  it('collapses whitespace runs', () => {
    expect(wrapQuote('  hello    world  ', 26)).toEqual(['hello world']);
  });
});
