import { BaseAgent, type AgentContext } from './base-agent';
import { AnalyticsOutputSchema, type AnalyticsOutput } from '@cf/shared';

export interface AnalyticsAgentInput {
  channelId: string;
  channelTitle: string;
  niche?: string;
  metrics: {
    period: string;
    videos: Array<{
      videoId: string;
      title: string;
      ctr: number;
      avgWatchTimeSecs: number;
      views: number;
      revenue?: number;
      retentionCurve?: number[];
    }>;
    channelStats: {
      totalSubscribers: number;
      totalViews: number;
      avgCTR: number;
      avgRetentionPct: number;
    };
  };
  sectionMarkers?: Array<{ label: string; timestampSecs: number }>;
}

export class AnalyticsAgent extends BaseAgent<AnalyticsAgentInput, AnalyticsOutput> {
  readonly name = 'AnalyticsAgent';
  readonly systemPrompt = `You are a YouTube analytics specialist. You interpret channel performance data, identify what's working and what isn't, diagnose retention drop-offs, and provide specific, actionable insights. Always base findings on the data provided. Respond only with valid JSON.`;

  async run(input: AnalyticsAgentInput, _ctx: AgentContext): Promise<AnalyticsOutput> {
    const metricsJson = JSON.stringify(input.metrics, null, 2);

    return this.callStructured(
      [{
        role: 'user',
        content: `Analyze YouTube channel performance data and generate insights.

Channel: "${input.channelTitle}" (${input.channelId})
Niche: ${input.niche ?? 'General'}
Period: ${input.metrics.period}

Channel Stats: ${JSON.stringify(input.metrics.channelStats)}
Videos: ${metricsJson}
Section Markers: ${JSON.stringify(input.sectionMarkers ?? [])}

Identify:
1. Top performing videos and WHY they performed well
2. Specific retention drop-off points mapped to script sections
3. CTR patterns — what titles/thumbnails drove higher CTR
4. Revenue optimization opportunities
5. Content quality score (0-100)

Be specific and data-driven. Each insight must reference actual metrics.`,
      }],
      AnalyticsOutputSchema,
      { maxTokens: 4096 },
    ) as Promise<AnalyticsOutput>;
  }
}
