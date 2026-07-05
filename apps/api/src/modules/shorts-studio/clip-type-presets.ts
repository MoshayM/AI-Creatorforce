import type { ClipType } from '@prisma/client';

/** Per-platform output presets (ai.md Section 7). */
export interface ClipTypePreset {
  aspect: '9:16' | '1:1' | '16:9';
  maxDurationMs: number;
  /** Fraction of frame height to keep clear of platform UI, from each edge. */
  safeZone: { bottom: number; top: number };
}

export const CLIP_TYPE_PRESETS: Record<ClipType, ClipTypePreset> = {
  YOUTUBE_SHORTS: { aspect: '9:16', maxDurationMs: 60_000, safeZone: { bottom: 0.12, top: 0 } },
  INSTAGRAM_REELS: { aspect: '9:16', maxDurationMs: 90_000, safeZone: { bottom: 0.2, top: 0.08 } },
  TIKTOK: { aspect: '9:16', maxDurationMs: 60_000, safeZone: { bottom: 0.15, top: 0 } },
  LINKEDIN_CLIPS: { aspect: '1:1', maxDurationMs: 90_000, safeZone: { bottom: 0, top: 0 } },
  FACEBOOK_REELS: { aspect: '9:16', maxDurationMs: 90_000, safeZone: { bottom: 0.18, top: 0 } },
  PODCAST_HIGHLIGHTS: { aspect: '16:9', maxDurationMs: 120_000, safeZone: { bottom: 0, top: 0 } },
};
