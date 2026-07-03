import { BaseAgent, type AgentContext } from './base-agent';
import { ResearchOutputSchema, type ResearchOutput } from '@cf/shared';

export interface ResearchInput {
  topic: string;
  niche?: string;
  targetLang?: string;
}

export class ResearchAgent extends BaseAgent<ResearchInput, ResearchOutput> {
  readonly name = 'ResearchAgent';
  readonly systemPrompt = `You are a professional YouTube content researcher. Research topics thoroughly, find trending angles, and identify trustworthy sources. Always cite sources with URLs. Be comprehensive and accurate — fabricated sources are not allowed. Respond only with valid JSON.`;

  async run(input: ResearchInput, _ctx: AgentContext): Promise<ResearchOutput> {
    return this.callStructured(
      [{
        role: 'user',
        content: `Research this YouTube video topic comprehensively:\n\nTopic: ${input.topic}\nNiche: ${input.niche ?? 'General'}\nLanguage: ${input.targetLang ?? 'en'}\n\nFind trending angles, key statistics, and authoritative sources. All source URLs must be real.`,
      }],
      ResearchOutputSchema,
      { maxTokens: 4096 },
    );
  }
}
