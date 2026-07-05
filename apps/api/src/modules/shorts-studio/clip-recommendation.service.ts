import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface ClipRecommendation {
  highlightId: string;
  topicSegmentId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  confidence: number; // 0–1
  reason: string;
  finalScore: number;
  scores: Record<string, number>;
  predictedPerformance: {
    viralityBand: 'low' | 'medium' | 'high';
    estimatedRetention: number;
  };
  keywords: string[];
  titleSuggestion: string;
  category: string;
  title: string;
}

/**
 * Pure ranking/formatting over already-computed Highlight rows — no AI calls
 * (ai.md Section 6). predictedPerformance is derived from the stored score
 * dimensions; keywords/titleSuggestion were piggybacked during scoring.
 */
@Injectable()
export class ClipRecommendationService {
  constructor(private readonly prisma: PrismaService) {}

  async recommend(importedVideoId: string, limit: number): Promise<ClipRecommendation[]> {
    const highlights = await this.prisma.highlight.findMany({
      where: { topicSegment: { importedVideoId } },
      orderBy: { finalScore: 'desc' },
      take: limit,
      include: { topicSegment: true },
    });

    return highlights.map((h) => ({
      highlightId: h.id,
      topicSegmentId: h.topicSegmentId,
      startMs: h.topicSegment.startMs,
      endMs: h.topicSegment.endMs,
      durationMs: h.topicSegment.endMs - h.topicSegment.startMs,
      confidence: h.topicSegment.confidence,
      reason: h.reason,
      finalScore: h.finalScore,
      scores: {
        virality: h.virality,
        emotion: h.emotion,
        retention: h.retention,
        hookStrength: h.hookStrength,
        education: h.education,
        entertainment: h.entertainment,
        confidence: h.confidence,
        trendPotential: h.trendPotential,
        shortSuitability: h.shortSuitability,
      },
      predictedPerformance: {
        viralityBand: h.virality >= 70 ? 'high' : h.virality >= 40 ? 'medium' : 'low',
        estimatedRetention: Math.round(h.retention),
      },
      keywords: h.keywords,
      titleSuggestion: h.titleSuggestion,
      category: h.topicSegment.category,
      title: h.topicSegment.title,
    }));
  }
}
