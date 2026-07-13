import { AssetGcJob } from './asset-gc.job';
import { StorageService } from '../media/storage.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

const prisma = {
  asset: {
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  importedVideo: { count: jest.fn() },
  shortClip: { count: jest.fn() },
  shortsTimelineItem: { count: jest.fn() },
  shortsThumbnail: { count: jest.fn() },
  shortsExportHistory: { count: jest.fn() },
  timeline: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};
const storage = {
  removePrefix: jest.fn(),
};

function noReferences() {
  prisma.importedVideo.count.mockResolvedValue(0);
  prisma.shortClip.count.mockResolvedValue(0);
  prisma.shortsTimelineItem.count.mockResolvedValue(0);
  prisma.shortsThumbnail.count.mockResolvedValue(0);
  prisma.shortsExportHistory.count.mockResolvedValue(0);
  prisma.timeline.findMany.mockResolvedValue([]);
}

describe('AssetGcJob.sweep — Updates/09 lifecycle (soft-delete → grace → purge)', () => {
  let gc: AssetGcJob;
  const now = new Date('2026-07-13T12:00:00Z');

  beforeEach(() => {
    gc = new AssetGcJob(prisma as unknown as PrismaService, storage as unknown as StorageService);
    jest.clearAllMocks();
    prisma.asset.findMany.mockResolvedValue([]);
    prisma.auditLog.create.mockResolvedValue({});
  });

  it('marks a stale unreferenced live asset soft-deleted with an audit entry', async () => {
    prisma.asset.findMany
      .mockResolvedValueOnce([{ id: 'a1', projectId: 'p1', kind: 'IMAGE' }]) // stage A
      .mockResolvedValueOnce([]); // stage B
    noReferences();
    prisma.asset.update.mockResolvedValue({});

    const result = await gc.sweep(now);

    expect(result).toEqual({ marked: 1, purged: 0 });
    expect(prisma.asset.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { deletedAt: now } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'gc:asset-marked', target: 'a1' }),
    });
    expect(prisma.asset.delete).not.toHaveBeenCalled();
    expect(storage.removePrefix).not.toHaveBeenCalled();
  });

  it('queries stage A with the grace cutoff (default 30 days)', async () => {
    await gc.sweep(now);

    const whereA = prisma.asset.findMany.mock.calls[0][0].where;
    expect(whereA.deletedAt).toBeNull();
    expect(whereA.updatedAt.lt).toEqual(new Date('2026-06-13T12:00:00Z'));
  });

  it('never marks an asset referenced by a foreign key', async () => {
    prisma.asset.findMany
      .mockResolvedValueOnce([{ id: 'a2', projectId: 'p1', kind: 'VIDEO' }])
      .mockResolvedValueOnce([]);
    noReferences();
    prisma.shortsExportHistory.count.mockResolvedValue(1); // export provenance

    expect(await gc.sweep(now)).toEqual({ marked: 0, purged: 0 });
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });

  it('never marks an asset referenced inside a timeline JSON clip', async () => {
    prisma.asset.findMany
      .mockResolvedValueOnce([{ id: 'a3', projectId: 'p1', kind: 'MUSIC' }])
      .mockResolvedValueOnce([]);
    noReferences();
    prisma.timeline.findMany.mockResolvedValue([
      { tracks: { tracks: [{ clips: [{ assetId: 'a3', startMs: 0 }] }] } },
    ]);

    expect(await gc.sweep(now)).toEqual({ marked: 0, purged: 0 });
    expect(prisma.asset.update).not.toHaveBeenCalled();
  });

  it('purges a soft-deleted unreferenced asset past grace: files first, then row, audited', async () => {
    prisma.asset.findMany
      .mockResolvedValueOnce([]) // stage A
      .mockResolvedValueOnce([{ id: 'a4', projectId: 'p9', kind: 'VOICE' }]); // stage B
    noReferences();
    prisma.asset.delete.mockResolvedValue({});

    const result = await gc.sweep(now);

    expect(result).toEqual({ marked: 0, purged: 1 });
    expect(storage.removePrefix).toHaveBeenCalledWith('assets/p9/a4');
    expect(prisma.asset.delete).toHaveBeenCalledWith({ where: { id: 'a4' } });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'gc:asset-purged', target: 'a4' }),
    });
  });

  it('skips purging a soft-deleted asset that is still referenced', async () => {
    prisma.asset.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'a5', projectId: 'p9', kind: 'VIDEO' }]);
    noReferences();
    prisma.importedVideo.count.mockResolvedValue(1);

    expect(await gc.sweep(now)).toEqual({ marked: 0, purged: 0 });
    expect(storage.removePrefix).not.toHaveBeenCalled();
    expect(prisma.asset.delete).not.toHaveBeenCalled();
  });

  it('never throws — a failed sweep logs and returns zeros', async () => {
    prisma.asset.findMany.mockRejectedValue(new Error('db down'));

    expect(await gc.sweep(now)).toEqual({ marked: 0, purged: 0 });
  });
});

describe('StorageService.removePrefix — scope guard', () => {
  const svc = new StorageService();

  it('rejects unscoped prefixes that could wipe a top-level directory', async () => {
    await expect(svc.removePrefix('assets')).rejects.toThrow(/scoped prefix/);
    await expect(svc.removePrefix('/')).rejects.toThrow(/scoped prefix/);
    await expect(svc.removePrefix('')).rejects.toThrow(/scoped prefix/);
  });

  it('accepts a properly scoped prefix (no-op on a missing directory)', async () => {
    await expect(svc.removePrefix('assets/proj-x/asset-y-nonexistent')).resolves.toBeUndefined();
  });
});
