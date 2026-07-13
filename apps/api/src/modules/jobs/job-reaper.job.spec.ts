import { JobReaperJob } from './job-reaper.job';
import type { PrismaService } from '../../common/prisma/prisma.service';

const prisma = {
  agentJob: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  creditReservation: {
    updateMany: jest.fn(),
  },
};

describe('JobReaperJob.reap — Wave 17 stalled-job sweep (risk R-01)', () => {
  let reaper: JobReaperJob;
  const now = new Date('2026-07-13T12:00:00Z');

  beforeEach(() => {
    reaper = new JobReaperJob(prisma as unknown as PrismaService);
    jest.clearAllMocks();
  });

  it('fails stalled RUNNING rows with a guarded transition and releases their holds', async () => {
    const stalledAt = new Date('2026-07-13T09:00:00Z');
    prisma.agentJob.findMany.mockResolvedValue([{ id: 'job-1', type: 'RENDER', updatedAt: stalledAt }]);
    prisma.agentJob.updateMany.mockResolvedValue({ count: 1 });
    prisma.creditReservation.updateMany.mockResolvedValue({ count: 1 });

    const result = await reaper.reap(now);

    expect(result).toEqual({ reaped: 1, holdsReleased: 1 });
    // Only RUNNING rows at the observed updatedAt may move — a job that
    // completed (or was picked up again) between read and write is untouched.
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: 'RUNNING', updatedAt: stalledAt },
      data: expect.objectContaining({ status: 'FAILED', completedAt: now }),
    });
    expect(prisma.creditReservation.updateMany).toHaveBeenCalledWith({
      where: { status: 'HELD', referenceId: { in: ['job-1'] } },
      data: { status: 'RELEASED' },
    });
  });

  it('queries only RUNNING rows older than the stall deadline', async () => {
    prisma.agentJob.findMany.mockResolvedValue([]);

    await reaper.reap(now);

    const where = prisma.agentJob.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('RUNNING');
    // Default deadline is 120 minutes.
    expect(where.updatedAt.lt).toEqual(new Date('2026-07-13T10:00:00Z'));
  });

  it('does nothing when no job is stalled', async () => {
    prisma.agentJob.findMany.mockResolvedValue([]);

    expect(await reaper.reap(now)).toEqual({ reaped: 0, holdsReleased: 0 });
    expect(prisma.agentJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.creditReservation.updateMany).not.toHaveBeenCalled();
  });

  it('never throws — a failed sweep logs and returns zeros', async () => {
    prisma.agentJob.findMany.mockRejectedValue(new Error('db down'));

    expect(await reaper.reap(now)).toEqual({ reaped: 0, holdsReleased: 0 });
  });
});
