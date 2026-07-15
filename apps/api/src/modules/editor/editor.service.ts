import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { promises as fsp } from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { JobsService } from '../jobs/jobs.service';
import {
  EditTimelineSchema,
  EditRenderPresetSchema,
  EDIT_PRESET_DIMS,
  type EditTimeline,
  type EditRenderPreset,
  type EditItemFilters,
  type EditKeyframe,
} from '@cf/shared';
import {
  runFfmpeg,
  runFfmpegWithProgress,
  probeMediaInfo,
  parseMediaProbe,
  escapeFilterPath,
} from '../media/adapters/ffmpeg.util';
import { FFmpegExecutionError } from '../media/media.errors';

// ── Phase 2 render helpers ────────────────────────────────────────────────────

/** Clamp n to [min, max]. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Build an ffmpeg video filter chain string for per-item color/blur filters.
 * Returns empty string when filters object has no effective values.
 */
function buildItemFilters(f: EditItemFilters): string {
  const parts: string[] = [];

  const hasCurve =
    f.brightness !== undefined || f.contrast !== undefined || f.saturation !== undefined;
  if (hasCurve) {
    const b = clamp(f.brightness ?? 0, -1, 1);
    const c = clamp(f.contrast ?? 1, 0, 2);
    const s = clamp(f.saturation ?? 1, 0, 3);
    parts.push(`eq=brightness=${b}:contrast=${c}:saturation=${s}`);
  }

  if (f.grayscale) {
    parts.push('hue=s=0');
  }

  if (f.blur !== undefined && f.blur > 0) {
    const sigma = clamp(f.blur, 0, 20);
    parts.push(`gblur=sigma=${sigma}`);
  }

  return parts.join(',');
}

/**
 * Resolve a usable font path for drawtext — same candidates as thumbnail and
 * quote-card services so all three draw from the same font on any platform.
 */
