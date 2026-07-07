import { rankBySimilarity } from './semantic-search.service';

describe('rankBySimilarity', () => {
  const items = [
    { item: 'north', vector: [1, 0, 0] },
    { item: 'east', vector: [0, 1, 0] },
    { item: 'northeast', vector: [Math.SQRT1_2, Math.SQRT1_2, 0] },
  ];

  it('ranks by dot product descending', () => {
    const out = rankBySimilarity([1, 0, 0], items, 3);
    expect(out.map((r) => r.item)).toEqual(['north', 'northeast', 'east']);
    expect(out[0]!.score).toBeCloseTo(1);
    expect(out[1]!.score).toBeCloseTo(Math.SQRT1_2);
  });

  it('applies the limit', () => {
    expect(rankBySimilarity([1, 0, 0], items, 2)).toHaveLength(2);
  });

  it('skips vectors with mismatched dimensionality instead of mis-scoring', () => {
    const mixed = [...items, { item: 'stale-768-dim', vector: [1, 0] }];
    const out = rankBySimilarity([1, 0, 0], mixed, 10);
    expect(out.map((r) => r.item)).not.toContain('stale-768-dim');
    expect(out).toHaveLength(3);
  });

  it('returns empty for an empty query vector or no items', () => {
    expect(rankBySimilarity([], items, 5)).toEqual([]);
    expect(rankBySimilarity([1, 0, 0], [], 5)).toEqual([]);
  });
});
