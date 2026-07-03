import { BaseAgent, type AgentContext } from './base-agent';
import { VideoScenePlanOutputSchema, type VideoScenePlanOutput } from '@cf/shared';
import type { ScriptOutput } from '@cf/shared';

export interface VideoAgentInput {
  script: ScriptOutput;
  style?: string;
  provider?: string;
  projectId: string;
}

export class VideoAgent extends BaseAgent<VideoAgentInput, VideoScenePlanOutput> {
  readonly name = 'VideoAgent';
  readonly systemPrompt = `You are a video director for YouTube content. You create detailed scene plans, shot lists, and video generation prompts. Each prompt must be safe, avoid real people, avoid copyrighted IP. Respond only with valid JSON.`;

  async run(input: VideoAgentInput, _ctx: AgentContext): Promise<VideoScenePlanOutput> {
    const sectionsJson = JSON.stringify(
      input.script.sections.map((s, i) => ({
        id: `section-${i}`,
        heading: s.heading,
        durationSecs: s.durationEstimateSecs,
        content: s.content.slice(0, 200),
      })),
    );

    return this.callStructured(
      [{
        role: 'user',
        content: `Create a video scene plan for this YouTube video.

Title: "${input.script.title}"
Style: ${input.style ?? 'professional talking-head with b-roll'}
Target Provider: ${input.provider ?? 'runway'}

Script Sections: ${sectionsJson}

For each section, create:
- A scene with unique ID and title
- Shot type (wide/medium/close/cutaway)
- A detailed video generation prompt (15-30 words, cinematic quality)
- Duration estimate based on script
- Transition type (cut/fade/dissolve)

Rules: No real people/faces, no copyrighted locations or IP.

Project ID: ${input.projectId}`,
      }],
      VideoScenePlanOutputSchema,
      { maxTokens: 4096 },
    ) as Promise<VideoScenePlanOutput>;
  }
}
