import { execFile } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

let _ffmpegPath: string | null | undefined;

export function ffmpegPath(): string | null {
  if (_ffmpegPath !== undefined) return _ffmpegPath;
  try {
    const p = require('ffmpeg-static') as string | null;
    _ffmpegPath = p && existsSync(p) ? p : null;
  } catch {
    _ffmpegPath = null;
  }
  return _ffmpegPath;
}

export function runFfmpeg(args: string[], timeoutMs = 600_000): Promise<void> {
  const bin = ffmpegPath();
  if (!bin) return Promise.reject(new Error('ffmpeg binary not available'));
  return new Promise((resolve, reject) => {
    execFile(bin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${(stderr || err.message).slice(0, 500)}`));
      else resolve();
    });
  });
}

/** Escape a path for use inside an ffmpeg filter argument (subtitles=...). */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export interface ComposeScene {
  /** Video clip preferred; still image used with -loop otherwise. */
  videoPath?: string;
  imagePath?: string;
  durationSecs: number;
}

export interface ComposeOptions {
  scenes: ComposeScene[];
  voicePath?: string;
  musicPath?: string;
  /** SRT file to burn in. */
  subtitlePath?: string;
  outPath: string;
  width: number;
  height: number;
  fps: number;
  /** Music level under narration (simple constant ducking). */
  musicVolume?: number;
}

/**
 * Compose the final video: scene visuals concatenated, narration + ducked
 * music mixed, subtitles burned in. Deterministic infrastructure work — no
 * LLM involved (docs1/media-pipeline.md §8).
 */
export async function composeVideo(opts: ComposeOptions): Promise<void> {
  const { scenes, voicePath, musicPath, subtitlePath, outPath, width, height, fps } = opts;
  if (scenes.length === 0) throw new Error('composeVideo: no scenes provided');

  const args: string[] = [];
  const filters: string[] = [];

  scenes.forEach((s, i) => {
    if (s.videoPath) {
      args.push('-i', s.videoPath);
      filters.push(`[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},trim=duration=${s.durationSecs},setpts=PTS-STARTPTS[v${i}]`);
    } else if (s.imagePath) {
      // Single still in; zoompan generates durationSecs*fps frames from it
      // (d = output frames per input frame — the input must not be looped)
      args.push('-i', s.imagePath);
      const frames = Math.max(1, Math.round(s.durationSecs * fps));
      filters.push(`[${i}:v]scale=${Math.round(width * 1.5)}:${Math.round(height * 1.5)},zoompan=z='min(zoom+0.0006,1.15)':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1[v${i}]`);
    } else {
      throw new Error(`composeVideo: scene ${i} has neither videoPath nor imagePath`);
    }
  });

  const audioInputs: string[] = [];
  let audioIdx = scenes.length;
  if (voicePath) {
    args.push('-i', voicePath);
    audioInputs.push(`[${audioIdx}:a]`);
    audioIdx++;
  }
  if (musicPath) {
    args.push('-stream_loop', '-1', '-i', musicPath);
    filters.push(`[${audioIdx}:a]volume=${opts.musicVolume ?? 0.25}[bgm]`);
    audioInputs.push('[bgm]');
    audioIdx++;
  }

  const concatIn = scenes.map((_, i) => `[v${i}]`).join('');
  const videoOut = subtitlePath ? '[vc]' : '[vout]';
  filters.push(`${concatIn}concat=n=${scenes.length}:v=1:a=0${videoOut}`);
  if (subtitlePath) {
    filters.push(`[vc]subtitles='${escapeFilterPath(subtitlePath)}'[vout]`);
  }

  let audioMap: string[] = [];
  if (audioInputs.length === 2) {
    filters.push(`${audioInputs.join('')}amix=inputs=2:duration=first:dropout_transition=2[aout]`);
    audioMap = ['-map', '[aout]'];
  } else if (audioInputs.length === 1) {
    audioMap = ['-map', audioInputs[0]!.replace(/[[\]]/g, '').includes(':') ? audioInputs[0]!.slice(1, -1) : audioInputs[0]!];
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await runFfmpeg([
    ...args,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    ...audioMap,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    ...(audioInputs.length ? ['-c:a', 'aac', '-b:a', '160k'] : []),
    '-shortest',
    '-movflags', '+faststart',
    outPath,
  ]);
}

/** Write a buffer to a temp file and return its path (caller cleans up the dir). */
export async function toTempFile(buffer: Buffer, ext: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-media-'));
  const p = path.join(dir, `input.${ext}`);
  await fs.writeFile(p, buffer);
  return p;
}
