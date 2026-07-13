import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { JobsService } from './jobs.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Queue } from 'bullmq';

const prisma = {
  agentJob: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
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

  // Wave 17 (risk R-02): enqueue idempotency

  it('returns the existing job on a replayed Idempotency-Key without creating or queueing', async () => {
    const original = { id: 'job-1', status: 'COMPLETED' };
    prisma.agentJob.findUnique.mockResolvedValue(original);

    const job = await service.enqueue('proj-1', 'FACT_CHECK', {}, { idempotencyKey: 'key-1' });

    expect(job).toBe(original);
    expect(prisma.agentJob.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: 'key-1' } });
    expect(prisma.agentJob.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('persists the key on create and returns the concurrent winner on a P2002 race', async () => {
    const winner = { id: 'job-winner' };
    prisma.agentJob.findUnique
      .mockResolvedValueOnce(null) // pre-check: nothing yet
      .mockResolvedValueOnce(winner); // after P2002: the concurrent enqueue won
    prisma.agentJob.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const job = await service.enqueue('proj-1', 'FACT_CHECK', {}, { idempotencyKey: 'key-2' });

    expect(prisma.agentJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ idempotencyKey: 'key-2' }),
    });
    expect(job).toBe(winner);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueues without idempotency machinery when no key is supplied', async () => {
    prisma.agentJob.create.mockResolvedValue({ id: 'job-3' });
    queue.add.mockResolvedValue({});
    prisma.agentJob.updateMany.mockResolvedValue({ count: 1 });

    await service.enqueue('proj-1', 'FACT_CHECK');

    expect(prisma.agentJob.findUnique).not.toHaveBeenCalled();
    expect(prisma.agentJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ idempotencyKey: undefined }),
    });
  });

  // docs4/35: DLQ replay

  it('replays a FAILED job as a fresh enqueue with the same project/type/payload', async () => {
    prisma.agentJob.findUnique.mockResolvedValue({
      id: 'dead-1', projectId: 'proj-1', type: 'RENDER', status: 'FAILED', payload: { sceneCount: 4 },
    });
    prisma.agentJob.create.mockResolvedValue({ id: 'fresh-1' });
    queue.add.mockResolvedValue({});
    prisma.agentJob.updateMany.mockResolvedValue({ count: 1 });

    const fresh = await service.replayFailed('dead-1');

    expect(fresh.id).toBe('fresh-1');
    expect(prisma.agentJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'proj-1', type: 'RENDER', payload: { sceneCount: 4 }, status: 'PENDING' }),
    });
    expect(queue.add).toHaveBeenCalled();
  });

  it('refuses to replay a job that is not dead', async () => {
    prisma.agentJob.findUnique.mockResolvedValue({ id: 'live-1', status: 'RUNNING' });

    await expect(service.replayFailed('live-1')).rejects.toThrow(BadRequestException);
    expect(prisma.agentJob.create).not.toHaveBeenCalled();
  });

  it('404s on an unknown job id', async () => {
    prisma.agentJob.findUnique.mockResolvedValue(null);

    await expect(service.replayFailed('nope')).rejects.toThrow(NotFoundException);
  });
});
