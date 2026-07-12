import { AnalysisCacheService } from './analysis-cache.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

const ME = 'vid-me';
const TWIN = 'vid-twin';

interface MockPrisma {
  importedVideo: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  assetVersion: { findMany: jest.Mock };
  transcriptSegment: { findMany: jest.Mock; createMany: jest.Mock };
  videoScene: { findMany: jest.Mock; createMany: jest.Mock };
  topicSegment: { findMany: jest.Mock; createMany: jest.Mock };
  $transaction: jest.Mock;
}

/** Prisma mock wired for one twin (same user, same content hash). */
function mockPrisma(opts?: {
  myHash?: string | null;
  twinStatus?: string;
  twinTranscriptRows?: unknown[];
}): MockPrisma {
  const myHash = opts?.myHash === undefined ? 'hash-1' : opts.myHash;
  const prisma: MockPrisma = {
    importedVideo: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        if (where.id === ME) {
          return Promise.resolve({
            sourceAssetId: 'asset-me',
            project: { userId: 'user-1' },
            sourceAsset: myHash ? { versions: [{ contentHash: myHash }] } : { versions: [] },
          });
        }
        return Promise.resolve({ transcriptStatus: opts?.twinStatus ?? 'ASR_GENERATED' });
      }),
      findMany: jest.fn(() => Promise.resolve([{ id: TWIN }])),
      update: jest.fn(() => Promise.resolve({})),
    },
    assetVersion: { findMany: jest.fn(() => Promise.resolve([{ assetId: 'asset-twin' }])) },
    transcriptSegment: {
      findMany: jest.fn(() =>
        Promise.resolve(
          opts?.twinTranscriptRows ?? [
            { startMs: 0, endMs: 900, speakerId: null, text: 'hello', embedding: [0.1] },
            { startMs: 900, endMs: 2_000, speakerId: 's1', text: 'world', embedding: [] },
          ],
        ),
      ),
      createMany: jest.fn(() => Promise.resolve({ count: 2 })),
    },
    videoScene: {
      findMany: jest.fn(() =>
        Promise.resolve([{ startMs: 0, endMs: 5_000, speakerId: null, emotionScores: null, sceneChangeConfidence: 0.4 }]),
      ),
      createMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    topicSegment: {
      findMany: jest.fn(() =>
        Promise.resolve([{ startMs: 0, endMs: 30_000, category: 'STORY', title: 't', summary: 's', confidence: 0.9 }]),
      ),
      createMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

function service(prisma: MockPrisma): AnalysisCacheService {
  return new AnalysisCacheService(prisma as unknown as PrismaService);
}

describe('AnalysisCacheService', () => {
  it('misses when the video has no source content hash yet', async () => {
    const prisma = mockPrisma({ myHash: null });
    const result = await service(prisma).copyTranscript(ME);
    expect(result).toBeNull();
    expect(prisma.assetVersion.findMany).not.toHaveBeenCalled();
    expect(prisma.transcriptSegment.createMany).not.toHaveBeenCalled();
  });

  it('copies transcript rows with the target id and mirrors the twin status', async () => {
    const prisma = mockPrisma({ twinStatus: 'YOUTUBE_CAPTIONS' });
    const result = await service(prisma).copyTranscript(ME);
    expect(result).toEqual({ segments: 2, source: 'YOUTUBE_CAPTIONS' });

    const created = prisma.transcriptSegment.createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
    expect(created.data).toHaveLength(2);
    expect(created.data.every((r) => r['importedVideoId'] === ME)).toBe(true);
    expect(created.data[0]!['embedding']).toEqual([0.1]); // embeddings ride along

    expect(prisma.importedVideo.update).toHaveBeenCalledWith({
      where: { id: ME },
      data: { transcriptStatus: 'YOUTUBE_CAPTIONS' },
    });
  });

  it('skips a twin whose transcript never completed', async () => {
    const prisma = mockPrisma({ twinStatus: 'FAILED' });
    expect(await service(prisma).copyTranscript(ME)).toBeNull();
    expect(prisma.transcriptSegment.createMany).not.toHaveBeenCalled();
  });

  it('skips a twin with zero rows instead of writing an empty copy', async () => {
    const prisma = mockPrisma({ twinTranscriptRows: [] });
    expect(await service(prisma).copyTranscript(ME)).toBeNull();
    expect(prisma.transcriptSegment.createMany).not.toHaveBeenCalled();
  });

  it('restricts twin lookup to the same user and excludes the video itself', async () => {
    const prisma = mockPrisma();
    await service(prisma).copyTranscript(ME);
    const where = (prisma.importedVideo.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where['project']).toEqual({ userId: 'user-1' });
    expect(where['id']).toEqual({ not: ME });
  });

  it('copies scene rows on hit', async () => {
    const prisma = mockPrisma();
    const result = await service(prisma).copyScenes(ME);
    expect(result).toEqual({ scenes: 1 });
    const created = prisma.videoScene.createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
    expect(created.data[0]!['importedVideoId']).toBe(ME);
  });

  it('copies topic segments on hit', async () => {
    const prisma = mockPrisma();
    const result = await service(prisma).copyTopics(ME);
    expect(result).toEqual({ segments: 1 });
    const created = prisma.topicSegment.createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> };
    expect(created.data[0]!['importedVideoId']).toBe(ME);
    expect(created.data[0]!['category']).toBe('STORY');
  });
});
