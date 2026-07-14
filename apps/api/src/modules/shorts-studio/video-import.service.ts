import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fsp, existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';
import { ffmpegPath } from '../media/adapters/ffmpeg.util';
import { YouTubeReadService, parseSrt, type TranscriptCueDTO } from './youtube-read.service';

/** Title marking the auto-created per-channel container project for channel-first imports. */
export const SHORTS_CONTAINER_PROJECT_TITLE = 'Shorts Studio';

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

    const meta = await this.youtubeRead.getVideoMetadata(project.channelId, youtubeVideoId);
    if (meta.durationMs <= 0) {
      throw new BadRequestException('Could not determine video duration — is this a live stream or premiere?');
    }

    const data = {
      title: meta.title,
      description: meta.description,
      durationMs: Math.round(meta.durationMs),
      thumbnailUrl: meta.thumbnailUrl,
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

    const existingKey = video.sourceAsset?.versions[0]?.r2Key;
    if (existingKey && this.storage.exists(existingKey)) {
      onLog?.('Source video already downloaded — reusing existing asset');
      return { skipped: true, assetId: video.sourceAssetId, key: existingKey };
    }

    onLog?.(`Downloading source video ${video.youtubeVideoId}…`);
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-shorts-'));
    const tmpOut = path.join(tmpDir, 'source.mp4');
    try {
      await this.runYtDlp(video.youtubeVideoId, tmpOut);
      const stat = await fsp.stat(tmpOut);
      if (stat.size === 0) throw new Error('Downloaded file is empty');

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
      onLog?.(`Source video stored (${Math.round(sizeBytes / 1024 / 1024)} MB)`);
      return { skipped: false, assetId: asset.id, key };
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

  private runYtDlp(youtubeVideoId: string, outPath: string): Promise<void> {
    const bin = this.ytDlpBin();
    // yt-dlp needs ffmpeg to merge separate video+audio streams; hand it the
    // bundled ffmpeg-static binary so it doesn't depend on PATH.
    const ffmpeg = ffmpegPath();
    const args = [
      `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      '-f', 'bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4]/b',
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