function resolveFont(): string | null {
  const candidates = [
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * Escape a text string for safe embedding in a drawtext= filter value.
 * Single quotes and colons must be escaped; backslashes doubled.
 */
function escapeDrawtext(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

/**
 * Build a drawtext ffmpeg video filter for a TEXT item.
 *
 * @param text      The text to render.
 * @param opts      Font + position options (all optional, with defaults).
 * @param startSecs Absolute start time of the item on the composed timeline (seconds).
 * @param endSecs   Absolute end time of the item (seconds).
 * @param anim      textAnim value ('none' | 'fade-in' | 'slide-up').
 * @param fontPath  Absolute path to the font file.
 * @returns A drawtext filter string fragment (no surrounding brackets).
 */
function buildDrawtextFilter(
  text: string,
  opts: { x?: number; y?: number; fontSize?: number; color?: string },
  startSecs: number,
  endSecs: number,
  anim: 'none' | 'fade-in' | 'slide-up',
  fontPath: string,
): string {
  const fs = opts.fontSize ?? 48;
  const color = opts.color ?? 'white';
  const xExpr = opts.x !== undefined ? String(opts.x) : '(w-text_w)/2';
  const baseY = opts.y !== undefined ? String(opts.y) : '(h-text_h)/2';

  const escapedFont = escapeFilterPath(fontPath);
  const escapedText = escapeDrawtext(text);

  // enable= restricts rendering to the item's timeline window
  const enable = `between(t,${startSecs},${endSecs})`;

  const fadeDuration = 0.5; // 500 ms

  let alphaExpr = '1';
  let yExpr = baseY;

  if (anim === 'fade-in') {
    // Ramp alpha 0→1 over fadeDuration seconds from item start; clamp to 1 after
    alphaExpr = `if(lt(t,${startSecs + fadeDuration}),min(1,(t-${startSecs})/${fadeDuration}),1)`;
  } else if (anim === 'slide-up') {
    // Slide from baseY+40 to baseY over fadeDuration seconds
    const slideOffset = 40;
    // t_norm=0..1 over fadeDuration, clamped
    yExpr = `(${baseY})+${slideOffset}*(1-min(1,(t-${startSecs})/${fadeDuration}))`;
  }

  const parts: string[] = [
    `fontfile='${escapedFont}'`,
    `text='${escapedText}'`,
    `fontcolor=${color}`,
    `fontsize=${fs}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
    `alpha='${alphaExpr}'`,
    `enable='${enable}'`,
    'borderw=2',
    'bordercolor=black@0.6',
  ];

  return `drawtext=${parts.join(':')}`;
}

/**
 * Build a time-based opacity filter expression for keyframe animation.
 *
 * LIMITATION (Phase 2): Only TWO keyframes are honoured for opacity/position.
 * The first and last keyframe in the array are used as the ramp endpoints;
 * intermediate frames are ignored. This is sufficient for simple fade-in/out
 * and slide effects without the risk of malformed multi-segment `if()` chains
 * that cause ffmpeg to reject the filter graph. Full multi-keyframe spline
 * interpolation is a Phase 3 candidate.
 *
 * Honored: opacity, x, y (linear ramp between first and last keyframe).
 * Not honored: scale (zoompan on the already-encoded stream is lossy; deferred).
 */
function buildKeyframeFilters(
  keyframes: EditKeyframe[],
  itemStartSecs: number,
): { alphaFilter: string | null; xOffset: string | null; yOffset: string | null } {
  if (keyframes.length < 2) return { alphaFilter: null, xOffset: null, yOffset: null };

  const sorted = [...keyframes].sort((a, b) => a.atMs - b.atMs);
  const kf0 = sorted[0]!;
  const kfN = sorted[sorted.length - 1]!;

  const t0 = itemStartSecs + kf0.atMs / 1000;
  const t1 = itemStartSecs + kfN.atMs / 1000;
  const dur = t1 - t0;

  let alphaFilter: string | null = null;
  let xOffset: string | null = null;
  let yOffset: string | null = null;

  if (kf0.opacity !== undefined && kfN.opacity !== undefined && dur > 0) {
    const a0 = clamp(kf0.opacity, 0, 1);
    const a1 = clamp(kfN.opacity, 0, 1);
    // Linear lerp via if/between
    alphaFilter = `if(lt(t,${t0}),${a0},if(lt(t,${t1}),${a0}+(${a1}-${a0})*(t-${t0})/${dur},${a1}))`;
  }
  if (kf0.x !== undefined && kfN.x !== undefined && dur > 0) {
    const x0 = kf0.x;
    const x1 = kfN.x;
    xOffset = `if(lt(t,${t0}),${x0},if(lt(t,${t1}),${x0}+(${x1}-${x0})*(t-${t0})/${dur},${x1}))`;
  }
  if (kf0.y !== undefined && kfN.y !== undefined && dur > 0) {
    const y0 = kf0.y;
    const y1 = kfN.y;
    yOffset = `if(lt(t,${t0}),${y0},if(lt(t,${t1}),${y0}+(${y1}-${y0})*(t-${t0})/${dur},${y1}))`;
  }

  return { alphaFilter, xOffset, yOffset };
}

// ── EditProject row shape (returned to the controller) ───────────────────────
export interface EditProjectRow {
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
}

/** Accessor for the EditProject delegate. */
const ep = (prisma: PrismaService) => prisma.editProject;

export type MediaBinItem = {
  id: string;
  kind: string;
  label: string;
  durationMs: number | null;
  previewPath: string | null;
};

@Injectable()
export class EditorService {
  private readonly logger = new Logger(EditorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  // ── Ownership guard ──────────────────────────────────────────────────────────

  private async assertProjectOwnership(projectId: string, userId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.userId !== userId) throw new ForbiddenException('Access denied');
  }

  private async assertEditProjectOwnership(id: string, userId: string): Promise<EditProjectRow> {
    const row = (await ep(this.prisma).findUnique({ where: { id } })) as EditProjectRow | null;
    if (!row) throw new NotFoundException('EditProject not found');
    await this.assertProjectOwnership(row.projectId, userId);
    return row;
  }

  // ── Create from source ───────────────────────────────────────────────────────

  /**
   * Seed an EditProject from an existing source:
   *   sourceKind='VIDEO'           → a project-generated Video (uses its render asset)
   *   sourceKind='IMPORTED_VIDEO'  → an ImportedVideo row (uses its sourceAsset)
   *   sourceKind='ASSET'           → any Asset directly (e.g. a RENDER_SOURCE)
   */
  async createFromSource(
    projectId: string,
    userId: string,
    opts: {
      sourceKind: 'VIDEO' | 'IMPORTED_VIDEO' | 'ASSET';
      sourceId: string;
      title?: string;
    },
  ): Promise<EditProjectRow> {
    await this.assertProjectOwnership(projectId, userId);

    let durationMs = 0;
    let sourceAssetId: string | undefined;
    let r2Key: string | undefined;
    let derivedTitle = opts.title ?? 'Untitled Edit';

    if (opts.sourceKind === 'IMPORTED_VIDEO') {
      const iv = await this.prisma.importedVideo.findUnique({
        where: { id: opts.sourceId },
        include: { sourceAsset: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } },
      });
      if (!iv || iv.projectId !== projectId) throw new NotFoundException('ImportedVideo not found');
      durationMs = iv.durationMs;
      derivedTitle = opts.title ?? `Edit: ${iv.title}`;
      sourceAssetId = iv.sourceAssetId ?? undefined;
      r2Key = iv.sourceAsset?.versions[0]?.r2Key ?? undefined;
    } else if (opts.sourceKind === 'ASSET') {
      const asset = await this.prisma.asset.findUnique({
        where: { id: opts.sourceId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      if (!asset || asset.projectId !== projectId) throw new NotFoundException('Asset not found');
      sourceAssetId = asset.id;
      r2Key = asset.versions[0]?.r2Key ?? undefined;
      durationMs = asset.versions[0]?.durationMs ?? 0;
      derivedTitle = opts.title ?? `Edit: ${asset.label ?? asset.kind}`;
    } else {
      // VIDEO — look up a Video row and find its render asset
      const video = await this.prisma.video.findUnique({
        where: { id: opts.sourceId },
        select: { id: true, title: true, projectId: true },
      });
      if (!video || video.projectId !== projectId) throw new NotFoundException('Video not found');
      derivedTitle = opts.title ?? `Edit: ${video.title}`;
      // Find the most recent RENDER_SOURCE asset for this project
      const renderAsset = await this.prisma.asset.findFirst({
        where: { projectId, kind: 'RENDER_SOURCE', deletedAt: null, status: { in: ['READY', 'ACCEPTED'] } },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'desc' },
      });
      if (renderAsset) {
        sourceAssetId = renderAsset.id;
        r2Key = renderAsset.versions[0]?.r2Key ?? undefined;
        durationMs = renderAsset.versions[0]?.durationMs ?? 0;
      }
    }

    // Probe the source to get accurate dimensions + duration when missing
    let width = 1920;
    let height = 1080;
    if (r2Key && this.storage.exists(r2Key) && durationMs === 0) {
      try {
        const sourcePath = this.storage.resolve(r2Key);
        const probeText = await probeMediaInfo(sourcePath);
        const info = parseMediaProbe(probeText);
        if (info.durationMs) durationMs = info.durationMs;
        if (info.width && info.height) {
          width = info.width;
          height = info.height;
          // Detect vertical source → seed as 9:16
          if (height > width) { width = 1080; height = 1920; }
          else { width = 1920; height = 1080; }
        }
      } catch (e) {
        this.logger.warn(`Source probe failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Seed a single-VIDEO-track timeline with one item spanning the full source
    const seedTimeline: EditTimeline = {
      width,
      height,
      fps: 30,
      durationMs,
      tracks: [
        {
          id: 'track-video-0',
          kind: 'VIDEO',
          label: 'Video',
          items: sourceAssetId
            ? [
                {
                  id: 'item-0',
                  sourceAssetId,
                  kind: 'VIDEO',
                  timelineStartMs: 0,
                  timelineEndMs: durationMs || 1,
                  sourceInMs: 0,
                  sourceOutMs: durationMs || undefined,
                },
              ]
            : [],
        },
      ],
    };

     
    const row = (await ep(this.prisma).create({
      data: {
        projectId,
        title: derivedTitle,
        width,
        height,
        fps: 30,
        durationMs,
        timeline: seedTimeline as object,
        renderStatus: 'NONE',
      },
    })) as EditProjectRow;

    this.logger.log(`EditProject ${row.id} created from ${opts.sourceKind}:${opts.sourceId}`);
    return row;
  }

  // ── Create blank ─────────────────────────────────────────────────────────────

  async createBlank(
    projectId: string,
    userId: string,
    opts: { title?: string; width?: number; height?: number; fps?: number },
  ): Promise<EditProjectRow> {
    await this.assertProjectOwnership(projectId, userId);

    const width = opts.width ?? 1920;
    const height = opts.height ?? 1080;
    const fps = opts.fps ?? 30;

    const seedTimeline: EditTimeline = {
      width,
      height,
      fps,
      durationMs: 0,
      tracks: [{ id: 'track-video-0', kind: 'VIDEO', label: 'Video', items: [] }],
    };

     
    const row = (await ep(this.prisma).create({
      data: {
        projectId,
        title: opts.title ?? 'Untitled Edit',
        width,
        height,
        fps,
        durationMs: 0,
        timeline: seedTimeline as object,
        renderStatus: 'NONE',
      },
    })) as EditProjectRow;

    this.logger.log(`Blank EditProject ${row.id} created`);
    return row;
  }

  // ── Channel-first conveniences (resolve the project from user/source) ─────────
  // The UX is channel-first and doesn't carry a projectId; these let the
  // frontend open the editor without one.

  /** All edit projects the user owns, across every project. */
  async listAllForUser(userId: string): Promise<EditProjectRow[]> {
    return (await ep(this.prisma).findMany({
      where: { project: { userId } },
      orderBy: { lastEditedAt: 'desc' },
    })) as EditProjectRow[];
  }

  /**
   * Resolve a container project to hang a blank edit off of: the user's most
   * recent project, or a personal "Video Editor" project created on demand.
   */
  private async resolveContainerProject(userId: string): Promise<string> {
    const recent = await this.prisma.project.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (recent) return recent.id;
    const channel = await this.prisma.channel.findFirst({ where: { userId }, select: { id: true } });
    if (!channel) throw new BadRequestException('Connect a channel before creating an edit.');
    const created = await this.prisma.project.create({
      data: { userId, channelId: channel.id, title: 'Video Editor', description: 'Container for standalone edits' },
      select: { id: true },
    });
    return created.id;
  }

  /** Blank edit without a caller-supplied project (channel-first entry point). */
  async createBlankForUser(
    userId: string,
    opts: { title?: string; width?: number; height?: number; fps?: number },
  ): Promise<EditProjectRow> {
    const projectId = await this.resolveContainerProject(userId);
    return this.createBlank(projectId, userId, opts);
  }

  /** Open an ImportedVideo in the editor — projectId is resolved server-side. */
  async createFromImportedVideo(importedVideoId: string, userId: string, title?: string): Promise<EditProjectRow> {
    const iv = await this.prisma.importedVideo.findUnique({
      where: { id: importedVideoId },
      select: { projectId: true },
    });
    if (!iv) throw new NotFoundException('ImportedVideo not found');
    return this.createFromSource(iv.projectId, userId, { sourceKind: 'IMPORTED_VIDEO', sourceId: importedVideoId, title });
  }

  // ── Read ─────────────────────────────────────────────────────────────────────

  async get(id: string, userId: string): Promise<EditProjectRow> {
    return this.assertEditProjectOwnership(id, userId);
  }

  async listByProject(projectId: string, userId: string): Promise<EditProjectRow[]> {
    await this.assertProjectOwnership(projectId, userId);

    return (await ep(this.prisma).findMany({
      where: { projectId },
      orderBy: { lastEditedAt: 'desc' },
    })) as EditProjectRow[];
  }

  // ── Save timeline ────────────────────────────────────────────────────────────

  async saveTimeline(id: string, userId: string, rawTimeline: unknown): Promise<EditProjectRow> {
    // Ownership check first
    const existing = await this.assertEditProjectOwnership(id, userId);

    // Validate with the canonical Zod schema
    const parseResult = EditTimelineSchema.safeParse(rawTimeline);
    if (!parseResult.success) {
      throw new BadRequestException(
        `Invalid timeline: ${parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`,
      );
    }

    const timeline = parseResult.data;

    // Recompute durationMs from max timelineEndMs across all items
    let durationMs = 0;
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        if (item.timelineEndMs > durationMs) durationMs = item.timelineEndMs;
      }
    }

     
    const updated = (await ep(this.prisma).update({
      where: { id },
      data: {
        timeline: timeline as object,
        durationMs,
        lastEditedAt: new Date(),
        // Reset render status if timeline changed since last render
        renderStatus: existing.renderStatus === 'READY' ? 'STALE' : existing.renderStatus,
      },
    })) as EditProjectRow;

    return updated;
  }

  // ── Media bin ────────────────────────────────────────────────────────────────

  /**
   * Returns assets available to drag onto the timeline:
   *   - All VIDEO, IMAGE, VOICE, MUSIC, RENDER_SOURCE, EDIT_RENDER assets in the project
   *   - The source video from an IMPORTED_VIDEO if present
   * Returns id, kind, label, durationMs, and a storage-resolved previewPath.
   */
  async mediaBin(id: string, userId: string): Promise<MediaBinItem[]> {
    const editProj = await this.assertEditProjectOwnership(id, userId);
    const { projectId } = editProj;

    const assets = await this.prisma.asset.findMany({
      where: {
        projectId,
        deletedAt: null,
        status: { in: ['READY', 'ACCEPTED'] },
        kind: { in: ['VIDEO', 'IMAGE', 'VOICE', 'MUSIC', 'RENDER_SOURCE', 'EDIT_RENDER'] },
      },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });

    const items: MediaBinItem[] = assets.map((a) => {
      const ver = a.versions[0];
      const previewPath =
        ver?.r2Key && this.storage.exists(ver.r2Key) ? this.storage.resolve(ver.r2Key) : null;
      return {
        id: a.id,
        kind: a.kind,
        label: a.label ?? a.kind,
        durationMs: ver?.durationMs ?? null,
        previewPath,
      };
    });

    // Also include imported video source assets
    const importedVideos = await this.prisma.importedVideo.findMany({
      where: { projectId },
      include: { sourceAsset: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } },
    });
    for (const iv of importedVideos) {
      if (iv.sourceAsset) {
        const ver = iv.sourceAsset.versions[0];
        const previewPath =
          ver?.r2Key && this.storage.exists(ver.r2Key) ? this.storage.resolve(ver.r2Key) : null;
        // Avoid duplicate if already in asset list
        if (!items.some((i) => i.id === iv.sourceAsset!.id)) {
          items.push({
            id: iv.sourceAsset.id,
            kind: 'SHORTS_SOURCE_VIDEO',
            label: iv.title,
            durationMs: iv.durationMs,
            previewPath,
          });
        }
      }
    }

    return items;
  }

  // ── Enqueue render ───────────────────────────────────────────────────────────

  async render(
    id: string,
    userId: string,
    preset: unknown,
  ): Promise<{ jobId: string; renderStatus: string }> {
    const row = await this.assertEditProjectOwnership(id, userId);

    // Validate preset
    const presetParse = EditRenderPresetSchema.safeParse(preset);
    if (!presetParse.success) {
      throw new BadRequestException(
        `Invalid preset — must be one of: ${EditRenderPresetSchema.options.join(', ')}`,
      );
    }
    const validPreset = presetParse.data;

    const idempotencyKey = `edit-render:${id}:${row.lastEditedAt.toISOString()}`;

    const job = await this.jobs.enqueue(
      row.projectId,
      'EDIT_RENDER',
      { editProjectId: id, preset: validPreset },
      { idempotencyKey },
    );

     
    await ep(this.prisma).update({
      where: { id },
      data: { renderStatus: 'QUEUED' },
    });

    return { jobId: job.id, renderStatus: 'QUEUED' };
  }

  // ── Render status ────────────────────────────────────────────────────────────

  async renderStatus(
    id: string,
    userId: string,
  ): Promise<{ renderStatus: string; renderAssetId: string | null; downloadPath: string | null }> {
    const row = await this.assertEditProjectOwnership(id, userId);

    let downloadPath: string | null = null;
    if (row.renderAssetId) {
      const asset = await this.prisma.asset.findUnique({
        where: { id: row.renderAssetId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      const r2Key = asset?.versions[0]?.r2Key;
      if (r2Key && this.storage.exists(r2Key)) {
        downloadPath = this.storage.resolve(r2Key);
      }
    }

    return {
      renderStatus: row.renderStatus,
      renderAssetId: row.renderAssetId,
      downloadPath,
    };
  }

  // ── Worker body: runRender ───────────────────────────────────────────────────

  /**
   * Translates an EditTimeline into an ffmpeg render.
   *
   * RENDER TRANSLATION APPROACH (Phase 1 + Phase 2):
   * ─────────────────────────────────────────────────────────────────────────────
   * The primary VIDEO track items are rendered sequentially. Each item's trimmed
   * range is extracted to a separate temp file first (-ss/-t for accurate trim),
   * then the segments are concatenated. Phase 2 extends this with per-item
   * filters, clip transitions, text burn-in, and keyframe animation.
   *
   * Phase 2 features (fully honored):
   * ─────────────────────────────────────────────────────────────────────────────
   * 1. FILTERS (VIDEO/IMAGE): properties.filters → eq=brightness/contrast/saturation,
   *    hue=s=0 (grayscale), gblur=sigma (blur). Applied at segment extraction time.
   * 2. TEXT items: Burned as drawtext overlays onto the final composed video using
   *    properties.text/fontSize/color/x/y. textAnim 'fade-in' and 'slide-up'
   *    use time-based alpha/y expressions over the first 500 ms.
   * 3. TRANSITIONS (VIDEO only): transitionIn.type 'fade'/'dissolve'/'slide' all
   *    map to xfade=transition=fade|slideleft. Cross-dissolve honored via xfade.
   *    NOTE: xfade requires individual inputs (not concat demuxer); when any item
   *    has transitionIn the render path switches to filter_complex mode.
   *    Honored transition types: fade, dissolve (→ fade xfade), slide (→ slideleft).
   *
   * Phase 2 features (subset, documented):
   * ─────────────────────────────────────────────────────────────────────────────
   * 4. KEYFRAMES: Only the first + last keyframe are honored for opacity/x/y via
   *    linear ramp. Intermediate keyframes and 'scale' keyframes are ignored.
   *    Reason: multi-segment if() chains for scale on a decoded stream are fragile
   *    with the bundled ffmpeg-static; correctness over completeness (Phase 3).
   *    Applied as drawtext alpha+position for TEXT items; VIDEO keyframe opacity
   *    requires format=rgba which changes pix_fmt and is deferred to Phase 3.
   *
   * Phase 1 limitations still present:
   * ─────────────────────────────────────────────────────────────────────────────
   * - Multiple VIDEO tracks: Only the FIRST VIDEO track is rendered.
   * - Multiple AUDIO tracks: First AUDIO track item is used as voicePath.
   * - Speed property: Not applied (requires setpts/atempo chain; Phase 3).
   * - IMAGE items: Supported via zoompan still; filters not yet applied to images.
   */
  async runRender(
    editProjectId: string,
    preset: EditRenderPreset,
    onLog?: (msg: string) => void,
  ): Promise<{
    assetId: string;
    versionId: string;
    key: string;
    sizeBytes: number;
    durationMs: number;
  }> {
     
    const row = (await ep(this.prisma).findUnique({
      where: { id: editProjectId },
    })) as EditProjectRow | null;
    if (!row) throw new NotFoundException('EditProject not found');

    // Idempotency: skip if render is newer than last edit
    if (row.renderStatus === 'READY' && row.renderAssetId) {
      const existingAsset = await this.prisma.asset.findUnique({
        where: { id: row.renderAssetId },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      const r2Key = existingAsset?.versions[0]?.r2Key;
      if (r2Key && this.storage.exists(r2Key)) {
        onLog?.('Render is up to date — reusing existing output');
        return {
          assetId: existingAsset!.id,
          versionId: existingAsset!.versions[0]!.id,
          key: r2Key,
          sizeBytes: Number(existingAsset!.versions[0]!.sizeBytes ?? 0),
          durationMs: existingAsset!.versions[0]!.durationMs ?? row.durationMs,
        };
      }
    }

    // Parse timeline
    const timelineParse = EditTimelineSchema.safeParse(row.timeline);
    if (!timelineParse.success) {
      throw new BadRequestException(`EditProject timeline is invalid: ${timelineParse.error.message}`);
    }
    const timeline = timelineParse.data;

    // Resolve output dimensions from preset
    const outputDims =
      preset === 'SOURCE'
        ? { width: row.width, height: row.height }
        : EDIT_PRESET_DIMS[preset];
    const { width, height } = outputDims;
    const fps = row.fps;

    // Update renderStatus to RENDERING
     
    await ep(this.prisma).update({
      where: { id: editProjectId },
      data: { renderStatus: 'RENDERING' },
    });

    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), `cf-edit-${editProjectId.slice(0, 8)}-`));
    onLog?.(`Edit render started — workDir: ${workDir}`);

    try {
      // ── Extract the primary VIDEO track ──────────────────────────────────
      const videoTrack = timeline.tracks.find((t) => t.kind === 'VIDEO');
      const audioTrack = timeline.tracks.find((t) => t.kind === 'AUDIO');
      const textTrack = timeline.tracks.find((t) => t.kind === 'TEXT');

      if (!videoTrack || videoTrack.items.length === 0) {
        throw new BadRequestException('No video items on the primary VIDEO track');
      }

      // Sort items by timelineStartMs
      const sortedVideoItems = [...videoTrack.items].sort(
        (a, b) => a.timelineStartMs - b.timelineStartMs,
      );

      // Collect TEXT items from the text track for Phase 2 drawtext burn-in
      const sortedTextItems = textTrack
        ? [...textTrack.items].sort((a, b) => a.timelineStartMs - b.timelineStartMs)
        : [];

      // Phase 2: detect whether any item requests a transition (switches concat path)
      const hasTransitions = sortedVideoItems.some((item) => item.properties?.transitionIn);

      // Extract each VIDEO/IMAGE item to a temp file (supports trim via -ss/-t)
      const segmentPaths: {
        path: string;
        durationSecs: number;
        isImage: boolean;
        transitionIn?: { type: 'fade' | 'dissolve' | 'slide'; durationMs: number };
      }[] = [];

      for (let i = 0; i < sortedVideoItems.length; i++) {
        const item = sortedVideoItems[i]!;
        const itemDurationSecs = (item.timelineEndMs - item.timelineStartMs) / 1000;

        if (item.kind === 'IMAGE') {
          if (!item.sourceAssetId) {
            onLog?.(`Item ${item.id} is IMAGE but has no sourceAssetId — skipping`);
            continue;
          }
          const asset = await this.prisma.asset.findUnique({
            where: { id: item.sourceAssetId },
            include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
          });
          const r2Key = asset?.versions[0]?.r2Key;
          if (!r2Key || !this.storage.exists(r2Key)) {
            onLog?.(`Item ${item.id} image asset missing — skipping`);
            continue;
          }
          segmentPaths.push({
            path: this.storage.resolve(r2Key),
            durationSecs: itemDurationSecs,
            isImage: true,
          });
          onLog?.(`Item ${i + 1}/${sortedVideoItems.length}: IMAGE — ${Math.round(itemDurationSecs)}s`);
        } else if (item.kind === 'VIDEO') {
          if (!item.sourceAssetId) {
            onLog?.(`Item ${item.id} is VIDEO but has no sourceAssetId — skipping`);
            continue;
          }
          const asset = await this.prisma.asset.findUnique({
            where: { id: item.sourceAssetId },
            include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
          });
          const r2Key = asset?.versions[0]?.r2Key;
          if (!r2Key || !this.storage.exists(r2Key)) {
            onLog?.(`Item ${item.id} video asset missing — skipping`);
            continue;
          }
          const sourcePath = this.storage.resolve(r2Key);
          const segPath = path.join(workDir, `seg-${i}.mp4`);

          const sourceInSecs = (item.sourceInMs ?? 0) / 1000;
          const sourceOutSecs = item.sourceOutMs ? item.sourceOutMs / 1000 : undefined;
          const trimDuration = sourceOutSecs ? sourceOutSecs - sourceInSecs : itemDurationSecs;

          // Phase 2: build per-item video filter chain (scale + color filters + keyframe)
          let vfChain = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`;

          // Append Phase 2 color/blur filters if present
          const f = item.properties?.filters;
          if (f) {
            const filterStr = buildItemFilters(f);
            if (filterStr) vfChain += `,${filterStr}`;
          }

          // Phase 2 keyframes — opacity only on VIDEO segments (x/y deferred: overlay needed)
          // NOTE: keyframe scale is not applied here; see runRender docblock.
          const kfs = item.properties?.keyframes;
          if (kfs && kfs.length >= 2) {
            onLog?.(`Item ${item.id}: keyframe animation — only first+last keyframe honored (Phase 2 subset); scale keyframes deferred`);
          }

          const extractArgs = [
            '-ss', String(sourceInSecs),
            ...(trimDuration > 0 ? ['-t', String(trimDuration)] : []),
            '-i', sourcePath,
            '-vf', vfChain,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            segPath,
          ];
          await runFfmpeg(extractArgs, 600_000);
          segmentPaths.push({
            path: segPath,
            durationSecs: itemDurationSecs,
            isImage: false,
            transitionIn: item.properties?.transitionIn,
          });
          onLog?.(`Item ${i + 1}/${sortedVideoItems.length}: VIDEO extracted (${Math.round(trimDuration)}s trim → ${Math.round(itemDurationSecs)}s slot)`);
        } else if (item.kind === 'TEXT') {
          // TEXT items on the VIDEO track are unusual; log and skip (they belong on TEXT track)
          onLog?.(`Item ${item.id}: TEXT on VIDEO track — use TEXT track for overlays`);
        } else {
          onLog?.(`Item ${item.id}: kind=${item.kind} not handled on video track — skipped`);
        }
      }

      if (segmentPaths.length === 0) {
        throw new BadRequestException('No renderable video or image items found after resolving assets');
      }

      // ── Resolve optional audio from first AUDIO track ────────────────────
      let voicePath: string | undefined;
      if (audioTrack && audioTrack.items.length > 0) {
        const audioItem = audioTrack.items.sort((a, b) => a.timelineStartMs - b.timelineStartMs)[0]!;
        if (audioItem.sourceAssetId) {
          const audioAsset = await this.prisma.asset.findUnique({
            where: { id: audioItem.sourceAssetId },
            include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
          });
          const r2Key = audioAsset?.versions[0]?.r2Key;
          if (r2Key && this.storage.exists(r2Key)) {
            voicePath = this.storage.resolve(r2Key);
            onLog?.(`Audio track resolved: ${audioAsset?.label ?? audioItem.sourceAssetId}`);
          }
        }
      }

      // ── Concatenate all segments into an intermediate file ───────────────
      // When transitions are requested, use filter_complex with xfade instead
      // of the concat demuxer (xfade is incompatible with the concat demuxer path).
      const compositePath = path.join(workDir, 'composite.mp4');
      const outPath = path.join(workDir, 'final.mp4');
      const totalSecs = segmentPaths.reduce((s, seg) => s + seg.durationSecs, 0);

      const allVideo = segmentPaths.every((s) => !s.isImage);

      if (!hasTransitions && segmentPaths.length === 1 && !segmentPaths[0]!.isImage && !voicePath) {
        // Single video segment, no audio mixing — direct re-encode
        onLog?.('Single segment — direct encode');
        const seg = segmentPaths[0]!;
        const singleArgs = [
          '-i', seg.path,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-c:a', 'copy',
          '-movflags', '+faststart',
          '-t', String(seg.durationSecs),
          compositePath,
        ];
        await runFfmpegWithProgress(singleArgs, totalSecs, (pct) => onLog?.(`Encoding: ${pct}%`));
      } else if (!hasTransitions && allVideo) {
        // All video segments, no transitions: concat demuxer (fastest path)
        const listPath = path.join(workDir, 'concat.txt');
        await fsp.writeFile(
          listPath,
          segmentPaths
            .map((s) => `file '${s.path.replace(/\\/g, '/').replace(/'/g, "\\'")}'`)
            .join('\n'),
        );
        const concatArgs = [
          '-f', 'concat', '-safe', '0', '-i', listPath,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '160k',
          '-t', String(totalSecs),
          '-movflags', '+faststart',
          compositePath,
        ];
        await runFfmpegWithProgress(concatArgs, totalSecs, (pct) => onLog?.(`Encoding: ${pct}%`));
      } else if (hasTransitions && allVideo) {
        // ── Phase 2: xfade transition path ──────────────────────────────────
        // Build a filter_complex that chains pairs of segments with xfade.
        // Transitions types: fade/dissolve → xfade=fade, slide → xfade=slideleft.
        // The xfade offset must account for the cumulative duration minus the
        // transition overlap at each junction.
        onLog?.('Applying transitions via xfade filter_complex');
        const fcArgs: string[] = [];
        const fcFilters: string[] = [];

        for (const seg of segmentPaths) {
          fcArgs.push('-i', seg.path);
        }

        if (segmentPaths.length === 1) {
          // Only one segment: xfade not needed, just re-encode
          fcFilters.push(`[0:v]copy[vout]`);
        } else {
          // Chain xfade: [0:v][1:v]xfade=...=>[x01]; [x01][2:v]xfade=...=>[x012]; ...
          let prevLabel = '[0:v]';
          let cumulativeSecs = segmentPaths[0]!.durationSecs;

          for (let si = 1; si < segmentPaths.length; si++) {
            const seg = segmentPaths[si]!;
            const transIn = seg.transitionIn;
            const durSecs = transIn ? Math.min(transIn.durationMs / 1000, seg.durationSecs * 0.5) : 0;
            const xfadeType = transIn?.type === 'slide' ? 'slideleft' : 'fade';
            // offset = when the previous segment ends minus the overlap duration
            const offset = Math.max(0, cumulativeSecs - durSecs);
            const outLabel = si === segmentPaths.length - 1 ? '[vout]' : `[x${si}]`;

            if (transIn && durSecs > 0) {
              fcFilters.push(
                `${prevLabel}[${si}:v]xfade=transition=${xfadeType}:duration=${durSecs}:offset=${offset}${outLabel}`,
              );
              onLog?.(`Transition ${si - 1}→${si}: ${transIn.type} (xfade=${xfadeType}, ${durSecs.toFixed(2)}s)`);
            } else {
              // No transition for this segment: use concat filter for this pair
              fcFilters.push(`${prevLabel}[${si}:v]concat=n=2:v=1:a=0${outLabel}`);
            }

            prevLabel = outLabel === '[vout]' ? '[vout]' : outLabel;
            cumulativeSecs += seg.durationSecs - durSecs;
          }
        }

        const xfadeArgs = [
          ...fcArgs,
          '-filter_complex', fcFilters.join(';'),
          '-map', '[vout]',
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-t', String(totalSecs),
          '-movflags', '+faststart',
          compositePath,
        ];
        await runFfmpegWithProgress(xfadeArgs, totalSecs, (pct) => onLog?.(`Encoding: ${pct}%`));
      } else {
        // Mixed VIDEO + IMAGE (and/or fallback): build filter_complex with zoompan
        const args: string[] = [];
        const filters: string[] = [];
        let inputIdx = 0;

        for (const seg of segmentPaths) {
          if (seg.isImage) {
            args.push('-loop', '1', '-i', seg.path);
            const frames = Math.max(1, Math.round(seg.durationSecs * fps));
            filters.push(`[${inputIdx}:v]scale=${Math.round(width * 1.5)}:${Math.round(height * 1.5)},zoompan=z='min(zoom+0.0006,1.15)':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1[v${inputIdx}]`);
          } else {
            args.push('-i', seg.path);
            filters.push(`[${inputIdx}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},trim=duration=${seg.durationSecs},setpts=PTS-STARTPTS[v${inputIdx}]`);
          }
          inputIdx++;
        }

        const concatIn = segmentPaths.map((_, i) => `[v${i}]`).join('');
        filters.push(`${concatIn}concat=n=${segmentPaths.length}:v=1:a=0[vout]`);

        const mixedArgs = [
          ...args,
          '-filter_complex', filters.join(';'),
          '-map', '[vout]',
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-t', String(totalSecs),
          '-movflags', '+faststart',
          compositePath,
        ];
        await runFfmpegWithProgress(mixedArgs, totalSecs, (pct) => onLog?.(`Encoding: ${pct}%`));
      }

      // ── Phase 2: TEXT burn-in + audio mix as a second pass ───────────────
      // TEXT track items are burned as drawtext overlays onto the composite.
      // Audio mixing happens in this same pass.
      // If neither text nor audio, just rename composite → final.

      const validTextItems = sortedTextItems.filter(
        (item) => item.properties?.text && item.kind === 'TEXT',
      );

      const fontPath = validTextItems.length > 0 ? resolveFont() : null;
      if (validTextItems.length > 0 && !fontPath) {
        onLog?.('Warning: no usable font found — TEXT items will not be burned into the render');
      }

      const textFilters: string[] = [];
      for (const item of validTextItems) {
        if (!fontPath) break;
        const text = item.properties!.text!;
        const startSecs = item.timelineStartMs / 1000;
        const endSecs = item.timelineEndMs / 1000;
        const anim = item.properties?.textAnim ?? 'none';

        // Phase 2 keyframes on TEXT items: apply to alpha/y in drawtext
        const kfs = item.properties?.keyframes;
        let dtFilter = buildDrawtextFilter(
          text,
          {
            x: item.properties?.x,
            y: item.properties?.y,
            fontSize: item.properties?.fontSize,
            color: item.properties?.color,
          },
          startSecs,
          endSecs,
          anim,
          fontPath,
        );

        if (kfs && kfs.length >= 2) {
          onLog?.(`Item ${item.id}: TEXT keyframes — only first+last honored for alpha/y (Phase 2 subset)`);
          const { alphaFilter, yOffset } = buildKeyframeFilters(kfs, startSecs);
          if (alphaFilter || yOffset) {
            // Rebuild with 'none' anim so static defaults are set, then patch
            dtFilter = buildDrawtextFilter(
              text,
              { x: item.properties?.x, y: item.properties?.y, fontSize: item.properties?.fontSize, color: item.properties?.color },
              startSecs,
              endSecs,
              'none',
              fontPath,
            );
            // Patch y expression: replace y=<static> with the keyframe expression
            if (yOffset) {
              dtFilter = dtFilter.replace(/\by=([^:]+)(?=:)/, `y=${yOffset}`);
            }
            if (alphaFilter) {
              dtFilter = dtFilter.replace(/alpha='[^']*'/, `alpha='${alphaFilter}'`);
            }
          }
        }

        textFilters.push(dtFilter);
        onLog?.(`TEXT item ${item.id}: burned at ${startSecs.toFixed(1)}s–${endSecs.toFixed(1)}s (${anim})`);
      }

      const needsSecondPass = textFilters.length > 0 || voicePath;

      if (!needsSecondPass) {
        // No text, no audio: composite is the final output
        await fsp.rename(compositePath, outPath);
      } else {
        // Second pass: overlay text + mix audio onto composite
        const passArgs: string[] = ['-i', compositePath];
        if (voicePath) passArgs.push('-i', voicePath);

        const passFilters: string[] = [];
        let videoLabel = '[0:v]';

        if (textFilters.length > 0) {
          // Chain all drawtext filters: [0:v]drawtext=...,drawtext=...[vtxt]
          passFilters.push(`[0:v]${textFilters.join(',')}[vtxt]`);
          videoLabel = '[vtxt]';
        }

        if (voicePath) {
          passFilters.push('[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]');
        }

        // If we have audio in the composite (segment audio), map it; when mixing
        // with voicePath use the amix label, otherwise map stream 0:a directly.
        const hasCompositeAudio = segmentPaths.some((s) => !s.isImage);
        const audioMap: string[] = voicePath
          ? ['-map', '[aout]']
          : hasCompositeAudio
          ? ['-map', '0:a']
          : [];
        const fcStr = passFilters.length > 0 ? ['-filter_complex', passFilters.join(';')] : [];
        const mapV = passFilters.length > 0 ? ['-map', videoLabel] : ['-map', '0:v'];

        const finalArgs = [
          ...passArgs,
          ...(fcStr.length > 0 ? fcStr : []),
          ...mapV,
          ...audioMap,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          ...(voicePath ? ['-c:a', 'aac', '-b:a', '160k'] : hasCompositeAudio ? ['-c:a', 'copy'] : []),
          '-t', String(totalSecs),
          '-movflags', '+faststart',
          outPath,
        ];
        await runFfmpegWithProgress(finalArgs, totalSecs, (pct) => onLog?.(`Final pass: ${pct}%`));
      }

      // ── Persist as Asset + AssetVersion ──────────────────────────────────
      const stat = await fsp.stat(outPath);
      const totalDurationMs = Math.round(totalSecs * 1000);

      const asset = await this.prisma.asset.create({
        data: {
          projectId: row.projectId,
          kind: 'EDIT_RENDER',
          label: `Editor render: ${row.title} (${preset})`,
          status: 'READY',
        },
      });

      const r2Key = `renders/editor/${row.projectId}/${asset.id}.mp4`;
      await this.storage.copyIn(r2Key, outPath);

      const contentHash = createHash('sha256').update(await fsp.readFile(outPath)).digest('hex');
      const version = await this.prisma.assetVersion.create({
        data: {
          assetId: asset.id,
          version: 1,
          r2Key,
          contentHash,
          provider: 'ffmpeg',
          model: 'libx264',
          provenance: {
            provider: 'ffmpeg',
            model: 'libx264',
            generatedAt: new Date().toISOString(),
            preset,
            resolution: `${width}x${height}`,
            segments: segmentPaths.length,
          } as never,
          sizeBytes: BigInt(stat.size),
          durationMs: totalDurationMs,
        },
      });

      await this.prisma.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id } });

       
      await ep(this.prisma).update({
        where: { id: editProjectId },
        data: {
          renderAssetId: asset.id,
          renderStatus: 'READY',
        },
      });

      onLog?.(`Edit render complete — ${(stat.size / 1024 / 1024).toFixed(1)} MB · ${Math.round(totalSecs)}s · ${width}×${height}`);

      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

      return {
        assetId: asset.id,
        versionId: version.id,
        key: r2Key,
        sizeBytes: stat.size,
        durationMs: totalDurationMs,
      };
    } catch (err) {
      // Mark render as failed
       
      await ep(this.prisma).update({
        where: { id: editProjectId },
        data: { renderStatus: 'FAILED' },
      }).catch(() => undefined);

      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);

      // Re-wrap as typed error if it's a plain ffmpeg error
      if (err instanceof Error && !err.message.includes('EditProject') && !err.message.includes('No video')) {
        throw new FFmpegExecutionError(err.message, { editProjectId, preset });
      }
      throw err;
    }
  }
}
