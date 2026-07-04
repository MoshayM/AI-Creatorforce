import type { JobType } from '@cf/shared';

export type PipelineScope = 'FULL' | 'SCRIPT' | 'VOICE' | 'MUSIC' | 'IMAGES' | 'VIDEO';

export interface PipelineStage {
  type: JobType | 'PACKAGE';
  label: string;
  /** Stages sharing a group run concurrently (update.txt: "Parallel execution wherever possible"). */
  parallelGroup?: number;
  /** Hard gate: pipeline stops if this stage's result fails (claude.md golden rule 1). */
  gate?: boolean;
  /** Rough fallback duration for ETA before history exists. */
  defaultSecs: number;
}

const S = (
  type: PipelineStage['type'],
  label: string,
  defaultSecs: number,
  extra: Partial<PipelineStage> = {},
): PipelineStage => ({ type, label, defaultSecs, ...extra });

// Content foundation shared by every scope — compliance is always in the path;
// no scope may generate media from an un-audited script.
const FOUNDATION: PipelineStage[] = [
  S('RESEARCH', 'Research', 40),
  S('SCRIPT', 'Script', 45),
  S('FACT_CHECK', 'Fact Check', 40),
  S('COMPLIANCE', 'Compliance Audit', 35, { gate: true }),
];

const SEO_STAGE = S('METADATA', 'SEO & Metadata', 50);

const SCOPE_STAGES: Record<PipelineScope, PipelineStage[]> = {
  FULL: [
    ...FOUNDATION,
    SEO_STAGE,
    S('VIDEO_SCENE_PLAN', 'Storyboard', 40),
    // Specs/briefs in parallel…
    S('VOICE_SPEC', 'Voice Direction', 35, { parallelGroup: 1 }),
    S('IMAGE_BRIEF', 'Image Briefs', 35, { parallelGroup: 1 }),
    S('MUSIC_BRIEF', 'Music Brief', 30, { parallelGroup: 1 }),
    S('SUBTITLE_GENERATE', 'Subtitles', 45, { parallelGroup: 1 }),
    // …then asset generation in parallel
    S('VOICE_GENERATE', 'Voice Over', 30, { parallelGroup: 2 }),
    S('IMAGE_GENERATE', 'Scene Images', 40, { parallelGroup: 2 }),
    S('MUSIC_GENERATE', 'Background Music', 20, { parallelGroup: 2 }),
    S('VIDEO_GENERATE', 'Scene Videos', 60),
    S('THUMBNAIL', 'Thumbnail', 10),
    S('EDIT_PLAN', 'Timeline Assembly', 45),
    S('RENDER', 'Rendering', 90),
    S('PACKAGE', 'Upload-Ready Package', 5),
  ],
  SCRIPT: [...FOUNDATION],
  VOICE: [...FOUNDATION, S('VOICE_SPEC', 'Voice Direction', 35), S('VOICE_GENERATE', 'Voice Over', 30), S('PACKAGE', 'Package', 5)],
  MUSIC: [...FOUNDATION, S('MUSIC_BRIEF', 'Music Brief', 30), S('MUSIC_GENERATE', 'Background Music', 20), S('PACKAGE', 'Package', 5)],
  IMAGES: [...FOUNDATION, S('IMAGE_BRIEF', 'Image Briefs', 35), S('IMAGE_GENERATE', 'Scene Images', 40), S('PACKAGE', 'Package', 5)],
  VIDEO: [
    ...FOUNDATION,
    S('VIDEO_SCENE_PLAN', 'Storyboard', 40),
    S('IMAGE_BRIEF', 'Image Briefs', 35),
    S('IMAGE_GENERATE', 'Scene Images', 40),
    S('VIDEO_GENERATE', 'Scene Videos', 60),
    S('SUBTITLE_GENERATE', 'Subtitles', 45),
    S('THUMBNAIL', 'Thumbnail', 10),
    S('PACKAGE', 'Package', 5),
  ],
};

export function planPipeline(scope: PipelineScope): PipelineStage[] {
  return SCOPE_STAGES[scope] ?? SCOPE_STAGES.FULL;
}

/**
 * Resume support (update.txt: "Support resume … Never regenerate completed
 * assets"): stages whose job type already COMPLETED for this project are
 * skipped unless force is set. Gates are never skipped — a resumed pipeline
 * still re-checks compliance state via the recorded result.
 */
export function partitionResume(
  stages: PipelineStage[],
  completedTypes: ReadonlySet<string>,
  force: boolean,
  forceTypes: ReadonlySet<string> = new Set(),
): { run: PipelineStage[]; skipped: PipelineStage[] } {
  if (force) return { run: [...stages], skipped: [] };
  const run: PipelineStage[] = [];
  const skipped: PipelineStage[] = [];
  for (const stage of stages) {
    const cached = stage.type !== 'PACKAGE' && completedTypes.has(stage.type);
    if (cached && !forceTypes.has(stage.type)) skipped.push(stage);
    else run.push(stage);
  }
  return { run, skipped };
}

/** Group consecutive stages that share a parallelGroup into concurrent batches. */
export function batchStages(stages: PipelineStage[]): PipelineStage[][] {
  const batches: PipelineStage[][] = [];
  for (const stage of stages) {
    const prev = batches[batches.length - 1];
    if (
      prev &&
      stage.parallelGroup !== undefined &&
      prev[0]?.parallelGroup === stage.parallelGroup
    ) {
      prev.push(stage);
    } else {
      batches.push([stage]);
    }
  }
  return batches;
}

export function estimateRemainingSecs(
  remaining: PipelineStage[],
  historicalAvgSecs: ReadonlyMap<string, number>,
): number {
  return Math.round(
    remaining.reduce((sum, s) => sum + (historicalAvgSecs.get(s.type) ?? s.defaultSecs), 0),
  );
}
