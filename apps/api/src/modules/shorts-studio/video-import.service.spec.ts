import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VideoImportService, SHORTS_CONTAINER_PROJECT_TITLE } from './video-import.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { StorageService } from '../media/storage.service';
import type { YouTubeReadService } from './youtube-read.service';

const USER = 'user-1';
const CHANNEL = 'chan-1';
const YT_ID = 'yt-abc';

interface MockPrisma {
  channel: { findFirst: jest.Mock };
  libraryVideo: { findUnique: jest.Mock };
  importedVideo: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  project: { findFirst: jest.Mock; create: jest.Mock };
}

function mockPrisma(opts?: {
  channelOwned?: boolean;
  libraryRow?: Record<string, unknown> | null;
  existingImportId?: string | null;
  containerProjectId?: string | null;
}): MockPrisma {
  return {
    channel: {
      findFirst: jest.fn(() =>
        Promise.resolve(opts?.channelOwned === false ? null : { id: CHANNEL, title: 'My Channel' }),
      ),
    },
    libraryVideo: {
      findUnique: jest.fn(() =>
        Promise.resolve(
          opts?.libraryRow === undefined
            ? {
                title: 'Lib title',
                description: 'Lib description',
                durationMs: 120_000,
                thumbnailUrl: 'https://t/img.jpg',
                viewCount: 42,
                likeCount: 7,
                commentCount: 3,
              }
            : opts.libraryRow,
        ),
      ),
    },
    importedVideo: {
      findFirst: jest.fn(() =>
        Promise.resolve(opts?.existingImportId ? { id: opts.existingImportId } : null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'imported-new', ...data }),
      ),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ id: where.id, ...data }),
      ),
    },
    project: {
      findFirst: jest.fn(() =>
        Promise.resolve(opts?.containerProjectId ? { id: opts.containerProjectId } : null),
      ),
      create: jest.fn(() => Promise.resolve({ id: 'proj-container' })),
    },
  };
}

function makeService(prisma: MockPrisma, youtubeRead?: Partial<YouTubeReadService>) {
  return new VideoImportService(
    prisma as unknown as PrismaService,
    {} as StorageService,
    (youtubeRead ?? { getVideoMetadata: jest.fn() }) as YouTubeReadService,
  );
}

describe('VideoImportService.importFromChannel', () => {
  it('rejects channels the user does not own', async () => {
    const prisma = mockPrisma({ channelOwned: false });
    await expect(makeService(prisma).importFromChannel(USER, CHANNEL, YT_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('imports from the synced library row without calling YouTube', async () => {
    const prisma = mockPrisma();
    const getVideoMetadata = jest.fn();
    const result = await makeService(prisma, { getVideoMetadata }).importFromChannel(USER, CHANNEL, YT_ID);

    expect(getVideoMetadata).not.toHaveBeenCalled();
    expect(prisma.importedVideo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'proj-container',
        youtubeVideoId: YT_ID,
        title: 'Lib title',
        durationMs: 120_000,
        viewCount: BigInt(42),
      }),
    });
    expect(result).toMatchObject({ youtubeVideoId: YT_ID });
  });

  it('creates the container project once and reuses it afterwards', async () => {
    const fresh = mockPrisma();
    await makeService(fresh).importFromChannel(USER, CHANNEL, YT_ID);
    expect(fresh.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: SHORTS_CONTAINER_PROJECT_TITLE, channelId: CHANNEL }),
      }),
    );

    const reused = mockPrisma({ containerProjectId: 'proj-existing' });
    await makeService(reused).importFromChannel(USER, CHANNEL, YT_ID);
    expect(reused.project.create).not.toHaveBeenCalled();
    expect(reused.importedVideo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ projectId: 'proj-existing' }),
    });
  });

  it('refreshes a video already imported into any project of the channel instead of duplicating', async () => {
    const prisma = mockPrisma({ existingImportId: 'imported-old' });
    await makeService(prisma).importFromChannel(USER, CHANNEL, YT_ID);

    expect(prisma.importedVideo.update).toHaveBeenCalledWith({
      where: { id: 'imported-old' },
      data: expect.objectContaining({ title: 'Lib title' }),
    });
    expect(prisma.importedVideo.create).not.toHaveBeenCalled();
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('falls back to live YouTube metadata when the library row is missing', async () => {
    const prisma = mockPrisma({ libraryRow: null });
    const getVideoMetadata = jest.fn(() =>
      Promise.resolve({
        title: 'Live title',
        description: 'Live description',
        durationMs: 90_000.4,
        thumbnailUrl: null,
        viewCount: null,
        likeCount: null,
        commentCount: null,
      }),
    );
    await makeService(prisma, { getVideoMetadata: getVideoMetadata as never }).importFromChannel(
      USER,
      CHANNEL,
      YT_ID,
    );

    expect(getVideoMetadata).toHaveBeenCalledWith(CHANNEL, YT_ID);
    expect(prisma.importedVideo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Live title', durationMs: 90_000 }),
    });
  });

  it('falls back to live metadata when the library row has no duration, and rejects zero-duration videos', async () => {
    const zeroDurationLib = mockPrisma({
      libraryRow: { title: 'Lib', description: null, durationMs: 0, thumbnailUrl: null, viewCount: 0, likeCount: 0, commentCount: 0 },
    });
    const getVideoMetadata = jest.fn(() =>
      Promise.resolve({ title: 'x', description: null, durationMs: 0, thumbnailUrl: null, viewCount: null, likeCount: null, commentCount: null }),
    );
    await expect(
      makeService(zeroDurationLib, { getVideoMetadata: getVideoMetadata as never }).importFromChannel(USER, CHANNEL, YT_ID),
    ).rejects.toThrow(BadRequestException);
    expect(getVideoMetadata).toHaveBeenCalled();
  });
});
