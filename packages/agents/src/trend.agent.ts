import { BaseAgent, type AgentContext } from './base-agent';
import { TrendOutputSchema, type TrendOutput } from '@cf/shared';

export interface TrendInput {
  niche: string;
  region?: string;
}

export class TrendAgent extends BaseAgent<TrendInput, TrendOutput> {
  readonly name = 'TrendAgent';
  readonly systemPrompt = `You are a YouTube trend analyst. Identify currently trending topics in the given niche with opportunity scores (0-100). Focus on topics with growing search interest, viral potential, and high audience demand. Respond only with valid JSON.`;

  async run(input: TrendInput, _ctx: AgentContext): Promise<TrendOutput> {
    return this.callStructured(
      [{
        role: 'user',
        content: `Analyze trending YouTube topics for niche: "${input.niche}"${input.region ? ` in region: ${input.region}` : ''}.\n\nReturn the top 5-10 trending topics with scores, related keywords, and peak engagement times.`,
      }],
      TrendOutputSchema,
      { maxTokens: 2048 },
    );
  }
}
