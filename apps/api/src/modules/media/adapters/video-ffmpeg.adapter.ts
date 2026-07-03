import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { VideoAdapter, SceneVideoRequest, GeneratedMedia } from '../media.types';
import { ffmpegPath, runFfmpeg } from './ffmpeg.util';

/**
 * Scene video from a still frame via ffmpeg (Ken Burns zoom) — the local
 * production path until a generative video provider (Runway/Kling/Pika/Luma)
 * adapter is configured. Real MP4 output, real durations.
 */
export class FfmpegSceneVideoAdapter implements VideoAdapter {
  readonly name = 'ffmpeg-kenburns';

  available(): boolean {
    return ffmpegPath() !== null;
  }

  async renderScene(req: SceneVideoRequest): Promise<GeneratedMedia> {
    if (!req.imagePath) throw new Error('ffmpeg scene adapter requires a source image');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-scene-'));
    const outPath = path.join(dir, 'scene.mp4');
    const fps = 30;
    const frames = Math.max(1, Math.round(req.durationSecs * fps));
    try {
      // Single still in; zoompan's d = output frames PER INPUT FRAME, so the
      // input must NOT be looped (loop × d multiplies frame count).
      await runFfmpeg([
        '-i', req.imagePath,
        '-filter_complex',
        `[0:v]scale=${Math.round(req.width * 1.5)}:${Math.round(req.height * 1.5)},zoompan=z='min(zoom+0.0008,1.2)':d=${frames}:s=${req.width}x${req.height}:fps=${fps},setsar=1[v]`,
        '-map', '[v]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        outPath,
      ]);
      const buffer = await fs.readFile(outPath);
      return {
        buffer,
        mimeType: 'video/mp4',
        ext: 'mp4',
        durationMs: Math.round(req.durationSecs * 1000),
        model: 'ffmpeg-zoompan',
        notes: 'Motion scene from generated still — configure a video provider for generative motion.',
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
