export interface CueLike {
  index?: number;
  startMs: number;
  endMs: number;
  text: string;
}

function timestamp(ms: number, msSeparator: ',' | '.'): string {
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0');
  const frac = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s}${msSeparator}${frac}`;
}

/**
 * Deterministic SRT/VTT serialization from cue data
 * (docs1/media-pipeline.md §7: subtitles derive from structured cues —
 * mechanical formats are never delegated to an LLM).
 */
export function buildSrt(cues: CueLike[]): string {
  return cues
    .map((c, i) => `${c.index ?? i + 1}\n${timestamp(c.startMs, ',')} --> ${timestamp(c.endMs, ',')}\n${c.text}`)
    .join('\n\n') + '\n';
}

export function buildVtt(cues: CueLike[]): string {
  return 'WEBVTT\n\n' + cues
    .map((c) => `${timestamp(c.startMs, '.')} --> ${timestamp(c.endMs, '.')}\n${c.text}`)
    .join('\n\n') + '\n';
}
