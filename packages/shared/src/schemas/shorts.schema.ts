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
