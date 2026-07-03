import { BaseAgent, type AgentContext } from './base-agent';
import { MusicBriefOutputSchema, type MusicBriefOutput } from '@cf/shared';
import type { ScriptOutput } from '@cf/shared';

export interface MusicAgentInput {
  script: ScriptOutput;
  mood?: string;
  genre?: string;
  energyLevel?: 'low' | 'medium' | 'high' | 'dynamic';
  projectId: string;
}

export class MusicAgent extends BaseAgent<MusicAgentInput, MusicBriefOutput> {
  readonly name = 'MusicAgent';
  readonly systemPrompt = `You are a music director for YouTube content. You create detailed music generation briefs for AI music providers. The output must be the creator's own licensed generation — no use of any existing copyrighted music. Always respond with valid JSON.`;

  async run(input: MusicAgentInput, _ctx: AgentContext): Promise<MusicBriefOutput> {
    const durationSecs = Math.round(input.script.estimatedDurationMins * 60);

    return this.callStructured(
      [{
        role: 'user',
        content: `Create a music generation brief for this YouTube video.

Video Title: "${input.script.title}"
Estimated Duration: ${input.script.estimatedDurationMins} minutes (${durationSecs}s)
Requested Mood: ${input.mood ?? 'engaging, professional'}
Requested Genre: ${input.genre ?? 'electronic/ambient'}
Energy Level: ${input.energyLevel ?? 'dynamic'}

Script Hook: "${input.script.hook.slice(0, 200)}"

Create a complete music brief with:
- Genre (specific subgenre)
- BPM (60-160 range)
- Key instruments
- Energy arc (intro/build/outro structure)
- Detailed generation prompt for AI music tools (Suno/Udio)
- Duration in seconds

The music must be original, royalty-free AI generation.`,
      }],
      MusicBriefOutputSchema,
      { maxTokens: 2048 },
    ) as Promise<MusicBriefOutput>;
  }
}
