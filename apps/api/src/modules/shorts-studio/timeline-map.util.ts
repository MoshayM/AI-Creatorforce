import type { ShortsTimelineItem } from '@prisma/client';

export interface VideoSpan {
  timelineStartMs: number;
  timelineEndMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
}

/** Extract source-mapped video spans from timeline items (speed-1 mapping). */
export function videoSpans(items: ShortsTimelineItem[]): VideoSpan[] {
  return items
    .map((item) => {
      const props = (item.properties ?? {}) as { sourceStartMs?: number; sourceEndMs?: number };
      if (typeof props.sourceStartMs !== 'number') return null;
      return {
        timelineStartMs: item.startMs,
        timelineEndMs: item.endMs,
        sourceStartMs: props.sourceStartMs,
        sourceEndMs: props.sourceStartMs + (item.endMs - item.startMs),
      };
    })
    .filter((s): s is VideoSpan => s !== null)
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs);
}

/**
 * Map a source-time range onto timeline-time ranges through the current spans.
 * A source range can surface in multiple places (duplicated items) or nowhere
 * (already cut) — callers get every visible occurrence.
 */
export function sourceRangeToTimeline(
  spans: VideoSpan[],
  srcStartMs: number,
  srcEndMs: number,
): Array<{ startMs: number; endMs: number }> {
  const out: Array<{ startMs: number; endMs: number }> = [];
  for (const span of spans) {
    const s = Math.max(srcStartMs, span.sourceStartMs);
    const e = Math.min(srcEndMs, span.sourceEndMs);
    if (e <= s) continue;
    out.push({
      startMs: span.timelineStartMs + (s - span.sourceStartMs),
      endMs: span.timelineStartMs + (e - span.sourceStartMs),
    });
  }
  return out;
}
