import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma/prisma.service';

jest.mock('@cf/shared', () => ({
  ...jest.requireActual('@cf/shared'),
  embedTexts: jest.fn(),
}));

import { embedTexts } from '@cf/shared';
import { EmbeddingGenerationService } from './embedding-generation.service';

const embedTextsMock = embedTexts as jest.Mock;

const prisma = {
  importedVideo: { findUnique: jest.fn() },
  transcriptSegment: { count: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};

/** Shaped like the error embedTexts throws after its 429 retries are spent. */
const quotaError = Object.assign(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'), {
  status: 429,
});

describe('EmbeddingGenerationService — quota-exhausted provider (readiness item 8)', () => {
  let service: EmbeddingGenerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmbeddingGenerationService(prisma as unknown as PrismaService);
    prisma.importedVideo.findUnique.mockResolvedValue({ id: 'vid-1' });
  });

  it('fails fast when the provider is quota-exhausted — no partial write for the failed chunk', async () => {
    prisma.transcriptSegment.count.mockResolvedValue(2);
    prisma.transcriptSegment.findMany.mockResolvedValue([
      { id: 's1', text: 'hello' },
      { id: 's2', text: 'world' },
    ]);
    embedTextsMock.mockRejectedValue(quotaError);

    await expect(service.ensureEmbeddings('vid-1')).rejects.toThrow(/quota/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('preserves already-persisted chunks when a later chunk hits the quota (resumable)', async () => {
    // 101 pending segments → two chunks; first succeeds, second hits quota.
    const pending = Array.from({ length: 101 }, (_, i) => ({ id: `s${i}`, text: `t${i}` }));
    prisma.transcriptSegment.count.mockResolvedValue(101);
    prisma.transcriptSegment.findMany.mockResolvedValue(pending);
    prisma.$transaction.mockResolvedValue([]);
    embedTextsMock
      .mockResolvedValueOnce({ embeddings: Array.from({ length: 100 }, () => [0.1]), tokensIn: 100 })
      .mockRejectedValueOnce(quotaError);

    await expect(service.ensureEmbeddings('vid-1')).rejects.toThrow(/quota/i);
    // First chunk was persisted before the failure — a re-run resumes from segment 100.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('self-skips without any provider call when every segment is already embedded', async () => {
    prisma.transcriptSegment.count.mockResolvedValue(5);
    prisma.transcriptSegment.findMany.mockResolvedValue([]);

    await expect(service.ensureEmbeddings('vid-1')).resolves.toEqual({ skipped: true, embedded: 5 });
    expect(embedTextsMock).not.toHaveBeenCalled();
  });

  it('rejects for an unknown video', async () => {
    prisma.importedVideo.findUnique.mockResolvedValue(null);
    await expect(service.ensureEmbeddings('nope')).rejects.toThrow(NotFoundException);
  });
});
