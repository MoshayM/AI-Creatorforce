import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fsp, existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { ffmpegPath, probeMediaInfo, isAv1Info, parseMediaProbe } from '../media/adapters/ffmpeg.util';
import { YouTubeReadService, parseSrt, type TranscriptCueDTO } from './youtube-read.service';
import { VideoValidationError, ImportPipelineError } from '../media/media.errors';
import { appendVideoImportLog } from '../media/video-import-log.util';

/** Title marking the auto-created per-channel container project for channel-first imports. */
export const SHORTS_CONTAINER_PROJECT_TITLE = 'Shorts Studio';

/**
 * H.264 (avc1) first: the bundled ffmpeg has no dav1d, so AV1 decodes through
 * libaom at a fraction of realtime — a 90-minute AV1 source blew the 30-minute
 * scene-detection timeout. YouTube serves avc1 renditions up to 1080p for
 * essentially every video, so the first branch nearly always matches.
 */
const YTDLP_FORMAT = 'bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/b';
/** Strict variant for re-acquiring an existing AV1 source: H.264 or nothing. */
const YTDLP_FORMAT_H264_ONLY = 'bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[vcodec^=avc1]';

/**
 * VIDEO_IMPORT stage (ai.md Section 3): creates/refreshes the ImportedVideo
 * row from YouTube metadata and materialises the source media file as a
 * SHORTS_SOURCE_VIDEO asset. Resume rule 16.1: a video whose source asset
 * already exists on disk is never re-downloaded.
 *
 * Source acquisition uses a yt-dlp binary (YT_DLP_PATH env or `yt-dlp` on
 * PATH) against the creator's own video. If the binary is missing the import
 * fails with instructions — there is no official Data API download endpoint.
 */
@Injectable()
export class VideoImportService {
  private readonly logger = new Logger(VideoImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly youtubeRead: YouTubeReadService,
  ) {}

  /** Create or refresh the ImportedVideo row (metadata only; no media download). */
  async importVideo(userId: string, projectId: string, youtubeVideoId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true, channelId: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    if (!project.channelId) throw new BadRequestException('This project has no connected channel — cannot import YouTube metadata without OAuth access.');
    const meta = await this.youtubeRead.getVideoMetadata(project.channelId, youtubeVideoId);
    if (meta.durationMs <= 0) {
      throw new BadRequestException('Could not determine video duration — is this a live stream or premiere?');
    }

    const data = {
      title: meta.title,
      description: meta.description,
      durationMs: Math.round(meta.durationMs),
      thumbnailUrl: meta.thumbnailUrl,
      originalAudioLanguage: meta.defaultAudioLanguage,
      viewCount: meta.viewCount != null ? BigInt(meta.viewCount) : null,
      likeCount: meta.likeCount != null ? BigInt(meta.likeCount) : null,
      commentCount: meta.commentCount != null ? BigInt(meta.commentCount) : null,
    };
    return this.prisma.importedVideo.upsert({
      where: { projectId_youtubeVideoId: { projectId, youtubeVideoId } },
      create: { projectId, youtubeVideoId, ...data },
      update: data,
    });
  }

