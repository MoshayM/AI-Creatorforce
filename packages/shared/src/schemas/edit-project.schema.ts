import { z } from 'zod';

// ── EditProject / Multi-track Video Editor schemas ────────────────────────────
// These are the canonical timeline structures for the standalone video editor.
// Both API (EditorService) and web (timeline canvas) code against the same shape.

// Phase 2: new optional properties — all back-compatible, Phase-1 timelines
// validate unchanged. Features: per-item video filters, clip transitions,
// text animations, and keyframe animation (opacity/scale/position).

export const EditItemFiltersSchema = z.object({
  brightness: z.number().min(-1).max(1).optional(),
  contrast: z.number().min(0).max(2).optional(),
  saturation: z.number().min(0).max(3).optional(),
  grayscale: z.boolean().optional(),
  blur: z.number().min(0).max(20).optional(),
});
export type EditItemFilters = z.infer<typeof EditItemFiltersSchema>;

export const EditTransitionInSchema = z.object({
  type: z.enum(['fade', 'dissolve', 'slide']),
  durationMs: z.number().int().positive(),
});
export type EditTransitionIn = z.infer<typeof EditTransitionInSchema>;

export const EditKeyframeSchema = z.object({
  atMs: z.number().int().nonnegative(),
  opacity: z.number().min(0).max(1).optional(),
  scale: z.number().positive().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});
export type EditKeyframe = z.infer<typeof EditKeyframeSchema>;

export const EditItemPropertiesSchema = z.object({
  // Phase 1
  volume: z.number().min(0).max(2).optional(),
  speed: z.number().min(0.1).max(10).optional(),
  opacity: z.number().min(0).max(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().positive().optional(),
  text: z.string().optional(),
  fontSize: z.number().positive().optional(),
  color: z.string().optional(),
  // Phase 2 — all optional, back-compatible
  filters: EditItemFiltersSchema.optional(),
  transitionIn: EditTransitionInSchema.optional(),
  textAnim: z.enum(['none', 'fade-in', 'slide-up']).optional(),
  keyframes: z.array(EditKeyframeSchema).optional(),
  // Phase 3 — audio mixing controls (all optional, back-compatible)
  /** Fade-in duration in ms at the start of this clip's audio. */
  fadeInMs: z.number().int().min(0).optional(),
  /** Fade-out duration in ms at the end of this clip's audio. */
  fadeOutMs: z.number().int().min(0).optional(),
  /** Per-item audio gain in dB (-60 to +12). Applied multiplicatively with volume. */
  gainDb: z.number().min(-60).max(12).optional(),
  /**
   * When true (on MUSIC/AUDIO items), this source is treated as a background
   * that should be lowered when other non-ducked audio overlaps.
   * Implemented as a constant -9 dB reduction (×0.354 linear).
   * sidechaincompress is not used — fragile across ffmpeg-static builds.
   */
  duckUnderVoice: z.boolean().optional(),
});
export type EditItemProperties = z.infer<typeof EditItemPropertiesSchema>;

export const EditItemSchema = z.object({
  id: z.string(),
  sourceAssetId: z.string().optional(),
  kind: z.enum(['VIDEO', 'IMAGE', 'AUDIO', 'TEXT']),
  /** Position on the master timeline (ms). */
  timelineStartMs: z.number().int().nonnegative(),
  timelineEndMs: z.number().int().positive(),
  /** Trim within the source media (VIDEO/AUDIO only). */
  sourceInMs: z.number().int().nonnegative().optional(),
  sourceOutMs: z.number().int().positive().optional(),
  properties: EditItemPropertiesSchema.optional(),
});
export type EditItem = z.infer<typeof EditItemSchema>;

export const EditTrackSchema = z.object({
  id: z.string(),
  kind: z.enum(['VIDEO', 'AUDIO', 'TEXT']),
  label: z.string(),
  items: z.array(EditItemSchema),
});
export type EditTrack = z.infer<typeof EditTrackSchema>;

export const EditTimelineSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
  tracks: z.array(EditTrackSchema),
});
export type EditTimeline = z.infer<typeof EditTimelineSchema>;

/**
 * Render output presets for the standalone editor.
 * SOURCE keeps the EditProject's stored width/height unchanged.
 */
export const EditRenderPresetSchema = z.enum([
  '1080P_16_9',
  '1080P_9_16',
  '720P_16_9',
  '1080P_1_1',
  'SOURCE',
]);
export type EditRenderPreset = z.infer<typeof EditRenderPresetSchema>;

/** Maps a preset to concrete pixel dimensions. SOURCE returns null (caller uses project dims). */
export const EDIT_PRESET_DIMS: Record<Exclude<EditRenderPreset, 'SOURCE'>, { width: number; height: number }> = {
  '1080P_16_9': { width: 1920, height: 1080 },
  '1080P_9_16': { width: 1080, height: 1920 },
  '720P_16_9':  { width: 1280, height: 720 },
  '1080P_1_1':  { width: 1080, height: 1080 },
};

/**
 * Advanced export options for Phase 3.
 * Callers may pass either a bare EditRenderPreset string (back-compat)
 * or an EditExportOptions object with format/quality overrides.
 *
 * format: 'mp4' (libx264+aac, default) | 'webm' (libvpx-vp9+libopus).
 * quality: 'draft' (fast/high-CRF) | 'standard' (balanced, default) | 'high' (slow/low-CRF).
 */
export const EditExportOptionsSchema = z.object({
  preset: EditRenderPresetSchema,
  format: z.enum(['mp4', 'webm']).default('mp4'),
  quality: z.enum(['draft', 'standard', 'high']).default('standard'),
});
export type EditExportOptions = z.infer<typeof EditExportOptionsSchema>;
