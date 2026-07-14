import { NotFoundException } from '@nestjs/common';
import { ShortsStudioService } from './shorts-studio.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JobsService } from '../jobs/jobs.service';

function makeService(owned: boolean) {
  const update = jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
    Promise.resolve({ id: where.id, ...data }),
  );
  const prisma = {
    importedVideo: {
      findFirst: jest.fn(() => Promise.resolve(owned ? { id: 'vid-1', projectId: 'proj-1' } : null)),
      update,
    },
  };
  return { service: new ShortsStudioService(prisma as unknown as PrismaService, {} as JobsService), update };
}

describe('ShortsStudioService.updateNotes', () => {
  it('rejects videos the user does not own', async () => {
    const { service } = makeService(false);
    await expect(service.updateNotes('vid-1', 'user-1', 'hi')).rejects.toThrow(NotFoundException);
  });

  it('saves trimmed non-empty notes as-is', async () => {
    const { service, update } = makeService(true);
    await service.updateNotes('vid-1', 'user-1', 'remember the hook at 02:14');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'vid-1' },
      data: { notes: 'remember the hook at 02:14' },
    });
  });

  it('stores null when notes are empty or whitespace-only', async () => {
    const { service, update } = makeService(true);
    await service.updateNotes('vid-1', 'user-1', '   ');
    expect(update).toHaveBeenCalledWith({ where: { id: 'vid-1' }, data: { notes: null } });

    await service.updateNotes('vid-1', 'user-1', null);
    expect(update).toHaveBeenLastCalledWith({ where: { id: 'vid-1' }, data: { notes: null } });
  });
});
