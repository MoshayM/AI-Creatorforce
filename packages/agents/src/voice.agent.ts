import { BaseAgent, type AgentContext } from './base-agent';
import { VoiceSpecOutputSchema, type VoiceSpecOutput } from '@cf/shared';
import type { ScriptOutput } from '@cf/shared';

export interface VoiceAgentInput {
  script: ScriptOutput;
  voiceProfile?: {
    name?: string;
    style?: string;
    tone?: string;
    pace?: string;
    voiceId?: string;
    provider?: string;
  };
  projectId: string;
}

export class VoiceAgent extends BaseAgent<VoiceAgentInput, VoiceSpecOutput> {
  readonly name = 'VoiceAgent';
  readonly systemPrompt = `You are a professional voice direction specialist for YouTube narration. You create detailed TTS (text-to-speech) specifications for AI voice generation. For each script section, produce SSML-like markup with pacing, emphasis, and pronunciation guidance. Always respond with valid JSON only.`;

  async run(input: VoiceAgentInput, _ctx: AgentContext): Promise<VoiceSpecOutput> {
    const profile = input.voiceProfile ?? { name: 'Default', style: 'conversational', tone: 'engaging', pace: 'moderate' };
    const sectionsJson = JSON.stringify(
      input.script.sections.map((s, i) => ({ id: `section-${i}`, heading: s.heading, content: s.content.slice(0, 300) })),
    );

    return this.callStructured(
      [{
        role: 'user',
        content: `Create voice narration specifications for this YouTube script.

Voice Profile:
- Name: ${profile.name ?? 'Narrator'}
- Style: ${profile.style ?? 'conversational'}
- Tone: ${profile.tone ?? 'engaging'}
- Pace: ${profile.pace ?? 'moderate'}

Script Title: "${input.script.title}"
Sections: ${sectionsJson}

For each section, generate:
1. SSML markup with <break>, <emphasis>, <prosody> tags for pacing/pauses
2. Speed (0.9-1.1 typical), stability (0.7-0.9)
3. Pronunciation notes for technical terms

Estimate total narration duration. Synthetic voice ALWAYS requires disclosure.

Project ID: ${input.projectId}`,
      }],
      VoiceSpecOutputSchema,
      { maxTokens: 4096 },
    ) as Promise<VoiceSpecOutput>;
  }
}
