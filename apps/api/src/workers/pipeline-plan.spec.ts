import { planPipeline, partitionResume, batchStages, estimateRemainingSecs, OPTIONAL_SHORTS_STAGES } from './pipeline-plan';
import { SHORTS_IMPORT_STAGES } from '../modules/shorts-studio/shorts-studio.service';

describe('planPipeline', () => {
  it('FULL scope runs the complete production chain ending in a package', () => {
    const types = planPipeline('FULL').map((s) => s.type);
    expect(types[0]).toBe('RESEARCH');
    expect(types).toContain('VOICE_GENERATE');
    expect(types).toContain('IMAGE_GENERATE');
    expect(types).toContain('MUSIC_GENERATE');
    expect(types).toContain('VIDEO_GENERATE');
    expect(types).toContain('RENDER');
    expect(types[types.length - 1]).toBe('PACKAGE');
  });

  it('SCRIPT scope runs only the content foundation ending at the compliance gate', () => {
    const types = planPipeline('SCRIPT').map((s) => s.type);
    expect(types).toEqual(['RESEARCH', 'SCRIPT', 'FACT_CHECK', 'COMPLIANCE']);
  });

  it('every scope passes through the compliance gate before any media generation', () => {
    for (const scope of ['FULL', 'SCRIPT', 'VOICE', 'MUSIC', 'IMAGES', 'VIDEO'] as const) {
      const stages = planPipeline(scope);
      const gateIdx = stages.findIndex((s) => s.type === 'COMPLIANCE');
      expect(gateIdx).toBeGreaterThanOrEqual(0);
      expect(stages[gateIdx]?.gate).toBe(true);
      const firstGenerate = stages.findIndex((s) => String(s.type).endsWith('_GENERATE'));
      if (firstGenerate !== -1) expect(gateIdx).toBeLessThan(firstGenerate);
    }
  });

  it('no scope includes PUBLISH — publishing stays human-approved', () => {
    for (const scope of ['FULL', 'SCRIPT', 'VOICE', 'MUSIC', 'IMAGES', 'VIDEO'] as const) {
      expect(planPipeline(scope).map((s) => s.type)).not.toContain('PUBLISH');
    }
  });

  it('scoped runs only generate their own media kind', () => {
    const voice = planPipeline('VOICE').map((s) => s.type);
    expect(voice).toContain('VOICE_GENERATE');
    expect(voice).not.toContain('IMAGE_GENERATE');
    expect(voice).not.toContain('RENDER');
  });

  it('VIDEO scope includes SUBTITLE_GENERATE and THUMBNAIL before PACKAGE', () => {
    const video = planPipeline('VIDEO').map((s) => s.type);
    expect(video).toContain('SUBTITLE_GENERATE');
    expect(video).toContain('THUMBNAIL');
    const subtitleIdx = video.indexOf('SUBTITLE_GENERATE');
    const thumbnailIdx = video.indexOf('THUMBNAIL');
    const packageIdx = video.indexOf('PACKAGE');
    const videoGenIdx = video.indexOf('VIDEO_GENERATE');
    // SUBTITLE_GENERATE and THUMBNAIL appear after VIDEO_GENERATE, before PACKAGE
    expect(subtitleIdx).toBeGreaterThan(videoGenIdx);
    expect(thumbnailIdx).toBeGreaterThan(videoGenIdx);
    expect(subtitleIdx).toBeLessThan(packageIdx);
    expect(thumbnailIdx).toBeLessThan(packageIdx);
    // Final order: ...VIDEO_GENERATE, SUBTITLE_GENERATE, THUMBNAIL, PACKAGE
    expect(video[video.length - 1]).toBe('PACKAGE');
  });
});

describe('partitionResume', () => {
  it('skips stages whose job type already completed', () => {
    const stages = planPipeline('FULL');
    const { run, skipped } = partitionResume(stages, new Set(['RESEARCH', 'SCRIPT']), false);
    expect(skipped.map((s) => s.type)).toEqual(['RESEARCH', 'SCRIPT']);
    expect(run.map((s) => s.type)).not.toContain('RESEARCH');
  });

  it('never skips the PACKAGE stage', () => {
    const stages = planPipeline('VOICE');
    const all = new Set(stages.map((s) => s.type as string));
    const { run } = partitionResume(stages, all, false);
    expect(run.map((s) => s.type)).toEqual(['PACKAGE']);
  });

  it('forceTypes re-runs listed stages even when previously completed', () => {
    const stages = planPipeline('FULL');
    const all = new Set(stages.map((s) => s.type as string));
    const { run } = partitionResume(stages, all, false, new Set(['VOICE_GENERATE', 'RENDER']));
    expect(run.map((s) => s.type)).toEqual(['VOICE_GENERATE', 'RENDER', 'PACKAGE']);
  });

  it('force re-runs everything', () => {
    const stages = planPipeline('MUSIC');
    const { run, skipped } = partitionResume(stages, new Set(stages.map((s) => s.type as string)), true);
    expect(skipped).toHaveLength(0);
    expect(run).toHaveLength(stages.length);
  });
});

describe('batchStages', () => {
  it('groups consecutive stages sharing a parallelGroup', () => {
    const batches = batchStages(planPipeline('FULL'));
    const specBatch = batches.find((b) => b.some((s) => s.type === 'VOICE_SPEC'));
    expect(specBatch?.map((s) => s.type)).toEqual(['VOICE_SPEC', 'IMAGE_BRIEF', 'MUSIC_BRIEF', 'SUBTITLE_GENERATE']);
    const genBatch = batches.find((b) => b.some((s) => s.type === 'VOICE_GENERATE'));
    expect(genBatch?.map((s) => s.type)).toEqual(['VOICE_GENERATE', 'IMAGE_GENERATE', 'MUSIC_GENERATE']);
  });

  it('keeps sequential stages as single-stage batches', () => {
    const batches = batchStages(planPipeline('VOICE'));
    for (const batch of batches) expect(batch).toHaveLength(1);
  });
});

describe('OPTIONAL_SHORTS_STAGES — embedding failure must not block Shorts (readiness item 8)', () => {
  it('marks EMBEDDING_GENERATION optional so a quota-exhausted provider degrades search instead of failing analysis', () => {
    expect(OPTIONAL_SHORTS_STAGES.has('EMBEDDING_GENERATION')).toBe(true);
  });

  it('every other analysis stage stays mandatory', () => {
    for (const stage of SHORTS_IMPORT_STAGES) {
      if (stage === 'EMBEDDING_GENERATION') continue;
      expect(OPTIONAL_SHORTS_STAGES.has(stage)).toBe(false);
    }
  });

  it('the optional stage runs last, so it can never starve a mandatory stage', () => {
    expect(SHORTS_IMPORT_STAGES[SHORTS_IMPORT_STAGES.length - 1]).toBe('EMBEDDING_GENERATION');
  });
});

describe('estimateRemainingSecs', () => {
  it('prefers historical averages and falls back to defaults', () => {
    const stages = planPipeline('MUSIC');
    const noHistory = estimateRemainingSecs(stages, new Map());
    expect(noHistory).toBe(stages.reduce((s, st) => s + st.defaultSecs, 0));
    const withHistory = estimateRemainingSecs(stages, new Map([['RESEARCH', 100]]));
    expect(withHistory).toBe(noHistory - (stages.find((s) => s.type === 'RESEARCH')?.defaultSecs ?? 0) + 100);
  });
});
