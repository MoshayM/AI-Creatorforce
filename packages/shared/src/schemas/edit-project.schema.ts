import { z } from 'zod';

// ── EditProject / Multi-track Video Editor schemas ────────────────────────────
// These are the canonical timeline structures for the standalone video editor.
// Both API (EditorService) and web (timeline canvas) code against the same shape.

export const EditItemPropertiesSchema = z.object({
  volume: z.number().min(0).max(2).optional(),
  speed: z.number().min(0.1).max(10).optional(),
  opacity: z.number().min(0).max(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  scale: z.number().positive().optional(),
  text: z.string().optional(),
  fontSize: z.number().positive().optional(),
  color: z.string().optional(),
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
