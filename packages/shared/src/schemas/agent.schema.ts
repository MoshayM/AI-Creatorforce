import { z } from 'zod';

export const ResearchOutputSchema = z.object({
  topic: z.string(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sources: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      snippet: z.string(),
      publishedAt: z.string().optional(),
    }),
  ),
  trendScore: z.number().min(0).max(100),
  audienceInterestSignals: z.array(z.string()),
});
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

export const ScriptOutputSchema = z.object({
  title: z.string(),
  hook: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      content: z.string(),
      durationEstimateSecs: z.number(),
    }),
  ),
  callToAction: z.string(),
  totalWordCount: z.number(),
  estimatedDurationMins: z.number(),
  sources: z.array(z.string()),
});
export type ScriptOutput = z.infer<typeof ScriptOutputSchema>;

export const FactCheckOutputSchema = z.object({
  overallVerdict: z.string(),
  accuracyScore: z.number().min(0).max(100),
  summary: z.string(),
  claims: z.array(
    z.object({
      claim: z.string(),
      status: z.string(),
      confidence: z.number().min(0).max(1),
      evidence: z.string().optional(),
      source: z.string().optional(),
      sourceUrl: z.string().optional(),
      notes: z.string().optional(),
    }),
  ),
  issues: z.array(z.string()),
  recommendations: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});
export type FactCheckOutput = z.infer<typeof FactCheckOutputSchema>;

export const MetadataOutputSchema = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  category: z.string(),
  language: z.string(),
  thumbnailPrompt: z.string(),
});
export type MetadataOutput = z.infer<typeof MetadataOutputSchema>;

export const TrendOutputSchema = z.object({
  trending: z.array(
    z.object({
      topic: z.string(),
      score: z.number().min(0).max(100),
      relatedKeywords: z.array(z.string()),
      peakTime: z.string().optional(),
    }),
  ),
  recommendations: z.array(z.string()),
  analysisDate: z.string(),
});
export type TrendOutput = z.infer<typeof TrendOutputSchema>;

export const SEOOutputSchema = z.object({
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  searchVolume: z.number().optional(),
  competition: z.string().optional(),
  optimizedTitle: z.string(),
  optimizedDescription: z.string(),
  recommendedTags: z.array(z.string()),
});
export type SEOOutput = z.infer<typeof SEOOutputSchema>;

export const AudienceOutputSchema = z.object({
  primaryDemographic: z.string(),
  ageRange: z.string(),
  interests: z.array(z.string()),
  peakEngagementTimes: z.array(z.string()),
  contentPreferences: z.array(z.string()),
  recommendations: z.array(z.string()),
});
export type AudienceOutput = z.infer<typeof AudienceOutputSchema>;

// ── Beta: Media Pipeline Agents ────────────────────────────────────────────────

export const VoiceSpecSchema = z.object({
  sectionId: z.string(),
  heading: z.string(),
  ssmlMarkup: z.string(),
  voiceId: z.string().optional(),
  provider: z.string().default('elevenlabs'),
  speed: z.number().min(0.5).max(2.0).default(1.0),
  stability: z.number().min(0).max(1).default(0.75),
  // AI sometimes returns objects like {word, phonetic} — coerce to string
  pronunciationNotes: z.array(
    z.union([z.string(), z.record(z.unknown()).transform(v => (v['word'] ? String(v['word']) : JSON.stringify(v)))])
  ).default([]),
});
export type VoiceSpec = z.infer<typeof VoiceSpecSchema>;

export const VoiceSpecOutputSchema = z.object({
  projectId: z.string().optional(),
  voiceProfile: z.object({
    name: z.string(),
    style: z.string(),
    tone: z.string(),
    pace: z.string(),
  }),
  sections: z.array(VoiceSpecSchema),
  estimatedDurationMins: z.number().optional().default(10),
  disclosureRequired: z.boolean().default(false),
  notes: z.string().optional(),
});
export type VoiceSpecOutput = z.infer<typeof VoiceSpecOutputSchema>;

export const ImageBriefSchema = z.object({
  sceneId: z.string(),
  sectionHeading: z.string(),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  style: z.string(),
  aspectRatio: z.string().default('16:9'),
  count: z.number().int().min(1).max(4).default(2),
  purpose: z.enum(['b-roll', 'background', 'diagram', 'thumbnail-candidate']),
});
export type ImageBrief = z.infer<typeof ImageBriefSchema>;

export const ImageBriefOutputSchema = z.object({
  projectId: z.string().optional(),
  briefs: z.array(ImageBriefSchema),
  brandStyle: z.object({
    colorPalette: z.array(z.string()),
    fontStyle: z.string(),
    visualMood: z.string(),
  }).optional(),
  notes: z.string().optional(),
});
export type ImageBriefOutput = z.infer<typeof ImageBriefOutputSchema>;

