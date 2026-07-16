import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { runFfmpeg, runFfmpegCapture, escapeFilterPath } from '../media/adapters/ffmpeg.util';
import { buildSrt } from '../media/subtitle.util';
import { CLIP_TYPE_PRESETS } from './clip-type-presets';
import { SmartReframeService } from './smart-reframe.service';
import { buildCxExpr } from './reframe-path';
import { videoSpans } from './timeline-map.util';
import { ThumbnailGenerationService } from './thumbnail-generation.service';

const OUTPUT_BY_ASPECT: Record<'9:16' | '1:1' | '16:9', { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
};

let nvencAvailable: boolean | undefined;

/**
 * SHORTS_RENDER job (ai.md Sections 12, 15, 23): timeline video spans →
 * per-segment extract + reframe crop + scale (pass 1, checkpointed per
 * segment in ShortsRenderJob.checkpointData) → concat + caption burn-in +
 * encode (pass 2). GPU encode via h264_nvenc when the local FFmpeg exposes
 * it, transparent libx264 fallback otherwise.
 *
 * Resume rule 16.2-style: an up-to-date render (newer than the timeline's
 * last edit) is never re-rendered.
 */
@Injectable()
export class ShortsRenderService {
  private readonly logger = new Logger(ShortsRenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly reframe: SmartReframeService,
    private readonly thumbnails: ThumbnailGenerationService,
  ) {}

