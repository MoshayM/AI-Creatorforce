import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EditorService } from './editor.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { JobsService } from '../jobs/jobs.service';
import type { EditTimeline } from '@cf/shared';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeValidTimeline(durationMs = 10_000): EditTimeline {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs,
    tracks: [
      {
        id: 'track-0',
        kind: 'VIDEO',
        label: 'Video',
        items: [
          {
            id: 'item-0',
            sourceAssetId: 'asset-abc',
            kind: 'VIDEO',
            timelineStartMs: 0,
            timelineEndMs: durationMs,
            sourceInMs: 0,
            sourceOutMs: durationMs,
          },
        ],
      },
    ],
  };
}

// ── Mock factories ─────────────────────────────────────────────────────────

function makeEditProjectRow(overrides: Partial<{
  id: string;
  projectId: string;
  title: string;
  status: string;
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  timeline: any;
  renderAssetId: string | null;
  renderStatus: string;
  lastEditedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: 'ep-1',
    projectId: 'proj-1',
    title: 'Test',
    status: 'DRAFT',
    width: 1920,
    height: 1080,
    fps: 30,
    durationMs: 0,
    timeline: {},
    renderAssetId: null,
    renderStatus: 'NONE',
    lastEditedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('EditorService', () => {
  let service: EditorService;

  const mockEditProjectRow = makeEditProjectRow();

  // The editProject model accessor goes through (prisma as any).editProject.
  // We mock it via a Proxy on the prismaMock object.
  const editProjectMock = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const prismaMock = {
    project: { findUnique: jest.fn() },
    importedVideo: { findUnique: jest.fn(), findMany: jest.fn() },
    asset: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    assetVersion: { create: jest.fn() },
    video: { findUnique: jest.fn() },
  };

  // Proxy so (prisma as any).editProject works
  const prismaProxy = new Proxy(prismaMock, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(target: any, prop: string) {
      if (prop === 'editProject') return editProjectMock;
      return target[prop];
    },
  });

  const storageMock = {
    exists: jest.fn().mockReturnValue(false),
    resolve: jest.fn().mockImplementation((key: string) => `/storage/${key}`),
  };

  const jobsMock = {
    enqueue: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditorService,
        { provide: PrismaService, useValue: prismaProxy },
        { provide: StorageService, useValue: storageMock },
        { provide: JobsService, useValue: jobsMock },
      ],
    }).compile();

    service = module.get<EditorService>(EditorService);
  });

  // ── createFromSource — seeds a one-item VIDEO track ──────────────────────

  describe('createFromSource', () => {
    it('seeds a single VIDEO track item spanning the full source duration', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ userId: 'user-1' });
      prismaMock.importedVideo.findUnique.mockResolvedValue({
        id: 'iv-1',
        projectId: 'proj-1',
        title: 'My Video',
        durationMs: 30_000,
        sourceAssetId: 'asset-src',
        sourceAsset: { id: 'asset-src', versions: [] },
      });
      editProjectMock.create.mockResolvedValue({
        ...mockEditProjectRow,
        durationMs: 30_000,
        timeline: {
          width: 1920, height: 1080, fps: 30, durationMs: 30_000,
          tracks: [{ id: 'track-video-0', kind: 'VIDEO', label: 'Video', items: [
            { id: 'item-0', sourceAssetId: 'asset-src', kind: 'VIDEO', timelineStartMs: 0, timelineEndMs: 30_000 },
          ] }],
        },
      });

      const result = await service.createFromSource('proj-1', 'user-1', {
        sourceKind: 'IMPORTED_VIDEO',
        sourceId: 'iv-1',
      });

      expect(editProjectMock.create).toHaveBeenCalledTimes(1);
      const createArg = editProjectMock.create.mock.calls[0][0].data;

      // Single track, single item, spanning full duration
      const timeline = createArg.timeline as EditTimeline;
      expect(timeline.tracks).toHaveLength(1);
      expect(timeline.tracks[0].kind).toBe('VIDEO');
      expect(timeline.tracks[0].items).toHaveLength(1);
      expect(timeline.tracks[0].items[0].timelineStartMs).toBe(0);
      expect(timeline.tracks[0].items[0].timelineEndMs).toBe(30_000);
      expect(timeline.tracks[0].items[0].sourceAssetId).toBe('asset-src');
      expect(createArg.durationMs).toBe(30_000);

      expect(result).toBeDefined();
    });

    it('throws ForbiddenException when project belongs to another user', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ userId: 'other-user' });
      await expect(
        service.createFromSource('proj-1', 'user-1', { sourceKind: 'ASSET', sourceId: 'a1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when project does not exist', async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);
      await expect(
        service.createFromSource('proj-x', 'user-1', { sourceKind: 'ASSET', sourceId: 'a1' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── saveTimeline — validates and recomputes durationMs ───────────────────

  describe('saveTimeline', () => {
    beforeEach(() => {
      prismaMock.project.findUnique.mockResolvedValue({ userId: 'user-1' });
      editProjectMock.findUnique.mockResolvedValue({ ...mockEditProjectRow, renderStatus: 'NONE' });
      editProjectMock.update.mockResolvedValue({ ...mockEditProjectRow, durationMs: 10_000, lastEditedAt: new Date() });
    });

    it('recomputes durationMs as max timelineEndMs', async () => {
      const timeline = makeValidTimeline(10_000);
      await service.saveTimeline('ep-1', 'user-1', timeline);

      expect(editProjectMock.update).toHaveBeenCalledWith({
        where: { id: 'ep-1' },
        data: expect.objectContaining({ durationMs: 10_000 }),
      });
    });

    it('rejects an invalid timeline (missing required fields)', async () => {
      const invalid = { width: 1920, height: 1080 }; // missing fps, durationMs, tracks
      await expect(service.saveTimeline('ep-1', 'user-1', invalid)).rejects.toThrow(BadRequestException);
      expect(editProjectMock.update).not.toHaveBeenCalled();
    });

    it('rejects a timeline with a negative timelineStartMs', async () => {
      const bad: EditTimeline = {
        ...makeValidTimeline(5_000),
        tracks: [
          {
            id: 't0', kind: 'VIDEO', label: 'V',
            items: [{ id: 'i0', kind: 'VIDEO', timelineStartMs: -1, timelineEndMs: 5_000 }],
          },
        ],
      };
      await expect(service.saveTimeline('ep-1', 'user-1', bad)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when EditProject does not exist', async () => {
      editProjectMock.findUnique.mockResolvedValue(null);
      await expect(service.saveTimeline('bad-id', 'user-1', makeValidTimeline())).rejects.toThrow(NotFoundException);
    });
  });

  // ── render — enqueues EDIT_RENDER with idempotency key ───────────────────

  describe('render', () => {
    beforeEach(() => {
      prismaMock.project.findUnique.mockResolvedValue({ userId: 'user-1' });
      editProjectMock.findUnique.mockResolvedValue(mockEditProjectRow);
      editProjectMock.update.mockResolvedValue({ ...mockEditProjectRow, renderStatus: 'QUEUED' });
      jobsMock.enqueue.mockResolvedValue({ id: 'job-123' });
    });

    it('enqueues EDIT_RENDER with the correct idempotency key', async () => {
      const result = await service.render('ep-1', 'user-1', '1080P_16_9');

      expect(jobsMock.enqueue).toHaveBeenCalledWith(
        'proj-1',
        'EDIT_RENDER',
        { editProjectId: 'ep-1', preset: '1080P_16_9' },
        { idempotencyKey: `edit-render:ep-1:${mockEditProjectRow.lastEditedAt.toISOString()}` },
      );
      expect(result.jobId).toBe('job-123');
      expect(result.renderStatus).toBe('QUEUED');
    });

    it('enqueues with SOURCE preset by default when not provided', async () => {
      await service.render('ep-1', 'user-1', 'SOURCE');
      expect(jobsMock.enqueue).toHaveBeenCalledWith(
        'proj-1', 'EDIT_RENDER',
        { editProjectId: 'ep-1', preset: 'SOURCE' },
        expect.objectContaining({ idempotencyKey: expect.stringContaining('edit-render:ep-1:') }),
      );
    });

    it('throws BadRequestException for an invalid preset', async () => {
      await expect(service.render('ep-1', 'user-1', 'INVALID_PRESET')).rejects.toThrow(BadRequestException);
    });
  });

  // ── Ownership failures ────────────────────────────────────────────────────

  describe('ownership checks', () => {
    it('get throws ForbiddenException when project belongs to another user', async () => {
      editProjectMock.findUnique.mockResolvedValue({ ...mockEditProjectRow, projectId: 'proj-1' });
      prismaMock.project.findUnique.mockResolvedValue({ userId: 'other-user' });
      await expect(service.get('ep-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('listByProject throws ForbiddenException for wrong user', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ userId: 'other-user' });
      await expect(service.listByProject('proj-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });

    it('render throws NotFoundException when EditProject not found', async () => {
      editProjectMock.findUnique.mockResolvedValue(null);
      await expect(service.render('bad-ep', 'user-1', 'SOURCE')).rejects.toThrow(NotFoundException);
    });
  });
});
