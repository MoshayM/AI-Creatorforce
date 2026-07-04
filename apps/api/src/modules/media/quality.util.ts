/**
 * Quality analysis utilities for the render pipeline.
 *
 * All functions are pure (no side-effects, no throws on bad input) so they can
 * be called before the expensive composeVideo step without risking the render.
 * Findings are advisory — callers decide whether to block or just log.
 */

export interface QualityFinding {
  level: 'ok' | 'warn' | 'fixed';
  check: string;
  message: string;
}

export interface CheckDurationsOpts {
  totalSceneSecs: number;
  /** Voice asset duration in milliseconds (undefined = no voice asset). */
  voiceDurationMs?: number;
  /** Script estimated duration in minutes (from ScriptOutput.estimatedDurationMins). */
  scriptEstimateMins?: number;
  /** Last subtitle cue end time in milliseconds (undefined = no subtitles). */
  lastCueEndMs?: number;
}

/**
 * Run pure duration / timing sanity checks.
 * Never throws — returns an array of findings (always at least one entry).
 */
export function checkDurations(opts: CheckDurationsOpts): QualityFinding[] {
  const { totalSceneSecs, voiceDurationMs, scriptEstimateMins, lastCueEndMs } = opts;
  const findings: QualityFinding[] = [];

  // Check 1: minimum total scene length
  if (totalSceneSecs < 10) {
    findings.push({ level: 'warn', check: 'min-duration', message: `Total scene duration is only ${totalSceneSecs.toFixed(1)}s — video may be too short.` });
  } else {
    findings.push({ level: 'ok', check: 'min-duration', message: `Total scene duration ${totalSceneSecs.toFixed(1)}s is acceptable.` });
  }

  // Check 2: voice presence
  if (voiceDurationMs === undefined || voiceDurationMs <= 0) {
    findings.push({ level: 'warn', check: 'voice-present', message: 'No voice audio asset — video will render silent.' });
  } else {
    findings.push({ level: 'ok', check: 'voice-present', message: `Voice audio present (${(voiceDurationMs / 1000).toFixed(1)}s).` });
  }

  // Check 3: voice vs script estimate mismatch (only when both are available)
  if (voiceDurationMs !== undefined && voiceDurationMs > 0 && scriptEstimateMins !== undefined && scriptEstimateMins > 0) {
    const scriptEstimateMs = scriptEstimateMins * 60 * 1000;
    const ratio = Math.abs(voiceDurationMs - scriptEstimateMs) / scriptEstimateMs;
    if (ratio > 0.6) {
      findings.push({
        level: 'warn',
        check: 'voice-script-mismatch',
        message: `Voice duration (${(voiceDurationMs / 1000).toFixed(1)}s) deviates ${Math.round(ratio * 100)}% from script estimate (${(scriptEstimateMs / 1000).toFixed(1)}s) — possible TTS or script issue.`,
      });
    } else {
      findings.push({ level: 'ok', check: 'voice-script-mismatch', message: `Voice duration within expected range of script estimate.` });
    }
  }

  // Check 4: subtitle cue overrun (last cue must end within scenes + 5s grace)
  if (lastCueEndMs !== undefined) {
    const limitMs = totalSceneSecs * 1000 + 5000;
    if (lastCueEndMs > limitMs) {
      findings.push({
        level: 'warn',
        check: 'subtitle-overrun',
        message: `Last subtitle cue ends at ${(lastCueEndMs / 1000).toFixed(1)}s, which is beyond total scene length (${totalSceneSecs.toFixed(1)}s + 5s grace). Some captions may not display.`,
      });
    } else {
      findings.push({ level: 'ok', check: 'subtitle-overrun', message: 'Subtitle cues fit within scene timeline.' });
    }
  }

  return findings;
}

export interface LoudnessResult {
  findings: QualityFinding[];
  /** Adjusted music volume multiplier if music was too loud; undefined if no adjustment needed. */
  musicVolumeAdjust?: number;
}

/**
 * Run ffmpeg volumedetect on voice and/or music files to check loudness
 * balance. When music mean > voice mean − 6 dB, computes a reduced music
 * volume multiplier so music sits ≈8 dB under voice at the 0.22 base level.
 *
 * @param ffmpegRun  Thin wrapper around runFfmpegCapture — receives the args
 *   array (without the leading -y/-hide_banner which the caller may prepend)
 *   and resolves with the combined stdout+stderr string.
 */
export async function analyzeLoudness(
  ffmpegRun: (args: string[]) => Promise<string>,
  voicePath?: string,
  musicPath?: string,
): Promise<LoudnessResult> {
  const findings: QualityFinding[] = [];
  let musicVolumeAdjust: number | undefined;

  if (!voicePath && !musicPath) {
    return { findings };
  }

  // Helper: run volumedetect on a single file and parse mean_volume
  const detectMean = async (filePath: string, label: string): Promise<number | null> => {
    try {
      const output = await ffmpegRun(['-i', filePath, '-af', 'volumedetect', '-f', 'null', '-']);
      // volumedetect prints:  mean_volume: -18.3 dB
      const match = /mean_volume:\s*([-\d.]+)\s*dB/i.exec(output);
      if (!match) {
        findings.push({ level: 'warn', check: `loudness-${label}`, message: `Could not parse volumedetect output for ${label}.` });
        return null;
      }
      return parseFloat(match[1]!);
    } catch {
      findings.push({ level: 'warn', check: `loudness-${label}`, message: `volumedetect failed for ${label} — skipping loudness check.` });
      return null;
    }
  };

  const voiceMean = voicePath ? await detectMean(voicePath, 'voice') : null;
  const musicMean = musicPath ? await detectMean(musicPath, 'music') : null;

  if (voiceMean !== null && musicMean !== null) {
    // Target: music sits ≈8 dB under voice. Warn threshold: music mean > voice mean − 6 dB.
    const targetDb = voiceMean - 8;
    if (musicMean > voiceMean - 6) {
      // Compute volume multiplier: adjust = 0.22 * 10^((targetDb − musicMean) / 20)
      const rawAdjust = 0.22 * Math.pow(10, (targetDb - musicMean) / 20);
      musicVolumeAdjust = Math.max(0.05, Math.min(0.22, rawAdjust));
      findings.push({
        level: 'fixed',
        check: 'loudness-balance',
        message: `Music (${musicMean.toFixed(1)} dBFS) too loud vs voice (${voiceMean.toFixed(1)} dBFS). Auto-adjusted music volume to ${musicVolumeAdjust.toFixed(3)} (target ≈${targetDb.toFixed(1)} dBFS).`,
      });
    } else {
      findings.push({ level: 'ok', check: 'loudness-balance', message: `Music/voice loudness balance is acceptable (voice ${voiceMean.toFixed(1)} dBFS, music ${musicMean.toFixed(1)} dBFS).` });
    }
  } else if (voiceMean !== null) {
    findings.push({ level: 'ok', check: 'loudness-voice', message: `Voice mean loudness: ${voiceMean.toFixed(1)} dBFS.` });
  } else if (musicMean !== null) {
    findings.push({ level: 'ok', check: 'loudness-music', message: `Music mean loudness: ${musicMean.toFixed(1)} dBFS (no voice to compare).` });
  }

  return { findings, musicVolumeAdjust };
}