  async renderClip(shortClipId: string, jobId: string, onLog?: (msg: string) => void) {
    const clip = await this.prisma.shortClip.findUnique({
      where: { id: shortClipId },
      include: {
        timeline: {
          include: {
            tracks: { where: { type: 'VIDEO' }, include: { items: { orderBy: { startMs: 'asc' }, include: { sourceAsset: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } } } } },
            captions: { orderBy: { startMs: 'asc' } },
          },
        },
        renderAsset: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } },
        topicSegment: { include: { highlight: { select: { titleSuggestion: true } } } },
        chapter: { select: { title: true } },
      },
    });
    if (!clip?.timeline) throw new NotFoundException('Clip or timeline not found');

    // Skip when the existing render is newer than the last timeline edit
    const existingKey = clip.renderAsset?.versions[0]?.r2Key;
    if (existingKey && this.storage.exists(existingKey) && clip.renderAsset!.createdAt > clip.timeline.updatedAt) {
      onLog?.('Render is up to date — reusing existing output');
      return { skipped: true, assetId: clip.renderAssetId, key: existingKey };
    }

    const renderJob = await this.prisma.shortsRenderJob.create({
      data: { shortClipId, jobId, status: 'RUNNING', ffmpegPass: 1 },
    });

    try {
      const preset = CLIP_TYPE_PRESETS[clip.clipType];
      const out = OUTPUT_BY_ASPECT[preset.aspect];
      const spans = videoSpans(clip.timeline.tracks.flatMap((t) => t.items));
      if (spans.length === 0) throw new BadRequestException('Timeline has no video items to render');

      const sourceItem = clip.timeline.tracks.flatMap((t) => t.items).find((i) => i.sourceAsset?.versions[0]?.r2Key);
      const sourceKey = sourceItem?.sourceAsset?.versions[0]?.r2Key;
      if (!sourceKey || !this.storage.exists(sourceKey)) {
        throw new BadRequestException('Source video file is missing — re-run the import pipeline');
      }
      const sourcePath = this.storage.resolve(sourceKey);

      const keyframes = await this.reframe.ensureKeyframes(shortClipId, { sourcePath, spans });

      await this.prisma.shortClip.update({ where: { id: shortClipId }, data: { status: 'RENDERING' } });

      // ── Pass 1: extract + reframe each span ──────────────────────────────────
      const workDir = path.join(os.tmpdir(), `cf-render-${shortClipId}`);
      await fsp.mkdir(workDir, { recursive: true });
      const encoder = await this.pickEncoder();
      onLog?.(`Rendering ${spans.length} segment(s) at ${out.width}×${out.height} (${encoder}, ${keyframes.length} reframe keyframe(s))…`);

      const segmentPaths: string[] = [];
      for (let i = 0; i < spans.length; i++) {
        const span = spans[i]!;
        // Crop x follows the face/motion path: buildCxExpr returns a constant
        // when the subject doesn't move, or a piecewise-linear pan in
        // segment-relative t. The whole x option stays single-quoted — the
        // expression contains commas, which split the filtergraph unquoted.
        const cxExpr = buildCxExpr(keyframes, span.timelineStartMs, span.timelineEndMs);
        const crop = preset.aspect === '16:9'
          ? `scale=${out.width}:${out.height}:force_original_aspect_ratio=decrease,pad=${out.width}:${out.height}:(ow-iw)/2:(oh-ih)/2`
          : `crop='min(iw,ih*${out.width}/${out.height})':'ih':'(iw-min(iw,ih*${out.width}/${out.height}))*(${cxExpr})':'0',scale=${out.width}:${out.height}`;
        const segPath = path.join(workDir, `seg-${i}.mp4`);
        segmentPaths.push(segPath);
        if (await fsp.stat(segPath).then((s) => s.size > 0).catch(() => false)) {
          onLog?.(`Segment ${i + 1}/${spans.length} already rendered — reusing`);
          continue;
        }
        await this.encodeWithFallback(encoder, [
          '-ss', String(span.sourceStartMs / 1000),
          '-t', String((span.sourceEndMs - span.sourceStartMs) / 1000),
          '-i', sourcePath,
          '-vf', crop,
          '-r', '30',
          '-c:a', 'aac', '-b:a', '128k',
          segPath,
        ]);
        await this.prisma.shortsRenderJob.update({
          where: { id: renderJob.id },
          data: { status: 'CHECKPOINTED', checkpointData: { pass: 1, segmentsDone: i + 1, total: spans.length } as never },
        });
        onLog?.(`Segment ${i + 1}/${spans.length} rendered`);
      }

      // ── Pass 2: concat + captions + final encode ─────────────────────────────
      await this.prisma.shortsRenderJob.update({
        where: { id: renderJob.id },
        data: { status: 'RUNNING', ffmpegPass: 2 },
      });
      const listPath = path.join(workDir, 'list.txt');
      await fsp.writeFile(listPath, segmentPaths.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));

      const finalPath = path.join(workDir, 'final.mp4');
      const args = ['-f', 'concat', '-safe', '0', '-i', listPath];
      if (clip.timeline.captions.length > 0) {
        const srtPath = path.join(workDir, 'captions.srt');
        await fsp.writeFile(srtPath, buildSrt(clip.timeline.captions.map((c) => ({
          startMs: c.startMs,
          endMs: c.endMs,
          text: `${c.text}${c.emoji ? ` ${c.emoji}` : ''}`,
        }))));
        // Bottom margin respects the platform safe zone (ai.md Section 7)
        const marginV = Math.round(out.height * Math.max(preset.safeZone.bottom, 0.05));
        args.push('-vf', `subtitles='${escapeFilterPath(srtPath)}':force_style='FontSize=14,Bold=1,Alignment=2,MarginV=${Math.round(marginV / 8)}'`);
        onLog?.(`Burning ${clip.timeline.captions.length} captions…`);
      }
      args.push('-c:a', 'copy', finalPath);
      await this.encodeWithFallback(encoder, args);

      // ── Persist as asset ─────────────────────────────────────────────────────
      const stat = await fsp.stat(finalPath);
      const asset = await this.prisma.asset.create({
        data: {
          projectId: clip.projectId,
          kind: 'SHORTS_CLIP_RENDER',
          label: `Shorts render: ${clip.topicSegment?.highlight?.titleSuggestion ?? clip.chapter?.title ?? clip.id} (${clip.clipType})`,
          status: 'READY',
        },
      });
      const key = `renders/shorts/${clip.projectId}/${asset.id}.mp4`;
      await this.storage.copyIn(key, finalPath);
      const contentHash = createHash('sha256').update(await fsp.readFile(finalPath)).digest('hex');
      const version = await this.prisma.assetVersion.create({
        data: {
          assetId: asset.id,
          version: 1,
          r2Key: key,
          contentHash,
          provider: 'ffmpeg',
          model: encoder,
          sizeBytes: BigInt(stat.size),
          durationMs: clip.timeline.durationMs,
          provenance: { renderedAt: new Date().toISOString(), preset: clip.clipType, resolution: `${out.width}x${out.height}` } as never,
        },
      });
      await this.prisma.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id } });
      await this.prisma.shortClip.update({
        where: { id: shortClipId },
        data: { renderAssetId: asset.id, status: 'RENDERED' },
      });
      await this.prisma.shortsRenderJob.update({
        where: { id: renderJob.id },
        data: { status: 'COMPLETE', checkpointData: { pass: 2, done: true } as never },
      });

      onLog?.(`Render complete — ${(stat.size / 1024 / 1024).toFixed(1)} MB`);

      // Thumbnails ride the render job (ai.md Section 13) — failure is non-fatal
      try {
        await this.thumbnails.ensureThumbnails(shortClipId, finalPath, onLog);
      } catch (err) {
        this.logger.warn(`Thumbnail generation failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }

      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      return { skipped: false, assetId: asset.id, versionId: version.id, key, sizeBytes: stat.size, encoder };
    } catch (err) {
      await this.prisma.shortsRenderJob.update({
        where: { id: renderJob.id },
        data: { status: 'FAILED' },
      }).catch(() => undefined);
      await this.prisma.shortClip.update({
        where: { id: shortClipId },
        data: { status: 'IN_EDITING' },
      }).catch(() => undefined);
      throw err;
    }
  }

  /** Probe once for NVENC (ai.md Section 23 GPU encoding). */
  private async pickEncoder(): Promise<string> {
    if (nvencAvailable === undefined) {
      try {
        const out = await runFfmpegCapture(['-encoders'], 30_000);
        nvencAvailable = out.includes('h264_nvenc');
      } catch {
        nvencAvailable = false;
      }
      this.logger.log(`NVENC ${nvencAvailable ? 'available' : 'not available'} — using ${nvencAvailable ? 'h264_nvenc' : 'libx264'}`);
    }
    return nvencAvailable ? 'h264_nvenc' : 'libx264';
  }

  /** Encode with the chosen encoder; on NVENC runtime failure retry on CPU. */
  private async encodeWithFallback(encoder: string, args: string[]): Promise<void> {
    const withEncoder = (enc: string) => {
      const idx = args.lastIndexOf(args[args.length - 1]!);
      const head = args.slice(0, idx);
      const outPath = args[idx]!;
      return [...head, '-c:v', enc, ...(enc === 'libx264' ? ['-preset', 'veryfast', '-crf', '21'] : ['-preset', 'p4']), outPath];
    };
    try {
      await runFfmpeg(withEncoder(encoder), 1_800_000);
    } catch (err) {
      if (encoder !== 'libx264') {
        this.logger.warn(`${encoder} failed, retrying with libx264: ${err instanceof Error ? err.message.slice(0, 200) : ''}`);
        nvencAvailable = false;
        await runFfmpeg(withEncoder('libx264'), 1_800_000);
      } else {
        throw err;
      }
    }
  }
}
