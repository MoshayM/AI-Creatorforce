import { z } from 'zod';

export const VideoStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'FAILED',
]);
export type VideoStatus = z.infer<typeof VideoStatusSchema>;

export const CreateVideoSchema = z.object({
  projectId: z.string().cuid(),
  channelId: z.string().cuid(),
  title: z.string().min(1).max(100),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string()).max(500).optional(),
  scheduledAt: z.string().datetime().optional(),
});
export type CreateVideo = z.infer<typeof CreateVideoSchema>;

export const VideoResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  channelId: z.string(),
  youtubeVideoId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  thumbnailUrl: z.string().nullable(),
  status: VideoStatusSchema,
  scheduledAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type VideoResponse = z.infer<typeof VideoResponseSchema>;
