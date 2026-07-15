import { Test, TestingModule } from '@nestjs/testing';
import { AutomationService } from './automation.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { VideoImportService } from '../shorts-studio/video-import.service';
import * as shared from '@cf/shared';

// The compiled package's exports are non-configurable, so jest.spyOn can't
// patch them — replace callAIStructured at the module level instead.
jest.mock('@cf/shared', () => ({
  ...jest.requireActual('@cf/shared'),
  callAIStructured: jest.fn().mockRejectedValue(new Error('AI not mocked in this test')),
}));

describe('AutomationService', () => {
  let service: AutomationService;
  let prismaMock: Record<string, Record<string, jest.Mock>>;
  let jobsMock: Record<string, jest.Mock>;
  let videoImportMock: Record<string, jest.Mock>;

  const channelAutomationMock = {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({
      enabled: false,
      autoImport: false,
      autoAnalyze: false,
      autoPublish: false,
      chapterSyncEnabled: false,
      publishIntervalMinutes: 240,
      maxPublishesPerDay: 2,
      maxImportsPerDay: 3,
      lastTickAt: null,
      aiSuggestion: null,
    }),
    update: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaMock = {
      channel: { findUnique: jest.fn().mockResolvedValue({ userId: 'user-1' }) },
      libraryVideo: { count: jest.fn().mockResolvedValue(7) },
      importedVideo: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      agentJob: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      project: { findMany: jest.fn().mockResolvedValue([{ id: 'proj-1' }]) },
      shortClip: { findMany: jest.fn().mockResolvedValue([]) },
      // channelAutomation is accessed via (prisma as any); shortsExportHistory is a real model
      channelAutomation: channelAutomationMock,
      shortsExportHistory: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    jobsMock = {
      enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    videoImportMock = {
      importFromChannel: jest.fn().mockResolvedValue({ id: 'iv-new' }),
    };

    // Build a proxy so (prisma as any).channelAutomation works
    const prismaProxy = new Proxy(prismaMock, {
      get(target, prop) {
        return target[prop as string];
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationService,
        { provide: PrismaService, useValue: prismaProxy },
        { provide: JobsService, useValue: jobsMock },
        { provide: VideoImportService, useValue: videoImportMock },
      ],
    }).compile();

    service = module.get<AutomationService>(AutomationService);
  });

  // ── Test 1: update() rejects publishIntervalMinutes < 15 ─────────────────────
  it('update() rejects publishIntervalMinutes < 15 with ZodError', async () => {
    await expect(
      service.update('ch-1', 'user-1', {
        enabled: false,
        autoImport: false,
        autoAnalyze: false,
        autoPublish: false,
        chapterSyncEnabled: false,
        publishIntervalMinutes: 10, // too low — min is 15
        maxPublishesPerDay: 2,
        maxImportsPerDay: 3,
      }),
    ).rejects.toThrow();
  });

  // ── Test 2: update() rejects maxPublishesPerDay > 10 ─────────────────────────
  it('update() rejects maxPublishesPerDay > 10 with ZodError', async () => {
    await expect(
      service.update('ch-1', 'user-1', {
        enabled: false,
        autoImport: false,
        autoAnalyze: false,
        autoPublish: false,
        chapterSyncEnabled: false,
        publishIntervalMinutes: 240,
        maxPublishesPerDay: 11, // too high — max is 10
        maxImportsPerDay: 3,
      }),
    ).rejects.toThrow();
  });

  // ── Test 3: suggest() falls back to heuristic when AI throws ─────────────────
  // uploadsPerWeek=7: count=90 over 90 days → 7/wk
  // publishIntervalMinutes = max(120, min(720, round(1440 / max(1, round(7/7*2)))))
  //                        = max(120, min(720, round(1440/2)))
  //                        = max(120, min(720, 720)) = 720
  // maxPublishesPerDay     = max(1, min(4, round(7/7)+1)) = max(1, min(4, 2)) = 2
  it('suggest() falls back to heuristic and verifies math for uploadsPerWeek=7', async () => {
    prismaMock['libraryVideo'].count = jest.fn().mockResolvedValue(90);
    (shared.callAIStructured as jest.Mock).mockRejectedValueOnce(new Error('AI unavailable'));

    const result = await service.suggest('ch-1', 'user-1');

    expect(result.source).toBe('heuristic');
    expect(result.suggestion.publishIntervalMinutes).toBe(720);
    expect(result.suggestion.maxPublishesPerDay).toBe(2);
  });

  // ── Test 4: runTick() enqueues SHORTS_ANALYZE with correct idempotencyKey ─────
  it('runTick() enqueues SHORTS_ANALYZE with idempotencyKey auto-analyze:{id} when autoAnalyze=true', async () => {
    const automationRow = {
      id: 'auto-1',
      channelId: 'ch-1',
      enabled: true,
      autoImport: false,
      autoAnalyze: true,
      autoPublish: false,
      chapterSyncEnabled: false,
      publishIntervalMinutes: 240,
      maxPublishesPerDay: 2,
      maxImportsPerDay: 3,
      lastTickAt: null,
      aiSuggestion: null,
      channel: { userId: 'user-1' },
    };
    prismaMock['channelAutomation'].findMany = jest.fn().mockResolvedValue([automationRow]);
    prismaMock['channelAutomation'].update = jest.fn().mockResolvedValue({});

    prismaMock['importedVideo'].findMany = jest.fn().mockResolvedValue([
      { id: 'iv-1', projectId: 'proj-1' },
    ]);
    prismaMock['agentJob'].findFirst = jest.fn().mockResolvedValue(null);

    await service.runTick();

    expect(jobsMock['enqueue']).toHaveBeenCalledWith(
      'proj-1',
      'SHORTS_ANALYZE',
      { importedVideoId: 'iv-1' },
      { idempotencyKey: 'auto-analyze:iv-1' },
    );
  });

  // ── Test 5: runTick() skips autoPublish when today's publish count >= max ─────
  it('runTick() skips autoPublish when today publish count >= maxPublishesPerDay', async () => {
    const automationRow = {
      id: 'auto-1',
      channelId: 'ch-1',
      enabled: true,
      autoImport: false,
      autoAnalyze: false,
      autoPublish: true,
      chapterSyncEnabled: false,
      publishIntervalMinutes: 240,
      maxPublishesPerDay: 2,
      maxImportsPerDay: 3,
      lastTickAt: null,
      aiSuggestion: null,
      channel: { userId: 'user-1' },
    };
    prismaMock['channelAutomation'].findMany = jest.fn().mockResolvedValue([automationRow]);
    prismaMock['channelAutomation'].update = jest.fn().mockResolvedValue({});

    // Today's publish count equals maxPublishesPerDay (uses ShortsExportHistory)
    prismaMock['shortsExportHistory'].count = jest.fn().mockResolvedValue(2);

    await service.runTick();

    expect(jobsMock['enqueue']).not.toHaveBeenCalledWith(
      expect.anything(),
      'SHORTS_PUBLISH',
      expect.anything(),
      expect.anything(),
    );
  });

  // ── Test 6: runTick() skips autoPublish when last publish is within interval ──
  it('runTick() skips autoPublish when last publish is within interval', async () => {
    const automationRow = {
      id: 'auto-1',
      channelId: 'ch-1',
      enabled: true,
      autoImport: false,
      autoAnalyze: false,
      autoPublish: true,
      chapterSyncEnabled: false,
      publishIntervalMinutes: 240,
      maxPublishesPerDay: 10,
      maxImportsPerDay: 3,
      lastTickAt: null,
      aiSuggestion: null,
      channel: { userId: 'user-1' },
    };
    prismaMock['channelAutomation'].findMany = jest.fn().mockResolvedValue([automationRow]);
    prismaMock['channelAutomation'].update = jest.fn().mockResolvedValue({});

    // Quota not reached
    prismaMock['shortsExportHistory'].count = jest.fn().mockResolvedValue(0);

    // Last publish was only 30 minutes ago (interval is 240 min)
    const recentPublish = new Date(Date.now() - 30 * 60 * 1000);
    prismaMock['shortsExportHistory'].findFirst = jest.fn().mockResolvedValue({
      publishedAt: recentPublish,
    });

    await service.runTick();

    expect(jobsMock['enqueue']).not.toHaveBeenCalledWith(
      expect.anything(),
      'SHORTS_PUBLISH',
      expect.anything(),
      expect.anything(),
    );
  });
});
