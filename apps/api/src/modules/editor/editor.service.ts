import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { promises as fsp } from 'fs';
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
} from '@cf/shared';
import {
  runFfmpeg,
  runFfmpegWithProgress,
  probeMediaInfo,
  parseMediaProbe,
} from '../media/adapters/ffmpeg.util';
import { FFmpegExecutionError } from '../media/media.errors';

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
   * RENDER TRANSLATION APPROACH (Phase 1):
   * ─────────────────────────────────────────────────────────────────────────────
   * The primary VIDEO track items are rendered sequentially. Because composeVideo()
   * concatenates ComposeScene entries using `concat` which doesn't support per-scene
   * source trim (sourceInMs/sourceOutMs) — it always takes the full input — we extract
   * each item's trimmed range to a separate temp file first using runFfmpeg with
   * -ss/-t flags (seek-before-input for accurate trim), then pass those temp files
   * to composeVideo() as scenes. This gives us accurate per-item trimming.
   *
   * Phase 1 limitations:
   * ─────────────────────────────────────────────────────────────────────────────
   * 1. TEXT items: Not burned in Phase 1. Text overlay requires a complex
   *    filter_complex with drawtext; skipped to keep the foundation simple.
   *    Items with kind='TEXT' are logged and ignored during render.
   * 2. Multiple VIDEO tracks: Only the FIRST VIDEO track is rendered in Phase 1.
   *    Subsequent video tracks (overlays, PiP) are ignored.
   * 3. Multiple AUDIO tracks: The first AUDIO track's first item is used as
   *    voicePath. Music is not separately mixed in Phase 1 (composeVideo music
   *    param could be used for a dedicated music track if needed).
   * 4. Speed/opacity/position properties: Not applied in Phase 1. Only volume
   *    is honored on audio items (via volume filter).
   * 5. IMAGE items: Supported via composeVideo's imagePath scene entry.
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

      if (!videoTrack || videoTrack.items.length === 0) {
        throw new BadRequestException('No video items on the primary VIDEO track');
      }

      // Sort items by timelineStartMs
      const sortedVideoItems = [...videoTrack.items].sort(
        (a, b) => a.timelineStartMs - b.timelineStartMs,
      );

      // Phase 1: extract each item to temp file (supports trim via -ss/-t)
      const segmentPaths: { path: string; durationSecs: number; isImage: boolean }[] = [];

      for (let i = 0; i < sortedVideoItems.length; i++) {
        const item = sortedVideoItems[i]!;
        const itemDurationSecs = (item.timelineEndMs - item.timelineStartMs) / 1000;

        if (item.kind === 'IMAGE') {
          // For IMAGE items, resolve asset and pass as still
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

          // Extract trimmed segment (seek-before-input is frame-accurate for H.264)
          const extractArgs = [
            '-ss', String(sourceInSecs),
            ...(trimDuration > 0 ? ['-t', String(trimDuration)] : []),
            '-i', sourcePath,
            '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k',
            segPath,
          ];
          await runFfmpeg(extractArgs, 600_000);
          segmentPaths.push({ path: segPath, durationSecs: itemDurationSecs, isImage: false });
          onLog?.(`Item ${i + 1}/${sortedVideoItems.length}: VIDEO extracted (${Math.round(trimDuration)}s trim → ${Math.round(itemDurationSecs)}s slot)`);
        } else if (item.kind === 'TEXT') {
          // Phase 1: TEXT burn-in not implemented — skip and log
          onLog?.(`Item ${item.id}: TEXT items are not burned in Phase 1 — skipped`);
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

      // ── Concatenate all segments into the final render ───────────────────
      const outPath = path.join(workDir, 'final.mp4');
      const totalSecs = segmentPaths.reduce((s, seg) => s + seg.durationSecs, 0);

      if (segmentPaths.length === 1 && !segmentPaths[0]!.isImage && !voicePath) {
        // Single video segment, no audio mixing — just scale and encode directly
        onLog?.('Single segment — direct encode');
        const seg = segmentPaths[0]!;
        const singleArgs = [
          '-i', seg.path,
          ...(voicePath ? ['-i', voicePath] : []),
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          ...(voicePath ? ['-c:a', 'aac', '-b:a', '160k'] : ['-c:a', 'copy']),
          '-movflags', '+faststart',
          '-t', String(seg.durationSecs),
          outPath,
        ];
        await runFfmpegWithProgress(singleArgs, totalSecs, (pct) => onLog?.(`Encoding: ${pct}%`));
      } else if (segmentPaths.every((s) => !s.isImage)) {
        // All video segments: use concat demuxer for fast concatenation
        const listPath = path.join(workDir, 'concat.txt');
        await fsp.writeFile(
          listPath,
          segmentPaths
            .map((s) => `file '${s.path.replace(/\\/g, '/').replace(/'/g, "\\'")}'`)
            .join('\n'),
        );

        const concatArgs = [
          '-f', 'concat', '-safe', '0', '-i', listPath,
          ...(voicePath ? ['-i', voicePath] : []),
          ...(voicePath
            ? ['-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]', '-map', '0:v', '-map', '[aout]']
            : []),
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '160k',
          '-t', String(totalSecs),
          '-movflags', '+faststart',
          outPath,
        ];
        await runFfmpegWithProgress(concatArgs, totalSecs, (pct) => onLog?.(`Encoding: ${pct}%`));
      } else {
        // Mixed VIDEO + IMAGE: build filter_complex manually
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

        if (voicePath) {
          args.push('-i', voicePath);
        }

        const concatIn = segmentPaths.map((_, i) => `[v${i}]`).join('');
        filters.push(`${concatIn}concat=n=${segmentPaths.length}:v=1:a=0[vout]`);

        const audioMap: string[] = [];
        if (voicePath) {
          audioMap.push('-map', `${inputIdx}:a`);
        }

        const finalArgs = [
          ...args,
          '-filter_complex', filters.join(';'),
          '-map', '[vout]',
          ...audioMap,
          '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
          ...(voicePath ? ['-c:a', 'aac', '-b:a', '160k'] : []),
          '-t', String(totalSecs),
          '-movflags', '+faststart',
          outPath,
        ];
        await runFfmpegWithProgress(finalArgs, totalSecs, (pct) => onLog?.(`Encoding: ${pct}%`));
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
