import { z } from 'zod';

export const JobTypeSchema = z.enum([
  'RESEARCH',
  'SCRIPT',
  'FACT_CHECK',
  'COMPLIANCE',
  'METADATA',
  'THUMBNAIL',
  'TREND_ANALYSIS',
  'SEO_OPTIMIZATION',
  'AUDIENCE_ANALYSIS',
  'PUBLISH',
  'VOICE_SPEC',
  'VOICE_GENERATE',
  'IMAGE_BRIEF',
  'IMAGE_GENERATE',
  'MUSIC_BRIEF',
  'MUSIC_GENERATE',
  'VIDEO_SCENE_PLAN',
  'VIDEO_GENERATE',
  'SUBTITLE_GENERATE',
  'EDIT_PLAN',
  'RENDER',
  'FULL_PRODUCTION',
  'ANALYTICS',
  'GROWTH_REPORT',
  // Shorts Studio (ai.md spec, Section 15)
  'SHORTS_ANALYZE',
  'VIDEO_IMPORT',
  'TRANSCRIPT_ANALYSIS',
  'SCENE_DETECTION',
  'TOPIC_SEGMENTATION',
  'HIGHLIGHT_DETECTION',
  'SHORTS_GENERATION',
  'AUTO_EDIT',
  'CAPTION_GENERATION',
  'SHORTS_RENDER',
  'SHORTS_EXPORT',
  'SHORTS_PUBLISH',
  // Video Intelligence (Ai-video edit.md §5, Phase 5)
  'CHAPTER_DETECTION',
  'EMBEDDING_GENERATION',
  'CHURCH_PACK_GENERATION',
  'SOCIAL_CONTENT_GENERATION',
  // Channel library (docs4/08) — channel-scoped, no project
  'CHANNEL_SYNC',
  // Per-channel automation heartbeat (runs every 15 min via repeatable job)
  'AUTOMATION_TICK',
  // Standalone video editor (editor module)
  'EDIT_RENDER',
]);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JobStatusSchema = z.enum([
  'PENDING',
  'QUEUED',
  'RUNNING',
  'WAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const CreateJobSchema = z.object({
  projectId: z.string().cuid(),
  type: JobTypeSchema,
  payload: z.record(z.unknown()).optional().default({}),
});
export type CreateJob = z.infer<typeof CreateJobSchema>;

export const JobResultSchema = z.object({
  jobId: z.string().cuid(),
  status: JobStatusSchema,
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type JobResult = z.infer<typeof JobResultSchema>;

export const AutomationSettingsSchema = z.object({
  enabled: z.boolean(),
  autoImport: z.boolean(),
  autoAnalyze: z.boolean(),
  autoPublish: z.boolean(),
  chapterSyncEnabled: z.boolean(),
  /** Phase 6 M2: autonomous calendar top-up (planning only — never publishes). */
  autoPlan: z.boolean().default(false),
  /** Phase 6 M3: auto-enqueue RESEARCH job when a calendar entry is approved. */
  autoResearch: z.boolean().default(false),
  publishIntervalMinutes: z.number().int().min(15).max(1440),
  maxPublishesPerDay: z.number().int().min(1).max(10),
  maxImportsPerDay: z.number().int().min(1).max(10),
});
export type AutomationSettings = z.infer<typeof AutomationSettingsSchema>;
