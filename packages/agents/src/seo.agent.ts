import { BaseAgent, type AgentContext } from './base-agent';
import { SEOOutputSchema, type SEOOutput } from '@cf/shared';

export interface SEOInput {
  title: string;
  description: string;
  niche?: string;
}

export class SEOAgent extends BaseAgent<SEOInput, SEOOutput> {
  readonly name = 'SEOAgent';
  readonly systemPrompt = `You are a YouTube SEO specialist. Identify primary and secondary keywords, estimate search volumes, assess competition levels, and produce optimized titles and descriptions that rank well. Respond only with valid JSON.`;

  async run(input: SEOInput, _ctx: AgentContext): Promise<SEOOutput> {
    return this.callStructured(
      [{
        role: 'user',
        content: `Optimize this YouTube video for search:\n\nTitle: ${input.title}\nDescription: ${input.description}\nNiche: ${input.niche ?? 'General'}\n\nIdentify keywords, competition level, and provide an optimized title + description + tag set.`,
      }],
      SEOOutputSchema,
      { maxTokens: 2048 },
    );
  }
}
