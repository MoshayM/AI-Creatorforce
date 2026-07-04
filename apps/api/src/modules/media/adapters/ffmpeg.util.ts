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

/**
 * Like runFfmpeg but resolves with the combined stderr + stdout text even on
 * exit code 0. volumedetect writes its results to stderr, so we must capture
 * it. Still rejects on nonzero exit code.
 */
export function runFfmpegCapture(args: string[], timeoutMs = 120_000): Promise<string> {
  const bin = ffmpegPath();
  if (!bin) return Promise.reject(new Error('ffmpeg binary not available'));
  return new Promise((resolve, reject) => {
    execFile(bin, ['-y', '-hide_banner', ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const combined = `${stdout ?? ''}\n${stderr ?? ''}`;
      if (err) reject(new Error(`ffmpeg failed: ${(stderr || err.message).slice(0, 500)}`));
      else resolve(combined);
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

export interface SfxOptions {
  /** Absolute path to the SFX audio file (mono WAV recommended). */
  path: string;
  /**
   * Timestamps (in seconds from the start of the composed video) at which
   * the SFX should play. Each occurrence becomes a separate ffmpeg input so
   * that adelay can shift it to the right position without using asplit.
   */
  atSecs: number[];
  /** Volume multiplier applied to every occurrence. Default 0.4. */
  volume?: number;
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
  /** Optional SFX track: one file played at multiple timestamps. */
  sfx?: SfxOptions;
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

  // SFX: add one input per timestamp occurrence (simpler than asplit + delay
  // chain), delay each to the correct position with adelay (takes ms, all=1
  // for mono), apply volume, then mix everything together in the final amix.
  const sfxLabels: string[] = [];
  if (opts.sfx && opts.sfx.atSecs.length > 0) {
    const sfxVol = opts.sfx.volume ?? 0.4;
    opts.sfx.atSecs.forEach((atSec, i) => {
      // One copy of the file per occurrence — no asplit needed
      args.push('-i', opts.sfx!.path);
      const delayMs = Math.round(atSec * 1000);
      const label = `[sfx${i}]`;
      // adelay=<ms>|<ms> (pipe-separated per-channel values) + all=1 is the
      // correct syntax for mono files; all=1 avoids specifying channel count.
      filters.push(`[${audioIdx}:a]volume=${sfxVol},adelay=${delayMs}|${delayMs}[sfx${i}]`);
      sfxLabels.push(label);
      audioIdx++;
    });
  }

  const concatIn = scenes.map((_, i) => `[v${i}]`).join('');
  const videoOut = subtitlePath ? '[vc]' : '[vout]';
  filters.push(`${concatIn}concat=n=${scenes.length}:v=1:a=0${videoOut}`);
  if (subtitlePath) {
    filters.push(`[vc]subtitles='${escapeFilterPath(subtitlePath)}'[vout]`);
  }

  // Merge SFX labels into the audio input list before deciding mix strategy
  const allAudioInputs = [...audioInputs, ...sfxLabels];

  let audioMap: string[] = [];
  if (allAudioInputs.length > 1) {
    filters.push(`${allAudioInputs.join('')}amix=inputs=${allAudioInputs.length}:duration=first:dropout_transition=2[aout]`);
    audioMap = ['-map', '[aout]'];
  } else if (allAudioInputs.length === 1) {
    const only = allAudioInputs[0]!;
    const inner = only.slice(1, -1);
    // Stream specifiers ("3:a") map bare; filter labels ("[bgm]") keep brackets
    audioMap = ['-map', inner.includes(':') ? inner : only];
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await runFfmpeg([
    ...args,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    ...audioMap,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    ...(allAudioInputs.length ? ['-c:a', 'aac', '-b:a', '160k'] : []),
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
