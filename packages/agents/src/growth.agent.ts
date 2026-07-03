import { BaseAgent, type AgentContext } from './base-agent';
import { GrowthOutputSchema, type GrowthOutput } from '@cf/shared';
import type { AnalyticsOutput } from '@cf/shared';

export interface GrowthAgentInput {
  channelId: string;
  channelTitle: string;
  niche?: string;
  analyticsReport: AnalyticsOutput;
  channelGoals?: string[];
  existingTopics?: string[];
}

export class GrowthAgent extends BaseAgent<GrowthAgentInput, GrowthOutput> {
  readonly name = 'GrowthAgent';
  readonly systemPrompt = `You are a YouTube growth strategist. You turn performance analytics into concrete next steps: specific video topics to create, thumbnail/title improvements, upload schedule optimizations, and audience engagement tactics. You also distill learnings into channel memory notes. Respond only with valid JSON.`;

  async run(input: GrowthAgentInput, _ctx: AgentContext): Promise<GrowthOutput> {
    return this.callStructured(
      [{
        role: 'user',
        content: `Create a growth strategy based on channel analytics.

Channel: "${input.channelTitle}" (${input.channelId})
Niche: ${input.niche ?? 'General'}
Goals: ${(input.channelGoals ?? ['grow subscribers', 'increase revenue']).join(', ')}

Analytics Summary:
- Overall Score: ${input.analyticsReport.overallScore}/100
- Key Insights: ${input.analyticsReport.insights.slice(0, 5).map(i => i.finding).join('; ')}
- Top Performers: ${input.analyticsReport.topPerformers.slice(0, 3).map(v => v.title).join(', ')}
- Retention Issues: ${input.analyticsReport.retentionIssues.slice(0, 3).map(r => r.diagnosis).join('; ')}

Existing Topics (avoid repeating): ${(input.existingTopics ?? []).slice(0, 10).join(', ')}

Generate:
1. 5-10 specific next video topics with opportunity scores
2. 5 prioritized optimization actions (thumbnail, title, posting time, etc.)
3. 3-5 channel memory notes (distilled learnings to guide future content)

Focus on actionable, specific recommendations tied to the analytics data.`,
      }],
      GrowthOutputSchema,
      { maxTokens: 4096 },
    ) as Promise<GrowthOutput>;
  }
}
