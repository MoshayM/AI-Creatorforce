import { execFile, spawn } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FFmpegMissingError, FFmpegExecutionError, CodecNotSupportedError } from '../media.errors';

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

/** Classify ffmpeg stderr into a user-safe reason string. */
function classifyStderr(stderr: string): { reason: string; codec: boolean } {
  if (/Decoder .* not found|Unknown decoder|Unrecognized|Invalid data found/i.test(stderr)) {
    return { reason: 'The video/audio codec is not supported by the processing engine.', codec: true };
  }
  if (/No such file|does not exist/i.test(stderr)) {
    return { reason: 'Input file missing.', codec: false };
  }
  return { reason: 'The video engine exited with an error.', codec: false };
}

export function runFfmpeg(args: string[], timeoutMs = 600_000): Promise<void> {
  const bin = ffmpegPath();
  if (!bin) {
    return Promise.reject(new FFmpegMissingError(
      'ffmpeg binary not found — install ffmpeg-static or set FFMPEG_PATH.',
      { command: 'ffmpeg ' + args.join(' ') },
    ));
  }
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    execFile(bin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (!err) { resolve(); return; }
      const stderrTail = (stderr || err.message).slice(-2000);
      const timedOut = !!(err as NodeJS.ErrnoException & { killed?: boolean }).killed;
      const durationMs = Date.now() - t0;
      const command = 'ffmpeg ' + ['-y', '-hide_banner', '-loglevel', 'error', ...args].join(' ');
      const exitCode = (err as NodeJS.ErrnoException & { code?: number | string }).code;
      const details: Record<string, unknown> = { exitCode, stderrTail, command, durationMs, ...(timedOut ? { timedOut: true } : {}) };
      if (timedOut) {
        reject(new FFmpegExecutionError('Processing exceeded the time limit.', details));
        return;
      }
      const { reason, codec } = classifyStderr(stderrTail);
      if (codec) {
        reject(new CodecNotSupportedError(reason, details));
      } else {
        reject(new FFmpegExecutionError(reason, details));
      }
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
  if (!bin) {
    return Promise.reject(new FFmpegMissingError(
      'ffmpeg binary not found — install ffmpeg-static or set FFMPEG_PATH.',
      { command: 'ffmpeg ' + args.join(' ') },
    ));
  }
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    execFile(bin, ['-y', '-hide_banner', ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const combined = `${stdout ?? ''}\n${stderr ?? ''}`;
      if (!err) { resolve(combined); return; }
      const stderrTail = (stderr || err.message).slice(-2000);
      const timedOut = !!(err as NodeJS.ErrnoException & { killed?: boolean }).killed;
      const durationMs = Date.now() - t0;
      const command = 'ffmpeg ' + ['-y', '-hide_banner', ...args].join(' ');
      const exitCode = (err as NodeJS.ErrnoException & { code?: number | string }).code;
      const details: Record<string, unknown> = { exitCode, stderrTail, command, durationMs, ...(timedOut ? { timedOut: true } : {}) };
      if (timedOut) {
        reject(new FFmpegExecutionError('Processing exceeded the time limit.', details));
        return;
      }
      const { reason, codec } = classifyStderr(stderrTail);
      if (codec) {
        reject(new CodecNotSupportedError(reason, details));
      } else {
        reject(new FFmpegExecutionError(reason, details));
      }
    });
  });
}

/** Escape a path for use inside an ffmpeg filter argument (subtitles=...). */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/**
 * Stream/container info for a media file, as ffmpeg's `-i` banner text.
 * `ffmpeg -i` without an output exits nonzero by design — the exit code is
 * ignored; the stream description on stderr is the result.
 */
export function probeMediaInfo(inputPath: string): Promise<string> {
  const bin = ffmpegPath();
  if (!bin) return Promise.resolve('');
  return new Promise((resolve) => {
    execFile(bin, ['-hide_banner', '-i', inputPath], { timeout: 30_000, maxBuffer: 1024 * 1024 }, (_err, stdout, stderr) => {
      resolve(`${stdout ?? ''}\n${stderr ?? ''}`);
    });
  });
}

/**
 * True when the probe text describes an AV1 video stream. The bundled
 * ffmpeg-static has no dav1d, so AV1 decodes through libaom at a small
 * fraction of realtime — long AV1 sources must be re-acquired as H.264
 * before frame-decoding stages (scene detection, clip rendering).
 */
export function isAv1Info(probeText: string): boolean {
  return /Stream #.*Video:\s*av1\b/i.test(probeText);
}

/**
 * Pure parser over the `ffmpeg -i` banner output.
 * Extracts duration, resolution, fps, bitrate, video/audio codec.
 */
