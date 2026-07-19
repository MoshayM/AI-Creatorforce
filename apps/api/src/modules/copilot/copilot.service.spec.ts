import { NotFoundException } from '@nestjs/common';
import { CopilotService } from './copilot.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JobsService } from '../jobs/jobs.service';
import type { IntentCacheService } from './intent-cache.service';

const prisma = {
  project: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
  agentJob: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  channel: { findFirst: jest.fn(), findMany: jest.fn() },
  copilotMemory: { findUnique: jest.fn(), upsert: jest.fn() },
  auditLog: { create: jest.fn() },
};

const jobs = { cancel: jest.fn(), enqueue: jest.fn() };
const intentCache = {
  get: jest.fn().mockResolvedValue(null),
  maybeStore: jest.fn().mockResolvedValue(undefined),
};

// Stub every injected service the constructor expects; only the ones under test need real mocks
const noop = {} as never;

function makeService(): CopilotService {
  return new CopilotService(
    prisma as unknown as PrismaService,
    jobs as unknown as JobsService,
    noop, // approvals
    noop, // shorts
    noop, // recommendations
    noop, // generation
    noop, // semanticSearch
    noop, // smallVideos
    noop, // chapterSync
    intentCache as unknown as IntentCacheService,
    noop, // walletService
    noop, // pricingService
    noop, // orgs
  );
}

describe('CopilotService.execute — create_project', () => {
  let service: CopilotService;

  beforeEach(() => {
    service = makeService();
    jest.clearAllMocks();
    prisma.auditLog.create.mockResolvedValue({});
  });

  it('creates a project and returns summary with channel and project title', async () => {
    prisma.channel.findFirst.mockResolvedValue({ id: 'ch-1', title: 'Tech Channel' });
    prisma.project.create.mockResolvedValue({ id: 'proj-1', title: 'AI Deep Dive' });

    const result = await service.execute('user-1', {
      action: 'create_project',
      channelId: 'ch-1',
      title: 'AI Deep Dive',
    });

    expect(result.data).toMatchObject({ projectId: 'proj-1', channelTitle: 'Tech Channel' });
    expect(result.summary).toContain('AI Deep Dive');
    expect(result.summary).toContain('Tech Channel');
    expect(prisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-1', channelId: 'ch-1', title: 'AI Deep Dive', status: 'ACTIVE' }),
      select: { id: true, title: true },
    });
  });

  it('includes niche and topic when provided', async () => {
    prisma.channel.findFirst.mockResolvedValue({ id: 'ch-1', title: 'My Channel' });
    prisma.project.create.mockResolvedValue({ id: 'proj-2', title: 'Fitness Tips' });

    await service.execute('user-1', {
      action: 'create_project',
      channelId: 'ch-1',
      title: 'Fitness Tips',
      niche: 'fitness',
      topic: 'morning workout routines',
    });

    expect(prisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ niche: 'fitness', description: 'morning workout routines' }),
      select: { id: true, title: true },
    });
  });

  it('throws NotFoundException when channel does not belong to the user', async () => {
    prisma.channel.findFirst.mockResolvedValue(null);

    await expect(
      service.execute('user-1', { action: 'create_project', channelId: 'ch-x', title: 'Test' }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.project.create).not.toHaveBeenCalled();
  });
});

describe('CopilotService.execute — cancel_job', () => {
  let service: CopilotService;

  beforeEach(() => {
    service = makeService();
    jest.clearAllMocks();
    prisma.auditLog.create.mockResolvedValue({});
  });

  it('cancels the job and returns its type in the summary', async () => {
    prisma.agentJob.findFirst.mockResolvedValue({ id: 'job-1', type: 'RENDER' });
    jobs.cancel.mockResolvedValue({ id: 'job-1', status: 'CANCELLED' });

    const result = await service.execute('user-1', { action: 'cancel_job', jobId: 'job-1' });

    expect(jobs.cancel).toHaveBeenCalledWith('job-1');
    expect(result.summary).toContain('RENDER');
    expect(result.data).toMatchObject({ jobId: 'job-1' });
  });

  it('throws NotFoundException when job is not owned by the user', async () => {
    prisma.agentJob.findFirst.mockResolvedValue(null);

    await expect(
      service.execute('user-1', { action: 'cancel_job', jobId: 'job-x' }),
    ).rejects.toThrow(NotFoundException);

    expect(jobs.cancel).not.toHaveBeenCalled();
  });

  it('uses ownership guard — cross-user cancel is blocked', async () => {
    prisma.agentJob.findFirst.mockResolvedValue(null);

    await expect(
      service.execute('attacker', { action: 'cancel_job', jobId: 'victim-job' }),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.agentJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'victim-job', project: { userId: 'attacker' } },
    });
  });
});
