import { z } from 'zod';

// ── Shorts Studio AI task schemas (ai.md Sections 4, 5) ──────────────────────

export const TopicCategorySchema = z.enum([
  'QUESTION_ANSWERED',
  'STORY',
  'TUTORIAL_STEP',
  'FUNNY_MOMENT',
  'IMPORTANT_STATEMENT',
  'HOOK',
  'PROBLEM',
  'SOLUTION',
  'STATISTIC',
  'TIP',
  'MISTAKE',
  'WARNING',
  'QUOTE',
  'OPINION',
  'LESSON',
  'SUCCESS_STORY',
  'FAILURE',
  'CALL_TO_ACTION',
]);
export type TopicCategory = z.infer<typeof TopicCategorySchema>;

export const TopicSegmentCandidateSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  category: TopicCategorySchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type TopicSegmentCandidate = z.infer<typeof TopicSegmentCandidateSchema>;

export const TopicSegmentationOutputSchema = z.object({
  segments: z.array(TopicSegmentCandidateSchema),
});
export type TopicSegmentationOutput = z.infer<typeof TopicSegmentationOutputSchema>;

// ── Chapter detection (Ai-video edit.md §5/§11, Phase 5) ─────────────────────
// Chapters partition the whole video; the model only proposes boundaries
// (startMs snapped to topic-segment starts) — endMs is derived server-side so
// chapters are contiguous by construction.

export const ChapterCandidateSchema = z.object({
  /** Must equal the startMs of one of the topic segments given in the prompt. */
  startMs: z.number().int().nonnegative(),
  title: z.string().min(1),
  summary: z.string().min(1),
  keyPoints: z.array(z.string()).max(5).default([]),
  confidence: z.number().min(0).max(1),
});
export type ChapterCandidate = z.infer<typeof ChapterCandidateSchema>;

export const ChapterDetectionOutputSchema = z.object({
  chapters: z.array(ChapterCandidateSchema),
});
export type ChapterDetectionOutput = z.infer<typeof ChapterDetectionOutputSchema>;

// ── Church AI pack (Ai-video edit.md §11, Phase 5) ───────────────────────────
// One batched call covers every chapter (§12.4); chapterIndex ties each entry
// back to the prompt's chapter list.

export const ChapterChurchPackSchema = z.object({
  /** Index into the chapter list given in the prompt. */
  chapterIndex: z.number().int().nonnegative(),
  /** Scripture explicitly cited or clearly alluded to in the chapter; [] if none. */
  bibleRefs: z.array(z.string()).max(10).default([]),
  /** Small-group discussion questions grounded in this chapter. */
  discussionQuestions: z.array(z.string()).min(1).max(5),
  /** Short (~100–150 word) devotional reflection on the chapter's message. */
  devotional: z.string().min(1),
});
export type ChapterChurchPack = z.infer<typeof ChapterChurchPackSchema>;

export const ChurchPackOutputSchema = z.object({
  chapters: z.array(ChapterChurchPackSchema),
});
export type ChurchPackOutput = z.infer<typeof ChurchPackOutputSchema>;

// ── Social content factory (Ai-video edit.md §10, Phase 5) ──────────────────
// One batched call produces every text artifact; quotes must be verbatim
// from the transcript excerpts given in the prompt.

export const SocialContentOutputSchema = z.object({
  quoteCards: z.array(z.object({
    /** Verbatim (or near-verbatim) quote from the provided transcript excerpts. */
    quote: z.string().min(1).max(300),
    /** Speaker/attribution if identifiable, else null. */
    attribution: z.string().nullable().default(null),
    /** Where in the video the quote is spoken (ms) — from the excerpt stamps. */
    startMs: z.number().int().nonnegative(),
  })).min(1).max(6),
  carousel: z.object({
    title: z.string().min(1),
    slides: z.array(z.object({
      heading: z.string().min(1).max(80),
      body: z.string().min(1).max(280),
    })).min(3).max(10),
  }),
  blogPost: z.object({
    title: z.string().min(1),
    markdown: z.string().min(1),
  }),
  newsletter: z.object({
    subject: z.string().min(1).max(100),
    markdown: z.string().min(1),
  }),
});
export type SocialContentOutput = z.infer<typeof SocialContentOutputSchema>;

