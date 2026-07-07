import { UsageLedgerService } from './usage-ledger.service';
import { runWithAiContext } from '../../common/ai-usage.context';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AIUsageEvent } from '@cf/shared';

const event: AIUsageEvent = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  tokensIn: 100,
  tokensOut: 50,
  costUsd: 0.00105,
};

function makeService() {
  const created: unknown[] = [];
  const prisma = {
    tokenUsage: {
      create: jest.fn(({ data }: { data: unknown }) => {
        created.push(data);
        return Promise.resolve(data);
      }),
    },
  } as unknown as PrismaService;
  return { service: new UsageLedgerService(prisma), created };
}

describe('UsageLedgerService.record', () => {
  it('attributes the row from the active AI context', async () => {
    const { service, created } = makeService();
    await runWithAiContext(
      { jobId: 'job-1', projectId: 'proj-1', importedVideoId: 'vid-1' },
      async () => service.record(event),
    );
    expect(created[0]).toMatchObject({
      jobId: 'job-1',
      projectId: 'proj-1',
      importedVideoId: 'vid-1',
      userId: null,
      tokensIn: 100,
      costUsd: 0.00105,
    });
  });

  it('records unattributed rows when no context is active', async () => {
    const { service, created } = makeService();
    service.record(event);
    await Promise.resolve();
    expect(created[0]).toMatchObject({
      jobId: null,
      projectId: null,
      importedVideoId: null,
      userId: null,
      provider: 'anthropic',
    });
  });

  it('accumulates run totals when the context carries an accumulator', async () => {
    const { service } = makeService();
    const accumulator = { costUsd: 0, tokensIn: 0, tokensOut: 0, calls: 0 };
    await runWithAiContext({ jobId: 'job-2', accumulator }, async () => {
      service.record(event);
      service.record(event);
    });
    expect(accumulator.calls).toBe(2);
    expect(accumulator.tokensIn).toBe(200);
    expect(accumulator.tokensOut).toBe(100);
    expect(accumulator.costUsd).toBeCloseTo(0.0021, 10);
  });

  it('survives context nesting across awaits', async () => {
    const { service, created } = makeService();
    await runWithAiContext({ userId: 'user-1' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      service.record(event);
    });
    expect(created[0]).toMatchObject({ userId: 'user-1', jobId: null });
  });
});