  /**
   * Channel-first import (library flow): metadata comes from the synced
   * LibraryVideo row when available (no YouTube API call), falling back to
   * live metadata. Rows land in an auto-created per-channel container
   * project so Shorts Studio needs no project selection.
   */
  async importFromChannel(userId: string, channelId: string, youtubeVideoId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
      select: { id: true, title: true },
    });
    if (!channel) throw new NotFoundException('Channel not found');

    const lib = await this.prisma.libraryVideo.findUnique({
      where: { channelId_youtubeVideoId: { channelId, youtubeVideoId } },
    });
    let data: {
      title: string;
      description: string | null;
      durationMs: number;
      thumbnailUrl: string | null;
      /** Only known on the live-metadata path — omitted (not nulled) otherwise. */
      originalAudioLanguage?: string | null;
      viewCount: bigint | null;
      likeCount: bigint | null;
      commentCount: bigint | null;
    };
    if (lib && lib.durationMs > 0) {
      data = {
        title: lib.title,
        description: lib.description,
        durationMs: lib.durationMs,
        thumbnailUrl: lib.thumbnailUrl,
        viewCount: lib.viewCount != null ? BigInt(lib.viewCount) : null,
        likeCount: lib.likeCount != null ? BigInt(lib.likeCount) : null,
        commentCount: lib.commentCount != null ? BigInt(lib.commentCount) : null,
      };
    } else {
      const meta = await this.youtubeRead.getVideoMetadata(channelId, youtubeVideoId);
      if (meta.durationMs <= 0) {
        throw new BadRequestException('Could not determine video duration — is this a live stream or premiere?');
      }
      data = {
        title: meta.title,
        description: meta.description,
        durationMs: Math.round(meta.durationMs),
        thumbnailUrl: meta.thumbnailUrl,
        originalAudioLanguage: meta.defaultAudioLanguage,
        viewCount: meta.viewCount != null ? BigInt(meta.viewCount) : null,
        likeCount: meta.likeCount != null ? BigInt(meta.likeCount) : null,
        commentCount: meta.commentCount != null ? BigInt(meta.commentCount) : null,
      };
    }

    // A video already imported into any of the channel's projects is the same
    // video in the channel-first view — refresh it instead of duplicating.
    const existing = await this.prisma.importedVideo.findFirst({
      where: { youtubeVideoId, project: { channelId, userId } },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.importedVideo.update({ where: { id: existing.id }, data });
    }

    const project = await this.resolveShortsProject(userId, channelId, channel.title);
    return this.prisma.importedVideo.create({
      data: { projectId: project.id, youtubeVideoId, ...data },
    });
  }

  /** Find or create the channel's Shorts Studio container project. */
  private async resolveShortsProject(userId: string, channelId: string, channelTitle: string) {
    const existing = await this.prisma.project.findFirst({
      where: { userId, channelId, title: SHORTS_CONTAINER_PROJECT_TITLE },
      select: { id: true },
    });
    if (existing) return existing;
    return this.prisma.project.create({
      data: {
        userId,
        channelId,
        title: SHORTS_CONTAINER_PROJECT_TITLE,
        description: `Auto-created container for Shorts Studio imports on ${channelTitle}`,
      },
      select: { id: true },
    });
  }

  /**
   * Ensure the source media exists as an asset. Returns { skipped: true }
   * when a previous run already produced it (resume support).
   */
  async ensureSourceDownloaded(importedVideoId: string, onLog?: (msg: string) => void) {
    const video = await this.prisma.importedVideo.findUnique({
      where: { id: importedVideoId },
      include: { sourceAsset: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } },
    });
    if (!video) throw new NotFoundException('Imported video not found');

    const sourceAsset = video.sourceAsset;
    const existingKey = sourceAsset?.versions[0]?.r2Key;
    if (sourceAsset && existingKey && this.storage.exists(existingKey)) {
      // Pre-fix imports may hold an AV1 source (see YTDLP_FORMAT) — decoding
      // stages can't finish on those, so re-acquire an H.264 rendition as a
      // new version of the same asset. Failure keeps the AV1 source usable.
      if (isAv1Info(await probeMediaInfo(this.storage.resolve(existingKey)))) {
        onLog?.('Existing source is AV1 (very slow to decode) — re-acquiring H.264 rendition…');
        try {
          return await this.reacquireAsH264(sourceAsset.id, video.projectId, video.youtubeVideoId, video.durationMs, onLog);
        } catch (err) {
          this.logger.warn(`H.264 re-acquire failed for ${video.youtubeVideoId}, keeping AV1 source: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      onLog?.('Source video already downloaded — reusing existing asset');
      return { skipped: true, assetId: video.sourceAssetId, key: existingKey };
    }

    onLog?.(`Downloading source video ${video.youtubeVideoId}…`);
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-shorts-'));
    const tmpOut = path.join(tmpDir, 'source.mp4');
    try {
      await this.runYtDlp(video.youtubeVideoId, tmpOut).catch((err: unknown) => {
        const stderrTail = err instanceof Error ? err.message.slice(0, 2000) : String(err);
        throw new ImportPipelineError('Downloading the source video from YouTube failed.', { stderrTail, youtubeVideoId: video.youtubeVideoId });
      });
      const stat = await fsp.stat(tmpOut);
      if (stat.size === 0) {
        throw new VideoValidationError('The file contains no video stream.', { youtubeVideoId: video.youtubeVideoId });
      }
      // Pre-processing validation: probe the downloaded file
      const probeText = await probeMediaInfo(tmpOut);
      const { durationMs: probeDurationMs, videoCodec, audioCodec } = parseMediaProbe(probeText);
      if (!videoCodec) {
        throw new VideoValidationError('The file contains no video stream.', { youtubeVideoId: video.youtubeVideoId, probeText: probeText.slice(0, 500) });
      }
      if (probeDurationMs === null || probeDurationMs <= 0) {
        throw new VideoValidationError('Could not read the video duration.', { youtubeVideoId: video.youtubeVideoId, probeDurationMs });
      }
      if (!audioCodec) {
        throw new VideoValidationError('The video has no audio track — Shorts Studio needs the original audio.', { youtubeVideoId: video.youtubeVideoId });
      }

      const asset = await this.prisma.asset.create({
        data: {
          projectId: video.projectId,
          kind: 'SHORTS_SOURCE_VIDEO',
          label: `Shorts source: ${video.title}`,
          status: 'READY',
        },
      });
      const key = `assets/${video.projectId}/${asset.id}/v1/source.mp4`;
      const { absPath, sizeBytes } = await this.storage.copyIn(key, tmpOut);
      const contentHash = createHash('sha256')
        .update(await fsp.readFile(absPath))
        .digest('hex');
      const version = await this.prisma.assetVersion.create({
        data: {
          assetId: asset.id,
          version: 1,
          r2Key: key,
          contentHash,
          provider: 'yt-dlp',
          sizeBytes: BigInt(sizeBytes),
          durationMs: video.durationMs,
          provenance: {
            source: 'youtube',
            youtubeVideoId: video.youtubeVideoId,
            importedAt: new Date().toISOString(),
          } as never,
        },
      });
      await this.prisma.asset.update({ where: { id: asset.id }, data: { currentVersionId: version.id } });
      await this.prisma.importedVideo.update({
        where: { id: importedVideoId },
        data: { sourceAssetId: asset.id },
      });
      void appendVideoImportLog({ stage: 'VIDEO_IMPORT', youtubeVideoId: video.youtubeVideoId, assetId: asset.id, sizeBytes, videoCodec, audioCodec });
      onLog?.(`Source video stored (${Math.round(sizeBytes / 1024 / 1024)} MB)`);
      return { skipped: false, assetId: asset.id, key };
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Download the H.264 rendition of a video whose stored source is AV1 and
   * attach it as the next version of the same asset (write-once history:
   * the AV1 version stays). Downstream stages resolve the latest version.
   */
  private async reacquireAsH264(
    assetId: string,
    projectId: string,
    youtubeVideoId: string,
    durationMs: number,
    onLog?: (msg: string) => void,
  ) {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-shorts-h264-'));
    const tmpOut = path.join(tmpDir, 'source.mp4');
    try {
      await this.runYtDlp(youtubeVideoId, tmpOut, YTDLP_FORMAT_H264_ONLY).catch((err: unknown) => {
        const stderrTail = err instanceof Error ? err.message.slice(0, 2000) : String(err);
        throw new ImportPipelineError('Downloading the source video from YouTube failed.', { stderrTail, youtubeVideoId });
      });
      const stat = await fsp.stat(tmpOut);
      if (stat.size === 0) {
        throw new VideoValidationError('The file contains no video stream.', { youtubeVideoId });
      }
      if (isAv1Info(await probeMediaInfo(tmpOut))) throw new Error('H.264 rendition unavailable (got AV1 again)');

      const latest = await this.prisma.assetVersion.findFirst({
        where: { assetId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      const key = `assets/${projectId}/${assetId}/v${nextVersion}/source.mp4`;
      const { absPath, sizeBytes } = await this.storage.copyIn(key, tmpOut);
      const contentHash = createHash('sha256')
        .update(await fsp.readFile(absPath))
        .digest('hex');
      const version = await this.prisma.assetVersion.create({
        data: {
          assetId,
          version: nextVersion,
          r2Key: key,
          contentHash,
          provider: 'yt-dlp',
          sizeBytes: BigInt(sizeBytes),
          durationMs,
          provenance: {
            source: 'youtube',
            youtubeVideoId,
            importedAt: new Date().toISOString(),
            reacquired: 'h264 (AV1 source too slow to decode)',
          } as never,
        },
      });
      await this.prisma.asset.update({ where: { id: assetId }, data: { currentVersionId: version.id } });
      onLog?.(`H.264 source stored (${Math.round(sizeBytes / 1024 / 1024)} MB)`);
      return { skipped: false, assetId, key };
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Resolve the absolute path of the source media for downstream stages. */
  async getSourcePath(importedVideoId: string): Promise<string> {
    const video = await this.prisma.importedVideo.findUnique({
      where: { id: importedVideoId },
      include: { sourceAsset: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } },
    });
    const key = video?.sourceAsset?.versions[0]?.r2Key;
    if (!key || !this.storage.exists(key)) {
      throw new BadRequestException('Source video is not downloaded yet — run the import pipeline first');
    }
    return this.storage.resolve(key);
  }

  private ytDlpBin(): string {
    return process.env['YT_DLP_PATH'] ?? 'yt-dlp';
  }

  /** yt-dlp needs a JS runtime for YouTube extraction; hand it our own node. */
  private jsRuntimeArgs(): string[] {
    return ['--js-runtimes', `node:${process.execPath}`];
  }

  /**
   * Fetch the video's public (auto-)captions via yt-dlp — no OAuth scope
   * needed, works for any public video. Prefers the original spoken
   * language ("<lang>-orig"), then English, then whatever exists.
   */
  async downloadAutoCaptions(youtubeVideoId: string): Promise<TranscriptCueDTO[] | null> {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-subs-'));
    try {
      const ffmpeg = ffmpegPath();
      // A nonzero exit only matters if NOTHING downloaded — one language
      // 429-ing must not discard the tracks that did arrive.
      const stderrText = await new Promise<string>((resolve) => {
        execFile(this.ytDlpBin(), [
          `https://www.youtube.com/watch?v=${youtubeVideoId}`,
          '--skip-download', '--no-playlist',
          '--write-subs', '--write-auto-subs',
          '--sub-format', 'srt/best',
          // Original spoken track + English only — requesting all languages
          // walks every auto-translation (~150) and gets rate-limited (429)
          '--sub-langs', '.*-orig,en',
          ...this.jsRuntimeArgs(),
          ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []),
          '-o', path.join(tmpDir, 'subs'),
        ], { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
          resolve(err ? String(stderr || err.message) : '');
        });
      });

      const files = (await fsp.readdir(tmpDir)).filter((f) => /\.(srt|vtt)$/.test(f));
      if (files.length === 0) {
        if (stderrText) this.logger.warn(`yt-dlp subtitles failed: ${stderrText.slice(0, 300)}`);
        return null;
      }
      const pick =
        files.find((f) => /-orig\.[a-z]+$/i.test(f.replace(/\.(srt|vtt)$/, ''))) ??
        files.find((f) => /\.en[.-]/.test(f) || /\.en\.(srt|vtt)$/.test(f)) ??
        files[0]!;
      this.logger.log(`Auto-captions: picked ${pick} of [${files.join(', ')}]`);
      const cues = parseSrt(await fsp.readFile(path.join(tmpDir, pick), 'utf8'));
      return cues.length > 0 ? cues : null;
    } catch (err) {
      this.logger.warn(`Auto-caption download failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runYtDlp(youtubeVideoId: string, outPath: string, format: string = YTDLP_FORMAT): Promise<void> {
    const bin = this.ytDlpBin();
    // yt-dlp needs ffmpeg to merge separate video+audio streams; hand it the
    // bundled ffmpeg-static binary so it doesn't depend on PATH.
    const ffmpeg = ffmpegPath();
    const args = [
      `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      '-f', format,
      '--merge-output-format', 'mp4',
      '--no-playlist',
      ...this.jsRuntimeArgs(),
      ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []),
      '-o', outPath,
    ];
    return new Promise((resolve, reject) => {
      execFile(bin, args, { timeout: 1_800_000, maxBuffer: 8 * 1024 * 1024 }, (err, _stdout, stderr) => {
        if (err) {
          const notFound = /ENOENT/.test(err.message);
          reject(new Error(
            notFound
              ? `yt-dlp binary not found ("${bin}"). Install yt-dlp and/or set YT_DLP_PATH in .env to import source videos.`
              : `yt-dlp failed: ${(stderr || err.message).slice(0, 500)}`,
          ));
        } else if (!existsSync(outPath)) {
          reject(new Error('yt-dlp completed but produced no output file'));
        } else {
          resolve();
        }
      });
    });
  }
}
