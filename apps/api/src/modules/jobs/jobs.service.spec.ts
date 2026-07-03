import { ServiceUnavailableException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Queue } from 'bullmq';

const prisma = {
  agentJob: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};
const queue = {
  add: jest.fn(),
};

describe('JobsService.enqueue', () => {
  let service: JobsService;

  beforeEach(() => {
    service = new JobsService(prisma as unknown as PrismaService, queue as unknown as Queue);
    jest.clearAllMocks();
  });

  it('creates the job, queues it, then transitions PENDING → QUEUED with a status guard', async () => {
    prisma.agentJob.create.mockResolvedValue({ id: 'job-1' });
    queue.add.mockResolvedValue({});
    prisma.agentJob.updateMany.mockResolvedValue({ count: 1 });

    await service.enqueue('proj-1', 'FACT_CHECK');

    expect(queue.add).toHaveBeenCalledWith(
      'FACT_CHECK',
      expect.objectContaining({ jobId: 'job-1', projectId: 'proj-1', type: 'FACT_CHECK' }),
      expect.objectContaining({ jobId: 'job-1' }),
    );
    // The guard prevents QUEUED from overwriting RUNNING when the worker picks
    // the job up before this write lands (jobs previously stuck as QUEUED forever)
    expect(prisma.agentJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: 'PENDING' },
      data: { status: 'QUEUED' },
    });
    expect(prisma.agentJob.update).not.toHaveBeenCalled();
  });

  it('marks the job FAILED and throws when the queue is unavailable', async () => {
    prisma.agentJob.create.mockResolvedValue({ id: 'job-2' });
    queue.add.mockRejectedValue(new Error('ECONNREFUSED'));
    prisma.agentJob.update.mockResolvedValue({});

    await expect(service.enqueue('proj-1', 'FACT_CHECK')).rejects.toThrow(ServiceUnavailableException);

    expect(prisma.agentJob.update).toHaveBeenCalledWith({
      where: { id: 'job-2' },
      data: { status: 'FAILED', error: expect.stringContaining('Queue unavailable') },
    });
    expect(prisma.agentJob.updateMany).not.toHaveBeenCalled();
  });
});
