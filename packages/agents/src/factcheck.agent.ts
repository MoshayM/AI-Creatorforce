import { BaseAgent, type AgentContext } from './base-agent';
import { FactCheckOutputSchema, type FactCheckOutput, type ScriptOutput, type ResearchOutput } from '@cf/shared';

export interface FactCheckInput {
  script: ScriptOutput;
  sources: ResearchOutput['sources'];
}

export class FactCheckAgent extends BaseAgent<FactCheckInput, FactCheckOutput> {
  readonly name = 'FactCheckAgent';
  readonly systemPrompt = `You are a rigorous fact-checker for YouTube content. Verify every factual claim in the script against the provided sources. Flag anything that is unverified, potentially false, or misleading. Be conservative — when in doubt, flag it. Respond only with valid JSON.`;

  async run(input: FactCheckInput, _ctx: AgentContext): Promise<FactCheckOutput> {
    const scriptText = input.script.sections
      .map((s) => `${s.heading}\n${s.content}`)
      .join('\n\n');

    return this.callStructured(
      [{
        role: 'user',
        content: `Fact-check this YouTube script against the provided sources:\n\nScript Title: ${input.script.title}\n\nScript Content:\n${scriptText}\n\nAvailable Sources:\n${input.sources.map((s) => `- ${s.title} (${s.url}): ${s.snippet}`).join('\n')}`,
      }],
      FactCheckOutputSchema,
      { maxTokens: 4096 },
    );
  }
}
