import { z } from 'zod';

export const ConnectChannelSchema = z.object({
  code: z.string(),
  redirectUri: z.string().url(),
});

export const ChannelResponseSchema = z.object({
  id: z.string(),
  youtubeChannelId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  subscriberCount: z.number(),
  videoCount: z.number(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ChannelResponse = z.infer<typeof ChannelResponseSchema>;