export function parseMediaProbe(probeText: string): {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bitrateKbps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
} {
  // Duration: HH:MM:SS.cc
  let durationMs: number | null = null;
  const durMatch = probeText.match(/Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/);
  if (durMatch) {
    const h = parseInt(durMatch[1]!, 10);
    const m = parseInt(durMatch[2]!, 10);
    const s = parseInt(durMatch[3]!, 10);
    const frac = parseInt(durMatch[4]!, 10);
    // fractional part: pad/truncate to centiseconds
    const fracMs = Math.round(frac * 10); // assuming 2 decimal places = centiseconds
    durationMs = (h * 3600 + m * 60 + s) * 1000 + fracMs;
  }

  // Bitrate: NNN kb/s (container bitrate from Duration line)
  let bitrateKbps: number | null = null;
  const bitrateMatch = probeText.match(/bitrate:\s*(\d+)\s*kb\/s/);
  if (bitrateMatch) {
    bitrateKbps = parseInt(bitrateMatch[1]!, 10);
  }

  // Video stream: Stream #...: Video: <codec> ..., WxH ..., NN fps
  let videoCodec: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let fps: number | null = null;
  const videoMatch = probeText.match(/Stream #[^:]*:.*Video:\s*([\w\d]+)/);
  if (videoMatch) {
    videoCodec = videoMatch[1]!;
  }
  const resMatch = probeText.match(/,\s*(\d{2,5})x(\d{2,5})/);
  if (resMatch) {
    width = parseInt(resMatch[1]!, 10);
    height = parseInt(resMatch[2]!, 10);
  }
  const fpsMatch = probeText.match(/,\s*([\d.]+)\s*(?:fps|tbr)/);
  if (fpsMatch) {
    fps = parseFloat(fpsMatch[1]!);
  }

  // Audio stream: Stream #...: Audio: <codec>
  let audioCodec: string | null = null;
  const audioMatch = probeText.match(/Stream #[^:]*:.*Audio:\s*([\w\d]+)/);
  if (audioMatch) {
    audioCodec = audioMatch[1]!;
  }

  return { durationMs, width, height, fps, bitrateKbps, videoCodec, audioCodec };
}

/**
 * Retry wrapper for transient ffmpeg/IO failures (EBUSY, EPERM, EACCES, etc.).
 * Never retries codec errors, validation errors, or timeouts.
 */
export async function withFfmpegRetries<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 2000,
): Promise<T> {
  const TRANSIENT_RE = /EBUSY|EPERM|EACCES|EIO|Permission denied|Resource temporarily unavailable|being used by another process/i;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Do not retry codec/validation errors or timeouts
      const isTransient = TRANSIENT_RE.test(msg);
      if (!isTransient) throw err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

/**
 * Run ffmpeg reporting REAL progress (master prompt §3.5): percent is derived
 * from the `time=` marker ffmpeg writes while encoding, against the known
 * output duration — seconds encoded / seconds total, never a timer.
 */
export function runFfmpegWithProgress(
  args: string[],
  totalDurationSecs: number,
  onProgress: (pct: number) => void,
  timeoutMs = 1_800_000,
): Promise<void> {
  const bin = ffmpegPath();
  if (!bin) {
    return Promise.reject(new FFmpegMissingError(
      'ffmpeg binary not found — install ffmpeg-static or set FFMPEG_PATH.',
      { command: 'ffmpeg ' + args.join(' ') },
    ));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-y', '-hide_banner', ...args], { windowsHide: true });
    let stderrTail = '';
    let lastPct = -1;
    const t0 = Date.now();
    const timer = setTimeout(() => {
      child.kill();
      const command = 'ffmpeg ' + ['-y', '-hide_banner', ...args].join(' ');
      reject(new FFmpegExecutionError('Processing exceeded the time limit.', {
        exitCode: null,
        stderrTail: stderrTail.slice(-2000),
        command,
        durationMs: Date.now() - t0,
        timedOut: true,
      }));
    }, timeoutMs);

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      const m = /time=(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(text);
      if (m && totalDurationSecs > 0) {
        const secs = +m[1]! * 3600 + +m[2]! * 60 + +m[3]!;
        const pct = Math.min(99, Math.floor((secs / totalDurationSecs) * 100));
        if (pct > lastPct) {
          lastPct = pct;
          try { onProgress(pct); } catch { /* progress must never kill the encode */ }
        }
      }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) { onProgress(100); resolve(); return; }
      const command = 'ffmpeg ' + ['-y', '-hide_banner', ...args].join(' ');
      const details: Record<string, unknown> = {
        exitCode: code,
        stderrTail: stderrTail.slice(-2000),
        command,
        durationMs: Date.now() - t0,
      };
      const { reason, codec } = classifyStderr(stderrTail);
      if (codec) {
        reject(new CodecNotSupportedError(reason, details));
      } else {
        reject(new FFmpegExecutionError(reason, details));
      }
    });
  });
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
  /** Real encode progress (0–100), derived from ffmpeg's time= marker. */
  onProgress?: (pct: number) => void;
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
  // -shortest is unreliable with filter_complex outputs (audio can outlive the
  // video track); cap the container to the scenes' total explicitly.
  const totalSecs = scenes.reduce((s, sc) => s + sc.durationSecs, 0);
  const finalArgs = [
    ...args,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    ...audioMap,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    ...(allAudioInputs.length ? ['-c:a', 'aac', '-b:a', '160k'] : []),
    '-t', String(totalSecs),
    '-shortest',
    '-movflags', '+faststart',
    outPath,
  ];
  if (opts.onProgress) await runFfmpegWithProgress(finalArgs, totalSecs, opts.onProgress);
  else await runFfmpeg(finalArgs);
}

/** Write a buffer to a temp file and return its path (caller cleans up the dir). */
export async function toTempFile(buffer: Buffer, ext: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-media-'));
  const p = path.join(dir, `input.${ext}`);
  await fs.writeFile(p, buffer);
  return p;
}