export const MusicBriefOutputSchema = z.object({
  mood: z.string(),
  genre: z.string(),
  bpm: z.number().int().min(60).max(200),
  instruments: z.array(z.string()),
  energy: z.enum(['low', 'medium', 'high', 'dynamic']),
  durationSecs: z.number(),
  // AI sometimes returns array or object — coerce to string
  structure: z.any().transform(v => Array.isArray(v) ? (v as unknown[]).map(i => typeof i === 'string' ? i : JSON.stringify(i)).join(' → ') : typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')),
  prompt: z.string(),
  provider: z.string().default('suno'),
  notes: z.string().optional(),
});
export type MusicBriefOutput = z.infer<typeof MusicBriefOutputSchema>;

export const SceneSchema = z.object({
  id: z.string().optional().default(''),
  sectionRef: z.string().optional().default(''),
  title: z.string(),
  description: z.string(),
  durationSecs: z.number(),
  shotType: z.string(),
  videoPrompt: z.string(),
  negativePrompt: z.string().optional(),
  transition: z.string().default('cut'),
});
export type Scene = z.infer<typeof SceneSchema>;

export const VideoScenePlanOutputSchema = z.object({
  projectId: z.string().optional(),
  totalDurationSecs: z.number(),
  scenes: z.array(SceneSchema),
  productionNotes: z.string().optional(),
  providerRecommendation: z.string(),
});
export type VideoScenePlanOutput = z.infer<typeof VideoScenePlanOutputSchema>;

export const SubtitleCueSchema = z.object({
  index: z.number().int(),
  startMs: z.number().int(),
  endMs: z.number().int(),
  text: z.string(),
  sectionRef: z.string().optional(),
});
export type SubtitleCue = z.infer<typeof SubtitleCueSchema>;

export const SubtitleOutputSchema = z.object({
  projectId: z.string().optional(),
  language: z.string().optional().default('en'),
  totalCues: z.number().int().optional(),
  cues: z.array(SubtitleCueSchema),
  srt: z.string().optional().default(''),
  vtt: z.string().optional().default(''),
  style: z.object({
    fontFamily: z.string(),
    fontSize: z.number(),
    color: z.string(),
    backgroundColor: z.string().optional(),
  }).optional(),
  notes: z.string().optional(),
});
export type SubtitleOutput = z.infer<typeof SubtitleOutputSchema>;

export const TimelineClipSchema = z.object({
  id: z.string(),
  // Nullable: a first-cut clip may reference an asset that doesn't exist yet
  assetId: z.string().nullable().optional(),
  assetVersionId: z.string().nullable().optional(),
  kind: z.enum(['voice', 'video', 'image', 'music', 'subtitle', 'overlay']),
  startMs: z.number().int(),
  durationMs: z.number().int(),
  trackIndex: z.number().int(),
  label: z.string().optional(),
  effects: z.array(z.record(z.unknown())).default([]),
  transition: z.string().optional(),
});
export type TimelineClip = z.infer<typeof TimelineClipSchema>;

export const EditPlanOutputSchema = z.object({
  projectId: z.string().optional(),
  label: z.string().default('AI first cut'),
  fps: z.number().int().default(30),
  resolution: z.object({ width: z.number().int(), height: z.number().int() })
    .default({ width: 1920, height: 1080 }),
  totalDurationMs: z.number().int(),
  tracks: z.array(z.object({
    // Optional: array position is the authoritative order; filled in on save
    index: z.number().int().optional(),
    kind: z.enum(['voice', 'video', 'music', 'subtitle', 'overlay']),
    label: z.string(),
    clips: z.array(TimelineClipSchema),
  })),
  notes: z.string().optional(),
});
export type EditPlanOutput = z.infer<typeof EditPlanOutputSchema>;

// Helper: coerce object-keyed map to array (AI sometimes returns {0:{...}, 1:{...}} instead of [...])
function toArray<T>() {
  return z.any().transform((v): T[] => Array.isArray(v) ? v as T[] : typeof v === 'object' && v !== null ? Object.values(v) as T[] : []);
}

export const AnalyticsOutputSchema = z.object({
  channelId: z.string().optional(),
  period: z.string().optional().default('last-30-days'),
  summary: z.string().optional().default(''),
  topPerformers: toArray<{ videoId: string; title: string; ctr: number; avgWatchTimeSecs: number; revenue?: number }>(),
  insights: toArray<{ metric: string; finding: string; impact: string; suggestion: string }>(),
  retentionIssues: toArray<{ sectionRef?: string; timestampSecs?: number; dropOffPct: number; diagnosis: string }>(),
  overallScore: z.any().transform(v => typeof v === 'number' ? v : typeof v === 'object' && v !== null ? (v as Record<string, number>)['score'] ?? 50 : 50),
});
export type AnalyticsOutput = z.infer<typeof AnalyticsOutputSchema>;

const priorityCoerce = z.any().transform((v): 'high' | 'medium' | 'low' => {
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  if (typeof v === 'number') return v <= 1 ? 'high' : v <= 2 ? 'medium' : 'low';
  return 'medium';
});

export const GrowthOutputSchema = z.object({
  channelId: z.string().optional(),
  period: z.string().optional().default('next-30-days'),
  summary: z.string().optional().default(''),
  // AI may omit or use different key — fall back to empty array
  nextTopics: z.array(z.object({
    topic: z.string(),
    rationale: z.string().optional().default(''),
    opportunityScore: z.any().transform(v => typeof v === 'number' ? Math.min(100, Math.max(0, v)) : 50),
    estimatedCTR: z.number().optional(),
  })).optional().default([]),
  optimizationActions: z.array(z.object({
    priority: priorityCoerce,
    area: z.string().optional().default('general'),
    action: z.string(),
    expectedImpact: z.string().optional().default(''),
  })).optional().default([]),
  memoryNotes: z.array(z.any().transform(v => typeof v === 'string' ? v : JSON.stringify(v))).optional().default([]),
});
export type GrowthOutput = z.infer<typeof GrowthOutputSchema>;
