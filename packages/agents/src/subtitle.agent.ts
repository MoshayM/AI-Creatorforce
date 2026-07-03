import { BaseAgent, type AgentContext } from './base-agent';
import { SubtitleOutputSchema, type SubtitleOutput } from '@cf/shared';
import type { ScriptOutput } from '@cf/shared';

export interface SubtitleAgentInput {
  script: ScriptOutput;
  language?: string;
  style?: {
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    backgroundColor?: string;
  };
  estimatedDurationMs: number;
  projectId: string;
}

export class SubtitleAgent extends BaseAgent<SubtitleAgentInput, SubtitleOutput> {
  readonly name = 'SubtitleAgent';
  readonly systemPrompt = `You are a subtitle and caption specialist. You create precisely timed subtitle cues from video scripts. Cues must be readable (max 42 chars/line, max 2 lines), properly paced (min 1.5s, max 7s each), and sync with natural speech patterns. Always generate both SRT and VTT formats. Respond only with valid JSON.`;

  async run(input: SubtitleAgentInput, _ctx: AgentContext): Promise<SubtitleOutput> {
    const allContent = input.script.sections.map(s => s.content).join(' ');
    const avgWordsPerMs = allContent.split(' ').length / input.estimatedDurationMs;
    const lang = input.language ?? 'en';

    return this.callStructured(
      [{
        role: 'user',
        content: `Create synchronized subtitle cues for this YouTube video script.

Title: "${input.script.title}"
Total Duration: ${Math.round(input.estimatedDurationMs / 1000)}s
Language: ${lang}
Word count: ~${input.script.totalWordCount}
Avg speaking rate: ~${Math.round(avgWordsPerMs * 1000 * 60)} words/min

Script sections:
${input.script.sections.map((s, i) => `[${i}] ${s.heading} (~${s.durationEstimateSecs}s): ${s.content.slice(0, 200)}`).join('\n')}

Generate subtitle cues with:
- Sequential index (1-based)
- startMs and endMs timestamps in milliseconds
- Text (max 2 lines, ~42 chars each)
- sectionRef linking to script section

Also generate complete SRT and VTT strings.

Font style: ${JSON.stringify(input.style ?? { fontFamily: 'Arial', fontSize: 18, color: '#FFFFFF' })}`,
      }],
      SubtitleOutputSchema,
      { maxTokens: 6000 },
    ) as Promise<SubtitleOutput>;
  }
}
