import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runFfmpegCapture, withFfmpegRetries } from '../media/adapters/ffmpeg.util';
import { VideoImportService } from './video-import.service';
import { AnalysisCacheService } from './analysis-cache.service';
import { SceneDetectionError } from '../media/media.errors';
import { appendVideoImportLog } from '../media/video-import-log.util';

const SCENE_THRESHOLD = 0.3;
/** Guard against pathological outputs on very long or very cutty videos. */
const MAX_SCENES = 2_000;

/**
 * SCENE_DETECTION stage (ai.md Section 3): FFmpeg scene-change scoring over
 * the source video produces VideoScene rows. Resume rule 16.5: scenes are
 * immutable once written for a video — a second run is a no-op.
 */
@Injectable()
export class SceneDetectionService {
  private readonly logger = new Logger(SceneDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly videoImport: VideoImportService,
    private readonly analysisCache: AnalysisCacheService,
  ) {}

  async ensureScenes(importedVideoId: string, onLog?: (msg: string) => void) {
    const video = await this.prisma.importedVideo.findUnique({ where: { id: importedVideoId } });
    if (!video) throw new NotFoundException('Imported video not found');

    const existing = await this.prisma.videoScene.count({ where: { importedVideoId } });
    if (existing > 0) {
      onLog?.(`Scenes already detected (${existing}) — reusing`);
      return { skipped: true, scenes: existing };
    }

    // §12 content-hash cache: identical source already scene-scored — copy
    // rows and skip the (long) ffmpeg pass.
    const cached = await this.analysisCache.copyScenes(importedVideoId, onLog);
    if (cached) return { skipped: false, scenes: cached.scenes, fromCache: true };

    const sourcePath = await this.videoImport.getSourcePath(importedVideoId);
    onLog?.('Detecting scene changes…');
    const boundaries = await this.detectBoundaries(sourcePath);

    // Boundaries → contiguous scenes covering [0, duration]
    const cuts = boundaries
      .filter((b) => b.timeMs > 0 && b.timeMs < video.durationMs)
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, MAX_SCENES);
    const scenes: Array<{ startMs: number; endMs: number; confidence: number | null }> = [];
    let cursor = 0;
    for (const cut of cuts) {
      if (cut.timeMs - cursor < 250) continue; // merge sub-250ms slivers into the previous scene
      scenes.push({ startMs: cursor, endMs: cut.timeMs, confidence: cut.score });
      cursor = cut.timeMs;
    }
    scenes.push({ startMs: cursor, endMs: video.durationMs, confidence: null });

    await this.prisma.videoScene.createMany({
      data: scenes.map((s) => ({
        importedVideoId,
        startMs: s.startMs,
        endMs: s.endMs,
        sceneChangeConfidence: s.confidence,
      })),
    });
    onLog?.(`Scene detection complete — ${scenes.length} scenes`);
    return { skipped: false, scenes: scenes.length };
  }

  /** Run ffmpeg scene-score filter and parse cut timestamps from metadata output. */
  private async detectBoundaries(sourcePath: string): Promise<Array<{ timeMs: number; score: number }>> {
    const out = await withFfmpegRetries(
      () => runFfmpegCapture(
        [
          '-i', sourcePath,
          '-vf', `select='gt(scene,${SCENE_THRESHOLD})',metadata=print`,
          '-an', '-f', 'null', '-',
        ],
        1_800_000,
      ),
    ).catch((err: unknown) => {
      void appendVideoImportLog({ stage: 'SCENE_DETECTION', sourcePath, error: err instanceof Error ? err.message : String(err) });
      if (err instanceof Error && err.constructor.name !== 'FFmpegExecutionError' && err.constructor.name !== 'CodecNotSupportedError') {
        throw new SceneDetectionError('Scene detection failed unexpectedly.', { message: err instanceof Error ? err.message.slice(0, 500) : String(err) });
      }
      throw err;
    });
    // metadata=print emits pairs of lines:
    //   frame:12 pts:307 pts_time:10.24
    //   lavfi.scene_score=0.402
    const boundaries: Array<{ timeMs: number; score: number }> = [];
    let pendingTimeMs: number | null = null;
    for (const line of out.split('\n')) {
      const t = line.match(/pts_time:([\d.]+)/);
      if (t) {
        pendingTimeMs = Math.round(parseFloat(t[1]!) * 1000);
        continue;
      }
      const s = line.match(/lavfi\.scene_score=([\d.]+)/);
      if (s && pendingTimeMs != null) {
        boundaries.push({ timeMs: pendingTimeMs, score: parseFloat(s[1]!) });
        pendingTimeMs = null;
      }
    }
    this.logger.log(`ffmpeg scene detection found ${boundaries.length} cuts`);
    return boundaries;
  }
}
