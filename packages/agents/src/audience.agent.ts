import { BaseAgent, type AgentContext } from './base-agent';
import { AudienceOutputSchema, type AudienceOutput } from '@cf/shared';

export interface AudienceInput {
  niche: string;
  channelDescription?: string;
}

export class AudienceAgent extends BaseAgent<AudienceInput, AudienceOutput> {
  readonly name = 'AudienceAgent';
  readonly systemPrompt = `You are a YouTube audience analysis expert. Analyze channel niches to identify the primary demographic, age range, interests, peak engagement times, content preferences, and actionable growth recommendations. Respond only with valid JSON.`;

  async run(input: AudienceInput, _ctx: AgentContext): Promise<AudienceOutput> {
    return this.callStructured(
      [{
        role: 'user',
        content: `Analyze the YouTube audience for this niche:\n\nNiche: ${input.niche}${input.channelDescription ? `\nChannel: ${input.channelDescription}` : ''}\n\nProvide demographics, interests, peak engagement times, content preferences, and growth recommendations.`,
      }],
      AudienceOutputSchema,
      { maxTokens: 2048 },
    );
  }
}
