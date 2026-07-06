import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runFfmpegCapture } from './adapters/ffmpeg.util';

/**
 * Validation Engine (ai-creatorforce-master-prompt.md §9): ffmpeg-based media
 * checks that gate stage completion. A stage may only be COMPLETED when its
 * output exists, decodes, has real duration, audible audio and non-black
 * video. Callers treat a failed result as a stage failure — never a warning.
 */

export interface ValidationIssue {
  check: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  durationMs?: number;
}

export type MediaValidationKind = 'VOICE' | 'MUSIC' | 'IMAGE' | 'VIDEO';

export interface ValidationOptions {
  /** Expected duration; tolerance is max(2s, 15%). */
  expectedDurationMs?: number;
  /** Reject audio quieter than this mean volume (dB). Default -50. */
  silenceMeanDb?: number;
  /** Reject video whose black-frame time exceeds this fraction. Default 0.4. */
  maxBlackRatio?: number;
  /** Whether the file is expected to carry an audio track (final mixes). */
  requireAudio?: boolean;
}

const DURATION_RE = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d{2})/;
const MEAN_VOLUME_RE = /mean_volume:\s*(-?[\d.]+)\s*dB/;
const BLACK_RE = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
const AUDIO_STREAM_RE = /Stream #\d+:\d+[^\n]*Audio:/;
const VIDEO_DIM_RE = /Stream #\d+:\d+[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/;

function parseDurationMs(out: string): number | undefined {
  const m = out.match(DURATION_RE);
  if (!m) return undefined;
  return ((+m[1]! * 3600 + +m[2]! * 60 + +m[3]!) * 1000) + +m[4]! * 10;
}

/** Validate a media file on disk. Decodes the full file (that is the point). */
export async function validateMediaFile(
  kind: MediaValidationKind,
  filePath: string,
  opts: ValidationOptions = {},
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat || stat.size === 0) {
    return { ok: false, issues: [{ check: 'exists', message: 'Output file is missing or zero bytes' }] };
  }
  // Anything under 1 KB cannot be real media of any kind we produce
  if (stat.size < 1024) {
    issues.push({ check: 'size', message: `Output file is implausibly small (${stat.size} bytes)` });
  }

  const isAudio = kind === 'VOICE' || kind === 'MUSIC';
  const isVideo = kind === 'VIDEO';

  let out: string;
  try {
    const args = ['-i', filePath];
    if (kind === 'IMAGE') {
      args.push('-frames:v', '1');
    } else {
      if (isAudio || opts.requireAudio) args.push('-af', 'volumedetect');
      if (isVideo) args.push('-vf', `blackdetect=d=1:pic_th=0.98`);
    }
    args.push('-f', 'null', '-');
    out = await runFfmpegCapture(args, 1_800_000);
  } catch (err) {
    return {
      ok: false,
      issues: [...issues, { check: 'decode', message: `File does not decode: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}` }],
    };
  }

  const durationMs = parseDurationMs(out);

  if (kind === 'IMAGE') {
    const dim = out.match(VIDEO_DIM_RE);
    if (!dim) {
      issues.push({ check: 'image-stream', message: 'No decodable image stream found' });
    } else if (+dim[1]! < 16 || +dim[2]! < 16) {
      issues.push({ check: 'image-dimensions', message: `Image too small (${dim[1]}x${dim[2]})` });
    }
    return { ok: issues.length === 0, issues, durationMs };
  }

  // Duration checks
  if (durationMs === undefined || durationMs <= 0) {
    issues.push({ check: 'duration', message: 'Media has no measurable duration' });
  } else if (opts.expectedDurationMs) {
    const tolerance = Math.max(2_000, opts.expectedDurationMs * 0.15);
    if (Math.abs(durationMs - opts.expectedDurationMs) > tolerance) {
      issues.push({
        check: 'duration-match',
        message: `Duration ${(durationMs / 1000).toFixed(1)}s deviates from expected ${(opts.expectedDurationMs / 1000).toFixed(1)}s beyond ±${(tolerance / 1000).toFixed(1)}s`,
      });
    }
  }

  // Audio silence scan
  if (isAudio || opts.requireAudio) {
    if (!AUDIO_STREAM_RE.test(out)) {
      issues.push({ check: 'audio-stream', message: 'No audio stream present' });
    } else {
      const mean = out.match(MEAN_VOLUME_RE);
      const threshold = opts.silenceMeanDb ?? -50;
      if (!mean) {
        issues.push({ check: 'audio-silence', message: 'Could not measure audio loudness' });
      } else if (parseFloat(mean[1]!) < threshold) {
        issues.push({ check: 'audio-silence', message: `Audio is effectively silent (mean ${mean[1]} dB < ${threshold} dB)` });
      }
    }
  }

  // Black-frame scan
  if (isVideo && durationMs && durationMs > 0) {
    let blackMs = 0;
    for (const m of out.matchAll(BLACK_RE)) {
      blackMs += (parseFloat(m[2]!) - parseFloat(m[1]!)) * 1000;
    }
    const ratio = blackMs / durationMs;
    const maxRatio = opts.maxBlackRatio ?? 0.4;
    if (ratio > maxRatio) {
      issues.push({
        check: 'black-frames',
        message: `${Math.round(ratio * 100)}% of the video is black frames (limit ${Math.round(maxRatio * 100)}%)`,
      });
    }
  }

  return { ok: issues.length === 0, issues, durationMs };
}

/** Validate an in-memory generated media buffer (pre-storage gate). */
export async function validateMediaBuffer(
  kind: MediaValidationKind,
  buffer: Buffer,
  ext: string,
  opts: ValidationOptions = {},
): Promise<ValidationResult> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-validate-'));
  const tmpFile = path.join(tmpDir, `media.${ext}`);
  try {
    await fsp.writeFile(tmpFile, buffer);
    return await validateMediaFile(kind, tmpFile, opts);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function formatIssues(result: ValidationResult): string {
  return result.issues.map((i) => `${i.check}: ${i.message}`).join('; ');
}
