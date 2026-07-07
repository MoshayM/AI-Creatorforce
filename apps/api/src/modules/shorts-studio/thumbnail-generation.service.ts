import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fsp, existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { runFfmpeg, escapeFilterPath } from '../media/adapters/ffmpeg.util';

const VARIATIONS = 4;

function findFont(): string | null {
  const candidates = [
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Thumbnail Generator (ai.md Section 13): extracts candidate frames spread
 * across the rendered clip (skipping the first/last 10%) and overlays the
 * highlight's title suggestion. Variations persist as SHORTS_THUMBNAIL
 * assets + ShortsThumbnail rows; the first becomes primary until the user
 * picks another. Skips when thumbnails already exist.
 */
@Injectable()
export class ThumbnailGenerationService {
  private readonly logger = new Logger(ThumbnailGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async ensureThumbnails(shortClipId: string, renderedPath: string, onLog?: (msg: string) => void) {
    const clip = await this.prisma.shortClip.findUnique({
      where: { id: shortClipId },
      include: {
        thumbnails: true,
        timeline: { select: { durationMs: true } },
        topicSegment: { include: { highlight: { select: { titleSuggestion: true } } } },
        chapter: { select: { title: true } },
      },
    });
    if (!clip?.timeline) throw new NotFoundException('Clip not found');
    if (clip.thumbnails.length > 0) {
      onLog?.(`Thumbnails already exist (${clip.thumbnails.length}) — reusing`);
      return { skipped: true, thumbnails: clip.thumbnails.length };
    }

    const durationMs = clip.timeline.durationMs;
    const title = clip.topicSegment?.highlight?.titleSuggestion ?? clip.chapter?.title ?? '';
    const font = findFont();
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-thumb-'));

    onLog?.(`Generating ${VARIATIONS} thumbnail variations…`);
    let created = 0;
    try {
      for (let i = 0; i < VARIATIONS; i++) {
        // Frames at 15% / 38% / 61% / 84% of the clip — avoids intro/outro frames
        const atMs = Math.round(durationMs * (0.15 + (0.7 * i) / Math.max(1, VARIATIONS - 1)));
        const framePath = path.join(tmpDir, `thumb-${i}.jpg`);

        const filters: string[] = [];
        if (font && title) {
          // Alternate top/bottom placement across variations
          const y = i % 2 === 0 ? 'h*0.08' : 'h*0.78';
          const safeTitle = title.replace(/\\/g, '').replace(/'/g, '’').replace(/:/g, '\\:').replace(/%/g, '\\%').slice(0, 60);
          filters.push(
            `drawtext=fontfile='${escapeFilterPath(font)}':text='${safeTitle}':fontcolor=white:borderw=6:bordercolor=black@0.8:fontsize=h*0.055:x=(w-text_w)/2:y=${y}`,
          );
        }
        await runFfmpeg([
          '-ss', String(atMs / 1000),
          '-i', renderedPath,
          ...(filters.length ? ['-vf', filters.join(',')] : []),
          '-frames:v', '1', '-q:v', '3',
          framePath,
        ], 120_000);

        const buffer = await fsp.readFile(framePath);
        const asset = await this.prisma.asset.create({
          data: {
            projectId: clip.projectId,
            kind: 'SHORTS_THUMBNAIL',
            label: `Thumbnail ${i + 1}: ${title || clip.id}`,
            status: 'READY',
          },
        });
        const key = `thumbnails/shorts/${clip.projectId}/${asset.id}.jpg`;
        await this.storage.put(key, buffer);
        const version = await this.prisma.assetVersion.create({
          data: {
            assetId: asset.id,
            version: 1,
            r2Key: key,
            provider: 'ffmpeg',
            sizeBytes: BigInt(buffer.length),
            params: { atMs, variation: i } as never,
          },
        });
        await this.prisma.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id } });
        await this.prisma.shortsThumbnail.create({
          data: { shortClipId, assetId: asset.id, isPrimary: i === 0 },
        });
        created++;
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (!font) this.logger.warn('No usable font found for drawtext — thumbnails generated without title overlay');
    onLog?.(`Thumbnails ready — ${created} variations`);
    return { skipped: false, thumbnails: created };
  }

  async listForClip(shortClipId: string) {
    return this.prisma.shortsThumbnail.findMany({
      where: { shortClipId },
      orderBy: { createdAt: 'asc' },
      include: { asset: { include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true } } } } },
    });
  }

  async setPrimary(thumbnailId: string, userId: string) {
    const thumb = await this.prisma.shortsThumbnail.findFirst({
      where: { id: thumbnailId, shortClip: { project: { userId } } },
    });
    if (!thumb) throw new NotFoundException('Thumbnail not found');
    await this.prisma.$transaction([
      this.prisma.shortsThumbnail.updateMany({ where: { shortClipId: thumb.shortClipId }, data: { isPrimary: false } }),
      this.prisma.shortsThumbnail.update({ where: { id: thumbnailId }, data: { isPrimary: true } }),
    ]);
    return { success: true };
  }
}
