import { BaseAgent, type AgentContext } from './base-agent';
import { MetadataOutputSchema, type MetadataOutput, type ScriptOutput } from '@cf/shared';

export interface MetadataInput {
  script: ScriptOutput;
  niche?: string;
  targetLang?: string;
}

export class MetadataAgent extends BaseAgent<MetadataInput, MetadataOutput> {
  readonly name = 'MetadataAgent';
  readonly systemPrompt = `You are a YouTube metadata optimization expert. Generate SEO-optimized titles (max 100 chars), compelling descriptions (max 5000 chars), and highly relevant tags. Maximize click-through rate and search discoverability. Respond only with valid JSON.`;

  async run(input: MetadataInput, _ctx: AgentContext): Promise<MetadataOutput> {
    const scriptSummary = `Title: ${input.script.title}\nHook: ${input.script.hook}\nSections: ${input.script.sections.map((s) => s.heading).join(', ')}\nCTA: ${input.script.callToAction}`;

    return this.callStructured(
      [{
        role: 'user',
        content: `Generate optimized YouTube metadata for this video:\n\n${scriptSummary}\n\nNiche: ${input.niche ?? 'General'}\nLanguage: ${input.targetLang ?? 'en'}\n\nProvide a thumbnail prompt that describes a compelling visual concept.`,
      }],
      MetadataOutputSchema,
      { maxTokens: 2048 },
    );
  }
}
