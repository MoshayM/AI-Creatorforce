import { z } from 'zod';

// ── Copilot command contract (master prompt §8.2) ─────────────────────────────
// The LLM's function-calling output is validated against this schema before
// anything executes — the model never mutates state directly. Every command
// maps 1:1 onto an existing, ownership-checked service call.

export const CopilotCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_projects') }),
  z.object({ action: z.literal('get_status'), projectId: z.string() }),
  z.object({
    action: z.literal('run_production'),
    projectId: z.string(),
    scope: z.enum(['FULL', 'SCRIPT', 'VOICE', 'MUSIC', 'IMAGES', 'VIDEO']).default('FULL'),
    topic: z.string().optional(),
  }),
  z.object({
    action: z.literal('retry_stage'),
    projectId: z.string(),
    stage: z.string(), // JobType name; validated server-side against the enum
  }),
  z.object({ action: z.literal('cancel_job'), jobId: z.string() }),
  z.object({ action: z.literal('analyze_video'), importedVideoId: z.string() }),
  z.object({ action: z.literal('list_highlights'), importedVideoId: z.string(), limit: z.number().int().min(1).max(20).default(5) }),
  z.object({
    action: z.literal('generate_clips'),
    highlightId: z.string(),
    clipTypes: z.array(z.enum(['YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'TIKTOK', 'LINKEDIN_CLIPS', 'FACEBOOK_REELS', 'PODCAST_HIGHLIGHTS'])).default(['YOUTUBE_SHORTS']),
  }),
  z.object({ action: z.literal('render_clip'), shortClipId: z.string() }),
  z.object({ action: z.literal('generate_captions'), shortClipId: z.string() }),
  z.object({ action: z.literal('clip_status'), shortClipId: z.string() }),
]);
export type CopilotCommand = z.infer<typeof CopilotCommandSchema>;

/** Commands that spend real money or significant compute — require confirmation. */
export const EXPENSIVE_ACTIONS: ReadonlyArray<CopilotCommand['action']> = [
  'run_production',
  'analyze_video',
  'render_clip',
];

export const CopilotDecisionSchema = z.object({
  /** What the copilot says back — always present, plain language. */
  reply: z.string(),
  /** The single command to execute, or null for a pure conversational answer. */
  command: CopilotCommandSchema.nullable(),
});
export type CopilotDecision = z.infer<typeof CopilotDecisionSchema>;

export const CopilotMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});
export const CopilotChatRequestSchema = z.object({
  messages: z.array(CopilotMessageSchema).min(1).max(12),
  /** Set when the user confirmed a previously-proposed expensive command. */
  confirmedCommand: CopilotCommandSchema.optional(),
});
export type CopilotChatRequest = z.infer<typeof CopilotChatRequestSchema>;
