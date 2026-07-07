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
  // Deterministic-first (§12): the chapter list is stored data — zero tokens
  z.object({ action: z.literal('list_chapters'), importedVideoId: z.string() }),
  // NL search over stored embeddings — one tiny embedding call, no LLM re-analysis
  z.object({ action: z.literal('search_video'), importedVideoId: z.string(), query: z.string().min(1).max(200) }),
  z.object({
    action: z.literal('generate_clips'),
    highlightId: z.string(),
    clipTypes: z.array(z.enum(['YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'TIKTOK', 'LINKEDIN_CLIPS', 'FACEBOOK_REELS', 'PODCAST_HIGHLIGHTS'])).default(['YOUTUBE_SHORTS']),
  }),
  z.object({ action: z.literal('render_clip'), shortClipId: z.string() }),
  z.object({ action: z.literal('generate_captions'), shortClipId: z.string() }),
  z.object({ action: z.literal('clip_status'), shortClipId: z.string() }),
  // Human-approval management by chat/voice — approving is the human gate,
  // so approve goes through the confirmation step ("yes" spoken or tapped)
  z.object({ action: z.literal('list_approvals') }),
  z.object({ action: z.literal('approve_content'), approvalId: z.string(), notes: z.string().optional() }),
  z.object({ action: z.literal('reject_content'), approvalId: z.string(), notes: z.string().optional() }),
  // Voice/language preference: sets the project's content+voiceover language
  // to the user's speaking language — applying it to narration is permission-gated
  z.object({
    action: z.literal('set_voice_language'),
    projectId: z.string(),
    /** BCP-47 or ISO 639-1, e.g. "hi", "en-US" */
    language: z.string().min(2).max(12),
    applyToVoiceover: z.boolean().default(true),
  }),
]);
export type CopilotCommand = z.infer<typeof CopilotCommandSchema>;

/** Commands needing explicit confirmation: real money, significant compute, or a human gate. */
export const EXPENSIVE_ACTIONS: ReadonlyArray<CopilotCommand['action']> = [
  'run_production',
  'analyze_video',
  'render_clip',
  'approve_content',
  'set_voice_language',
];

export const CopilotDecisionSchema = z.object({
  /** What the copilot says back — always in the USER'S language. */
  reply: z.string(),
  /** BCP-47 tag of the language the user is speaking (drives TTS/STT). */
  language: z.string().default('en-US'),
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
  /** Set when the user confirmed a previously-proposed expensive command (button tap). */
  confirmedCommand: CopilotCommandSchema.optional(),
  /** A command awaiting confirmation — lets a spoken "yes" complete it. */
  pendingCommand: CopilotCommandSchema.optional(),
  /** How the user delivered this turn — drives the actions/voice_commands audit trail. */
  inputMode: z.enum(['text', 'voice']).default('text'),
});
export type CopilotChatRequest = z.infer<typeof CopilotChatRequestSchema>;
