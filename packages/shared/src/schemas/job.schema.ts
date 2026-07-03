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
