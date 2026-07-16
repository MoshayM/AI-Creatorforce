import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EditorService } from './editor.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { JobsService } from '../jobs/jobs.service';
import type { EditTimeline } from '@cf/shared';

// ── Phase 2 render helpers (re-exported via module for test access) ──────────
// We test translation helpers indirectly by inspecting runFfmpeg call args.
import * as ffmpegUtil from '../media/adapters/ffmpeg.util';

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
        { editProjectId: 'ep-1', preset: '1080P_16_9', format: 'mp4', quality: 'standard' },
        { idempotencyKey: `edit-render:ep-1:${mockEditProjectRow.lastEditedAt.toISOString()}:mp4:standard` },
      );
      expect(result.jobId).toBe('job-123');
      expect(result.renderStatus).toBe('QUEUED');
    });

    it('enqueues with SOURCE preset by default when not provided', async () => {
      await service.render('ep-1', 'user-1', 'SOURCE');
      expect(jobsMock.enqueue).toHaveBeenCalledWith(
        'proj-1', 'EDIT_RENDER',
        { editProjectId: 'ep-1', preset: 'SOURCE', format: 'mp4', quality: 'standard' },
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

  // ── Phase 2 render translation tests ─────────────────────────────────────
  //
  // These tests spy on runFfmpeg/runFfmpegWithProgress and assert that the
  // generated ffmpeg argument arrays contain expected Phase 2 filter strings.
  // No real media files are required — storage.exists() returns true for
  // asset keys, and storage.resolve() returns a predictable /storage/<key>
  // path. All ffmpeg calls are mocked to resolve immediately.

  describe('Phase 2 render translation (runRender)', () => {
    const baseTimeline: EditTimeline = {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 10_000,
      tracks: [
        {
          id: 'track-0',
          kind: 'VIDEO',
          label: 'Video',
          items: [
            {
              id: 'item-0',
              sourceAssetId: 'asset-vid',
              kind: 'VIDEO',
              timelineStartMs: 0,
              timelineEndMs: 10_000,
              sourceInMs: 0,
              sourceOutMs: 10_000,
            },
          ],
        },
      ],
    };

    /** Wire up the full runRender mock stack */
    function setupRunRenderMocks(timelineOverride: EditTimeline = baseTimeline) {
      editProjectMock.findUnique.mockResolvedValue(
        makeEditProjectRow({ renderStatus: 'NONE', timeline: timelineOverride }),
      );
      editProjectMock.update.mockResolvedValue({});
      storageMock.exists.mockReturnValue(true);
      storageMock.resolve.mockImplementation((key: string) => `/storage/${key}`);

      prismaMock.asset.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve({
          id: where.id,
          label: where.id,
          kind: 'VIDEO',
          versions: [{ id: `ver-${where.id}`, r2Key: `keys/${where.id}`, durationMs: 10_000, sizeBytes: 1024 }],
        });
      });
      prismaMock.asset.create.mockResolvedValue({ id: 'new-asset', projectId: 'proj-1', kind: 'EDIT_RENDER', label: 'out' });
      prismaMock.assetVersion.create.mockResolvedValue({ id: 'new-ver', r2Key: 'renders/editor/proj-1/new-asset.mp4', durationMs: 10_000, sizeBytes: BigInt(1024) });
      prismaMock.asset.update.mockResolvedValue({});

      // Mock storage.copyIn (not in storageMock interface by default)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (storageMock as any).copyIn = jest.fn().mockResolvedValue(undefined);
    }

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('back-compat: Phase-1 timeline (no new props) renders with scale filter only — no eq/drawtext/xfade', async () => {
      setupRunRenderMocks();

      const runFfmpegSpy = jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const runFfmpegWithProgressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();

      // Mock fsp.stat and fsp.readFile for the persistence step
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', '1080P_16_9');

      // runFfmpeg is used for segment extraction; check its args contain scale but NOT eq/drawtext/xfade
      const allExtractArgs = runFfmpegSpy.mock.calls.flatMap((c) => c[0]);
      const extractVf = allExtractArgs.find((a) => a.startsWith('scale='));
      expect(extractVf).toContain('scale=1920:1080');
      expect(allExtractArgs.join(' ')).not.toContain('eq=');
      expect(allExtractArgs.join(' ')).not.toContain('drawtext');

      // runFfmpegWithProgress should not include xfade or drawtext
      const allProgressArgs = runFfmpegWithProgressSpy.mock.calls.flatMap((c) => c[0]);
      expect(allProgressArgs.join(' ')).not.toContain('xfade');
      expect(allProgressArgs.join(' ')).not.toContain('drawtext');

      runFfmpegSpy.mockRestore();
      runFfmpegWithProgressSpy.mockRestore();
    });

    it('filters: VIDEO item with brightness/contrast/saturation produces eq= in extraction vf', async () => {
      const timelineWithFilters: EditTimeline = {
        ...baseTimeline,
        tracks: [
          {
            id: 'track-0',
            kind: 'VIDEO',
            label: 'Video',
            items: [
              {
                id: 'item-0',
                sourceAssetId: 'asset-vid',
                kind: 'VIDEO',
                timelineStartMs: 0,
                timelineEndMs: 10_000,
                properties: {
                  filters: { brightness: 0.1, contrast: 1.2, saturation: 1.5 },
                },
              },
            ],
          },
        ],
      };
      setupRunRenderMocks(timelineWithFilters);

      const runFfmpegSpy = jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', '1080P_16_9');

      const extractArgs = runFfmpegSpy.mock.calls.flatMap((c) => c[0]);
      const vfArg = extractArgs[extractArgs.indexOf('-vf') + 1] ?? '';
      expect(vfArg).toContain('eq=brightness=0.1:contrast=1.2:saturation=1.5');

      runFfmpegSpy.mockRestore();
    });

    it('filters: grayscale produces hue=s=0 in extraction vf', async () => {
      const timelineGray: EditTimeline = {
        ...baseTimeline,
        tracks: [
          {
            id: 'track-0',
            kind: 'VIDEO',
            label: 'Video',
            items: [
              {
                id: 'item-0',
                sourceAssetId: 'asset-vid',
                kind: 'VIDEO',
                timelineStartMs: 0,
                timelineEndMs: 10_000,
                properties: { filters: { grayscale: true } },
              },
            ],
          },
        ],
      };
      setupRunRenderMocks(timelineGray);

      const runFfmpegSpy = jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', '1080P_16_9');

      const extractArgs = runFfmpegSpy.mock.calls.flatMap((c) => c[0]);
      const vfArg = extractArgs[extractArgs.indexOf('-vf') + 1] ?? '';
      expect(vfArg).toContain('hue=s=0');

      runFfmpegSpy.mockRestore();
    });

    it('filters: blur produces gblur=sigma= in extraction vf', async () => {
      const timelineBlur: EditTimeline = {
        ...baseTimeline,
        tracks: [
          {
            id: 'track-0',
            kind: 'VIDEO',
            label: 'Video',
            items: [
              {
                id: 'item-0',
                sourceAssetId: 'asset-vid',
                kind: 'VIDEO',
                timelineStartMs: 0,
                timelineEndMs: 10_000,
                properties: { filters: { blur: 5 } },
              },
            ],
          },
        ],
      };
      setupRunRenderMocks(timelineBlur);

      const runFfmpegSpy = jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', '1080P_16_9');

      const extractArgs = runFfmpegSpy.mock.calls.flatMap((c) => c[0]);
      const vfArg = extractArgs[extractArgs.indexOf('-vf') + 1] ?? '';
      expect(vfArg).toContain('gblur=sigma=5');

      runFfmpegSpy.mockRestore();
    });

    it('transition: two VIDEO items with transitionIn produces xfade in filter_complex', async () => {
      const timelineTransition: EditTimeline = {
        width: 1920,
        height: 1080,
        fps: 30,
        durationMs: 20_000,
        tracks: [
          {
            id: 'track-0',
            kind: 'VIDEO',
            label: 'Video',
            items: [
              {
                id: 'item-0',
                sourceAssetId: 'asset-a',
                kind: 'VIDEO',
                timelineStartMs: 0,
                timelineEndMs: 10_000,
              },
              {
                id: 'item-1',
                sourceAssetId: 'asset-b',
                kind: 'VIDEO',
                timelineStartMs: 10_000,
                timelineEndMs: 20_000,
                properties: { transitionIn: { type: 'fade', durationMs: 1000 } },
              },
            ],
          },
        ],
      };
      setupRunRenderMocks(timelineTransition);

      jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const progressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', '1080P_16_9');

      // The first runFfmpegWithProgress call is the xfade/composite pass
      const firstProgressArgs = progressSpy.mock.calls[0]?.[0] ?? [];
      const fcIdx = firstProgressArgs.indexOf('-filter_complex');
      expect(fcIdx).toBeGreaterThanOrEqual(0);
      const fcStr = firstProgressArgs[fcIdx + 1] ?? '';
      expect(fcStr).toContain('xfade');
      expect(fcStr).toContain('transition=fade');

      progressSpy.mockRestore();
    });

    it('transition: slide type produces xfade=transition=slideleft', async () => {
      const timelineSlide: EditTimeline = {
        width: 1920,
        height: 1080,
        fps: 30,
        durationMs: 20_000,
        tracks: [
          {
            id: 'track-0',
            kind: 'VIDEO',
            label: 'Video',
            items: [
              {
                id: 'item-0',
                sourceAssetId: 'asset-a',
                kind: 'VIDEO',
                timelineStartMs: 0,
                timelineEndMs: 10_000,
              },
              {
                id: 'item-1',
                sourceAssetId: 'asset-b',
                kind: 'VIDEO',
                timelineStartMs: 10_000,
                timelineEndMs: 20_000,
                properties: { transitionIn: { type: 'slide', durationMs: 800 } },
              },
            ],
          },
        ],
      };
      setupRunRenderMocks(timelineSlide);

      jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const progressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', '1080P_16_9');

      const firstProgressArgs = progressSpy.mock.calls[0]?.[0] ?? [];
      const fcIdx = firstProgressArgs.indexOf('-filter_complex');
      const fcStr = firstProgressArgs[fcIdx + 1] ?? '';
      expect(fcStr).toContain('transition=slideleft');

      progressSpy.mockRestore();
    });

    it('TEXT item: produces drawtext in second-pass filter_complex when font resolves', async () => {
      // Mock resolveFont to return a known path so drawtext is attempted
      jest.spyOn(require('fs'), 'existsSync').mockImplementation((p: unknown) => {
        // Pretend arialbd.ttf exists so resolveFont() returns it
        if (typeof p === 'string' && p.includes('arial')) return true;
        return false;
      });

      const timelineWithText: EditTimeline = {
        width: 1920,
        height: 1080,
        fps: 30,
        durationMs: 10_000,
        tracks: [
          {
            id: 'track-0',
            kind: 'VIDEO',
            label: 'Video',
            items: [
              {
                id: 'item-0',
                sourceAssetId: 'asset-vid',
                kind: 'VIDEO',
                timelineStartMs: 0,
                timelineEndMs: 10_000,
              },
            ],
          },
          {
            id: 'track-text',
            kind: 'TEXT',
            label: 'Text',
            items: [
              {
                id: 'text-0',
                kind: 'TEXT',
                timelineStartMs: 1000,
                timelineEndMs: 5000,
                properties: {
                  text: 'Hello World',
                  fontSize: 60,
                  color: 'white',
                  textAnim: 'fade-in',
                },
              },
            ],
          },
        ],
      };
      setupRunRenderMocks(timelineWithText);

      jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const progressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);

      await service.runRender('ep-1', '1080P_16_9');

      // Second pass (drawtext) is the last runFfmpegWithProgress call
      const lastProgressArgs = progressSpy.mock.calls[progressSpy.mock.calls.length - 1]?.[0] ?? [];
      const fcIdx = lastProgressArgs.indexOf('-filter_complex');
      const fcStr = fcIdx >= 0 ? (lastProgressArgs[fcIdx + 1] ?? '') : '';
      expect(fcStr).toContain('drawtext');
      expect(fcStr).toContain('Hello World');
      // fade-in anim: alpha expression should be present
      expect(fcStr).toContain('alpha=');
      // x/y must be single-quoted: animated expressions (slide-up) contain
      // commas that split the filtergraph when unquoted (regression: renders
      // with textAnim slide-up failed with FFMPEG_EXECUTION_FAILED).
      expect(fcStr).toMatch(/x='[^']*'/);
      expect(fcStr).toMatch(/y='[^']*'/);

      progressSpy.mockRestore();
      jest.restoreAllMocks();
    });

    it('TEXT item without font: logs warning, no drawtext, no crash', async () => {
      // existsSync returns false → resolveFont() returns null
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(false);

      const timelineTextNoFont: EditTimeline = {
        width: 1920,
        height: 1080,
        fps: 30,
        durationMs: 10_000,
        tracks: [
          {
            id: 'track-0',
            kind: 'VIDEO',
            label: 'Video',
            items: [
              {
                id: 'item-0',
                sourceAssetId: 'asset-vid',
                kind: 'VIDEO',
                timelineStartMs: 0,
                timelineEndMs: 10_000,
              },
            ],
          },
          {
            id: 'track-text',
            kind: 'TEXT',
            label: 'Text',
            items: [
              {
                id: 'text-0',
                kind: 'TEXT',
                timelineStartMs: 0,
                timelineEndMs: 5000,
                properties: { text: 'Hello', textAnim: 'none' },
              },
            ],
          },
        ],
      };
      setupRunRenderMocks(timelineTextNoFont);

      jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const progressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      const logs: string[] = [];
      // Should NOT throw
      await expect(service.runRender('ep-1', '1080P_16_9', (msg) => logs.push(msg))).resolves.toBeDefined();

      expect(logs.some((l) => l.includes('no usable font'))).toBe(true);

      // No drawtext in any progress call args
      const allProgressArgs = progressSpy.mock.calls.flatMap((c) => c[0]);
      expect(allProgressArgs.join(' ')).not.toContain('drawtext');

      progressSpy.mockRestore();
      jest.restoreAllMocks();
    });

    it('Phase-1 back-compat: schema still validates a timeline with no Phase-2 props', () => {
      const { EditTimelineSchema } = require('@cf/shared');
      const result = EditTimelineSchema.safeParse(baseTimeline);
      expect(result.success).toBe(true);
    });

    it('schema: rejects out-of-range filter values', () => {
      const { EditItemPropertiesSchema } = require('@cf/shared');
      // brightness > 1 should fail
      const bad = EditItemPropertiesSchema.safeParse({
        filters: { brightness: 5 },
      });
      expect(bad.success).toBe(false);
    });

    it('schema: accepts all Phase-2 properties together', () => {
      const { EditItemPropertiesSchema } = require('@cf/shared');
      const result = EditItemPropertiesSchema.safeParse({
        filters: { brightness: 0.2, contrast: 1.1, saturation: 1.0, grayscale: false, blur: 3 },
        transitionIn: { type: 'fade', durationMs: 500 },
        textAnim: 'slide-up',
        keyframes: [
          { atMs: 0, opacity: 0, x: 100, y: 200 },
          { atMs: 2000, opacity: 1, x: 50, y: 100 },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  // ── Phase 3 render tests ───────────────────────────────────────────────────

  describe('Phase 3: audio mixing + export format', () => {
    // Re-use the Phase 2 mock setup helper
    const baseP3Timeline: EditTimeline = {
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 10_000,
      tracks: [
        {
          id: 'track-0',
          kind: 'VIDEO',
          label: 'Video',
          items: [
            {
              id: 'item-0',
              sourceAssetId: 'asset-vid',
              kind: 'VIDEO',
              timelineStartMs: 0,
              timelineEndMs: 10_000,
            },
          ],
        },
      ],
    };

    /** Wire up the full runRender mock stack */
    function setupP3Mocks(timelineOverride: EditTimeline = baseP3Timeline) {
      editProjectMock.findUnique.mockResolvedValue(
        makeEditProjectRow({ renderStatus: 'NONE', timeline: timelineOverride }),
      );
      editProjectMock.update.mockResolvedValue({});
      storageMock.exists.mockReturnValue(true);
      storageMock.resolve.mockImplementation((key: string) => `/storage/${key}`);
      prismaMock.asset.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve({
          id: where.id,
          label: where.id,
          kind: 'VIDEO',
          versions: [{ id: `ver-${where.id}`, r2Key: `keys/${where.id}`, durationMs: 10_000, sizeBytes: 1024 }],
        });
      });
      prismaMock.asset.create.mockResolvedValue({ id: 'new-asset', projectId: 'proj-1', kind: 'EDIT_RENDER', label: 'out' });
      prismaMock.assetVersion.create.mockResolvedValue({ id: 'new-ver', r2Key: 'renders/editor/proj-1/new-asset.mp4', durationMs: 10_000, sizeBytes: BigInt(1024) });
      prismaMock.asset.update.mockResolvedValue({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (storageMock as any).copyIn = jest.fn().mockResolvedValue(undefined);
    }

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('multi-audio: two AUDIO-track items produce amix with volume/adelay in filter_complex', async () => {
      const multiAudioTimeline: EditTimeline = {
        ...baseP3Timeline,
        tracks: [
          {
            id: 'track-0',
            kind: 'VIDEO',
            label: 'Video',
            items: [
              {
                id: 'item-0',
                sourceAssetId: 'asset-vid',
                kind: 'VIDEO',
                timelineStartMs: 0,
                timelineEndMs: 10_000,
                properties: { volume: 0.8 },
              },
            ],
          },
          {
            id: 'track-audio-1',
            kind: 'AUDIO',
            label: 'Voice',
            items: [
              {
                id: 'audio-0',
                sourceAssetId: 'asset-voice',
                kind: 'AUDIO',
                timelineStartMs: 0,
                timelineEndMs: 10_000,
                properties: { volume: 1.0, fadeInMs: 500 },
              },
            ],
          },
          {
            id: 'track-audio-2',
            kind: 'AUDIO',
            label: 'Music',
            items: [
              {
                id: 'audio-1',
                sourceAssetId: 'asset-music',
                kind: 'AUDIO',
                timelineStartMs: 2_000,
                timelineEndMs: 10_000,
                properties: { volume: 0.3, duckUnderVoice: false, gainDb: -3 },
              },
            ],
          },
        ],
      };
      setupP3Mocks(multiAudioTimeline);

      jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const progressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', '1080P_16_9');

      // The final pass (last runFfmpegWithProgress) should have amix + volume + afade
      const allProgressCalls = progressSpy.mock.calls;
      const lastCall = allProgressCalls[allProgressCalls.length - 1]!;
      const lastArgs = lastCall[0] ?? [];
      const fcIdx = lastArgs.indexOf('-filter_complex');
      expect(fcIdx).toBeGreaterThanOrEqual(0);
      const fcStr = lastArgs[fcIdx + 1] ?? '';

      // amix with >= 2 sources (VIDEO audio + voice + music = 3)
      expect(fcStr).toContain('amix=inputs=');
      // volume filter present
      expect(fcStr).toContain('volume=');
      // afade for the voice item (fadeInMs: 500)
      expect(fcStr).toContain('afade=t=in');
      // adelay for music (offsetMs 2000)
      expect(fcStr).toContain('adelay=2000|2000');

      progressSpy.mockRestore();
    });

    it('webm export: second-pass uses libvpx-vp9 and libopus, outPath ends in .webm', async () => {
      setupP3Mocks();

      jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const progressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 2048 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', { preset: '1080P_16_9', format: 'webm', quality: 'standard' });

      // The final output pass should use libvpx-vp9 and libopus
      const allCalls = progressSpy.mock.calls;
      const lastArgs = allCalls[allCalls.length - 1]?.[0] ?? [];

      // codec check
      expect(lastArgs.join(' ')).toContain('libvpx-vp9');
      expect(lastArgs.join(' ')).toContain('libopus');
      // output path ends in .webm
      const outArg = lastArgs[lastArgs.length - 1] ?? '';
      expect(outArg).toMatch(/\.webm$/);

      progressSpy.mockRestore();
    });

    it('quality=draft uses high CRF (28 for mp4)', async () => {
      setupP3Mocks();

      jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const progressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', { preset: 'SOURCE', format: 'mp4', quality: 'draft' });

      const allCalls = progressSpy.mock.calls;
      const lastArgs = allCalls[allCalls.length - 1]?.[0] ?? [];
      expect(lastArgs.join(' ')).toContain('-crf 28');

      progressSpy.mockRestore();
    });

    it('quality=high uses low CRF (18 for mp4) and slow preset', async () => {
      setupP3Mocks();

      jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const progressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      await service.runRender('ep-1', { preset: 'SOURCE', format: 'mp4', quality: 'high' });

      const allCalls = progressSpy.mock.calls;
      const lastArgs = allCalls[allCalls.length - 1]?.[0] ?? [];
      const argsStr = lastArgs.join(' ');
      expect(argsStr).toContain('-crf 18');
      expect(argsStr).toContain('-preset slow');

      progressSpy.mockRestore();
    });

    it('Phase-1/2 back-compat: bare string preset with no audio props still renders as mp4', async () => {
      setupP3Mocks();

      jest.spyOn(ffmpegUtil, 'runFfmpeg').mockResolvedValue();
      const progressSpy = jest.spyOn(ffmpegUtil, 'runFfmpegWithProgress').mockResolvedValue();
      jest.spyOn(require('fs').promises, 'stat').mockResolvedValue({ size: 1024 } as never);
      jest.spyOn(require('fs').promises, 'readFile').mockResolvedValue(Buffer.from('fake'));
      jest.spyOn(require('fs').promises, 'mkdtemp').mockResolvedValue('/tmp/cf-edit-test');
      jest.spyOn(require('fs').promises, 'rm').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'rename').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'writeFile').mockResolvedValue(undefined);
      jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as never);

      const result = await service.runRender('ep-1', '1080P_16_9');
      expect(result).toBeDefined();
      expect(result.key).toMatch(/\.mp4$/);

      // No webm codec in any call
      const allArgs = progressSpy.mock.calls.flatMap((c) => c[0]);
      expect(allArgs.join(' ')).not.toContain('libvpx-vp9');
      expect(allArgs.join(' ')).not.toContain('libopus');

      progressSpy.mockRestore();
    });

    it('render(): accepts EditExportOptions object with format=webm', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ userId: 'user-1' });
      editProjectMock.findUnique.mockResolvedValue(makeEditProjectRow());
      editProjectMock.update.mockResolvedValue({ ...makeEditProjectRow(), renderStatus: 'QUEUED' });
      jobsMock.enqueue.mockResolvedValue({ id: 'job-webm' });

      const result = await service.render('ep-1', 'user-1', {
        preset: '1080P_16_9',
        format: 'webm',
        quality: 'high',
      });

      expect(result.jobId).toBe('job-webm');
      expect(jobsMock.enqueue).toHaveBeenCalledWith(
        'proj-1',
        'EDIT_RENDER',
        { editProjectId: 'ep-1', preset: '1080P_16_9', format: 'webm', quality: 'high' },
        expect.objectContaining({ idempotencyKey: expect.stringContaining(':webm:high') }),
      );
    });

    it('render(): bare preset string still works (back-compat)', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ userId: 'user-1' });
      editProjectMock.findUnique.mockResolvedValue(makeEditProjectRow());
      editProjectMock.update.mockResolvedValue({ ...makeEditProjectRow(), renderStatus: 'QUEUED' });
      jobsMock.enqueue.mockResolvedValue({ id: 'job-mp4' });

      const result = await service.render('ep-1', 'user-1', '1080P_16_9');
      expect(result.jobId).toBe('job-mp4');
      expect(jobsMock.enqueue).toHaveBeenCalledWith(
        'proj-1',
        'EDIT_RENDER',
        { editProjectId: 'ep-1', preset: '1080P_16_9', format: 'mp4', quality: 'standard' },
        expect.objectContaining({ idempotencyKey: expect.stringContaining(':mp4:standard') }),
      );
    });

    it('schema: EditExportOptionsSchema validates correctly', () => {
      const { EditExportOptionsSchema } = require('@cf/shared');

      const valid = EditExportOptionsSchema.safeParse({ preset: '1080P_16_9', format: 'webm', quality: 'high' });
      expect(valid.success).toBe(true);

      // Missing format/quality => uses defaults
      const defaults = EditExportOptionsSchema.safeParse({ preset: 'SOURCE' });
      expect(defaults.success).toBe(true);
      if (defaults.success) {
        expect(defaults.data.format).toBe('mp4');
        expect(defaults.data.quality).toBe('standard');
      }

      const invalid = EditExportOptionsSchema.safeParse({ preset: 'INVALID' });
      expect(invalid.success).toBe(false);
    });

    it('schema: Phase 3 audio props accepted by EditItemPropertiesSchema', () => {
      const { EditItemPropertiesSchema } = require('@cf/shared');

      const result = EditItemPropertiesSchema.safeParse({
        volume: 0.8,
        fadeInMs: 500,
        fadeOutMs: 1000,
        gainDb: -6,
        duckUnderVoice: true,
      });
      expect(result.success).toBe(true);

      // gainDb out of range
      const bad = EditItemPropertiesSchema.safeParse({ gainDb: 100 });
      expect(bad.success).toBe(false);

      // fadeInMs negative
      const bad2 = EditItemPropertiesSchema.safeParse({ fadeInMs: -1 });
      expect(bad2.success).toBe(false);
    });
  });
});
