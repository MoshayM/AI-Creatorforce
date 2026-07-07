/**
 * YouTube chapter-block helpers (Ai-video edit.md §11: import existing
 * YouTube chapters, publish timestamps back). All pure.
 *
 * YouTube's rules for chapters to render on a video: at least 3 timestamps,
 * the first at 0:00, in ascending order, each chapter ≥10s. formatting
 * assumes chapters already satisfy them (normalizeChapters guarantees it);
 * parsing enforces them so junk timestamp lists never become chapters.
 */

export interface ChapterStamp {
  startMs: number;
  title: string;
}

/** "0:00" / "12:34" / "1:02:03" → ms; null when not a timestamp. */
function stampToMs(stamp: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(stamp);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2]!, 10);
  const s = parseInt(m[3]!, 10);
  if (min > 59 || s > 59) return null;
  return ((h * 60 + min) * 60 + s) * 1000;
}

function msToStamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${min}:${String(s).padStart(2, '0')}`;
}

/** A "timestamp line": optional bullet, a stamp, then the chapter title. */
const CHAPTER_LINE = /^\s*(?:[-•*]\s*)?((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:]?\s+(.+?)\s*$/;

/** One "0:00 Title" line per chapter, ready for a video description. */
export function formatChapterBlock(chapters: ChapterStamp[]): string {
  return chapters.map((c) => `${msToStamp(c.startMs)} ${c.title}`).join('\n');
}

/**
 * Extract the chapter list a YouTube description defines, or [] when the
 * description has none that YouTube would accept (min 3, first at 0:00,
 * strictly ascending).
 */
export function parseChapterBlock(description: string | null | undefined): ChapterStamp[] {
  if (!description) return [];
  const stamps: ChapterStamp[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = CHAPTER_LINE.exec(line);
    if (!m) continue;
    const startMs = stampToMs(m[1]!);
    if (startMs === null) continue;
    stamps.push({ startMs, title: m[2]! });
  }
  if (stamps.length < 3) return [];
  if (stamps[0]!.startMs !== 0) return [];
  for (let i = 1; i < stamps.length; i++) {
    if (stamps[i]!.startMs <= stamps[i - 1]!.startMs) return [];
  }
  return stamps;
}

/**
 * Replace the description's existing chapter list (the first run of ≥2
 * consecutive timestamp lines, plus an immediately preceding "Chapters"
 * header line) with the new block, or append the block when there is none.
 * The rest of the description is left untouched.
 */
export function upsertChapterBlock(description: string, block: string): string {
  const lines = description.split(/\r?\n/);

  let runStart = -1;
  let runEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (CHAPTER_LINE.test(lines[i]!)) {
      let j = i;
      while (j + 1 < lines.length && CHAPTER_LINE.test(lines[j + 1]!)) j++;
      if (j > i) {
        runStart = i;
        runEnd = j;
        break;
      }
      i = j;
    }
  }

  if (runStart === -1) {
    const base = description.trimEnd();
    return base.length > 0 ? `${base}\n\nChapters:\n${block}` : `Chapters:\n${block}`;
  }

  if (runStart > 0 && /^\s*chapters\s*:?\s*$/i.test(lines[runStart - 1]!)) runStart -= 1;
  return [...lines.slice(0, runStart), 'Chapters:', ...block.split('\n'), ...lines.slice(runEnd + 1)].join('\n');
}
