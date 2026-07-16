import type { PrismaService } from '../../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';

jest.mock('@cf/shared', () => ({
  ...jest.requireActual('@cf/shared'),
  embedTexts: jest.fn(),
}));

import { embedTexts } from '@cf/shared';
import { SemanticSearchService, rankBySimilarity } from './semantic-search.service';

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

describe('SemanticSearchService.search — degraded mode when embeddings are missing (readiness item 8)', () => {
  const prisma = {
    importedVideo: { findUnique: jest.fn() },
    transcriptSegment: { findMany: jest.fn(), count: jest.fn() },
  };
  const wallet = { availableCredits: jest.fn(), debit: jest.fn() };

  it('returns needsEmbeddings without any provider call when the embedding stage was skipped (e.g. Gemini quota exhausted)', async () => {
    const service = new SemanticSearchService(
      prisma as unknown as PrismaService,
      wallet as unknown as WalletService,
    );
    prisma.importedVideo.findUnique.mockResolvedValue({ id: 'vid-1' });
    prisma.transcriptSegment.findMany.mockResolvedValue([]); // no segment has a vector
    prisma.transcriptSegment.count.mockResolvedValue(42);

    await expect(service.search('vid-1', 'the quote about growth')).resolves.toEqual({
      query: 'the quote about growth',
      results: [],
      embeddedSegments: 0,
      totalSegments: 42,
      needsEmbeddings: true,
    });
    // Degrading must be free: no query embedding, no wallet check, no debit.
    expect(embedTexts).not.toHaveBeenCalled();
    expect(wallet.availableCredits).not.toHaveBeenCalled();
    expect(wallet.debit).not.toHaveBeenCalled();
  });
});