/** The 9 score dimensions, 0–100 each (ai.md Section 5.1). */
export const HIGHLIGHT_DIMENSIONS = [
  'virality',
  'emotion',
  'retention',
  'hookStrength',
  'education',
  'entertainment',
  'confidence',
  'trendPotential',
  'shortSuitability',
] as const;
export type HighlightDimension = (typeof HIGHLIGHT_DIMENSIONS)[number];

const dim = z.number().min(0).max(100);

export const HighlightScoreSchema = z.object({
  /** Index into the batch of segments given in the prompt. */
  segmentIndex: z.number().int().nonnegative(),
  virality: dim,
  emotion: dim,
  retention: dim,
  hookStrength: dim,
  education: dim,
  entertainment: dim,
  confidence: dim,
  trendPotential: dim,
  shortSuitability: dim,
  /** Short natural-language explanation shown in the UI. */
  reason: z.string().min(1),
  /** Piggybacked here to avoid a separate LLM call (ai.md Section 22.2). */
  titleSuggestion: z.string().min(1),
  keywords: z.array(z.string()).max(10),
});
export type HighlightScore = z.infer<typeof HighlightScoreSchema>;

export const HighlightScoringOutputSchema = z.object({
  scores: z.array(HighlightScoreSchema),
});
export type HighlightScoringOutput = z.infer<typeof HighlightScoringOutputSchema>;

// ── Timeline commands (ai.md Section 8.3) ────────────────────────────────────
// Shared between the web editor (optimistic client apply + undo) and the API
// reducer (persistent apply + audit). CUT_RANGE is a macro command used by AI
// suggestions: it ripple-removes a time range without referencing item ids
// that only exist client- or server-side.

const ms = z.number().int().nonnegative();

export const TimelineCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TRIM'), itemId: z.string(), newStartMs: ms, newEndMs: ms }),
  z.object({ type: z.literal('SPLIT'), itemId: z.string(), atMs: ms }),
  z.object({ type: z.literal('DELETE'), itemId: z.string() }),
  z.object({ type: z.literal('MERGE'), itemIds: z.tuple([z.string(), z.string()]) }),
  z.object({ type: z.literal('DUPLICATE'), itemId: z.string() }),
  z.object({ type: z.literal('MOVE'), itemId: z.string(), toTrackId: z.string(), toStartMs: ms }),
  z.object({ type: z.literal('RESIZE'), itemId: z.string(), edge: z.enum(['start', 'end']), deltaMs: z.number().int() }),
  z.object({
    type: z.literal('CUT_RANGE'),
    startMs: ms,
    endMs: ms,
    /** Human-readable why (kept in the audit log for AI suggestions). */
    reason: z.string().optional(),
  }),
]);
export type TimelineCommand = z.infer<typeof TimelineCommandSchema>;

export const ApplyCommandsSchema = z.object({ commands: z.array(TimelineCommandSchema).min(1).max(200) });

/** AI editing assistant capabilities exposed as proposed diffs (ai.md 9.1/9.2). */
export const AssistCapabilitySchema = z.enum(['remove-silence', 'remove-fillers', 'improve-pacing']);
export type AssistCapability = z.infer<typeof AssistCapabilitySchema>;

export const PacingSuggestionOutputSchema = z.object({
  cuts: z.array(z.object({
    startMs: ms,
    endMs: ms,
    reason: z.string(),
  })),
});
export type PacingSuggestionOutput = z.infer<typeof PacingSuggestionOutputSchema>;

// ── Caption styling (ai.md Section 11.2) ─────────────────────────────────────

export const CaptionStylingOutputSchema = z.object({
  captions: z.array(z.object({
    /** Index into the caption list given in the prompt. */
    index: z.number().int().nonnegative(),
    /** Highlight this caption as a keyword moment. */
    emphasis: z.boolean(),
    /** Single emoji to append, or null. */
    emoji: z.string().nullable(),
  })),
});
export type CaptionStylingOutput = z.infer<typeof CaptionStylingOutputSchema>;
