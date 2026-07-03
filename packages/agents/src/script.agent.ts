import { BaseAgent, type AgentContext } from './base-agent';
import { ScriptOutputSchema, type ScriptOutput, type ResearchOutput } from '@cf/shared';

export interface ScriptInput {
  research: ResearchOutput;
  targetDurationMins?: number;
  style?: 'educational' | 'entertaining' | 'documentary' | 'tutorial';
}

export class ScriptAgent extends BaseAgent<ScriptInput, ScriptOutput> {
  readonly name = 'ScriptAgent';
  readonly systemPrompt = `You are an expert YouTube scriptwriter. Create engaging, well-structured scripts with a strong hook, clearly segmented sections, and a compelling call-to-action. Scripts must be factually accurate and grounded in the research provided. Never fabricate facts — only use information from the provided sources. Respond only with valid JSON.`;

  async run(input: ScriptInput, _ctx: AgentContext): Promise<ScriptOutput> {
    const { research, targetDurationMins = 10, style = 'educational' } = input;
    return this.callStructured(
      [{
        role: 'user',
        content: `Write a ${style} YouTube script based on this research:\n\nTopic: ${research.topic}\nSummary: ${research.summary}\nKey Points:\n${research.keyPoints.map((p) => `- ${p}`).join('\n')}\nTarget Duration: ${targetDurationMins} minutes\n\nSources to reference:\n${research.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}`,
      }],
      ScriptOutputSchema,
      { maxTokens: 8192 },
    );
  }
}
