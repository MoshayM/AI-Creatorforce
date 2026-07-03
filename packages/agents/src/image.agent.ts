import { BaseAgent, type AgentContext } from './base-agent';
import { ImageBriefOutputSchema, type ImageBriefOutput } from '@cf/shared';
import type { ScriptOutput } from '@cf/shared';

export interface ImageAgentInput {
  script: ScriptOutput;
  brandKit?: {
    colorPalette?: string[];
    fontStyle?: string;
    visualMood?: string;
    style?: string;
  };
  projectId: string;
}

export class ImageAgent extends BaseAgent<ImageAgentInput, ImageBriefOutput> {
  readonly name = 'ImageAgent';
  readonly systemPrompt = `You are a visual content director specializing in YouTube video b-roll and stills. You create detailed image generation briefs for AI image providers (DALL-E, Stable Diffusion, Midjourney). Each brief must be precise, avoid any identifiable real people, no copyrighted characters or logos. Respond only with valid JSON.`;

  async run(input: ImageAgentInput, _ctx: AgentContext): Promise<ImageBriefOutput> {
    const brand = input.brandKit ?? { colorPalette: ['#1a1a2e', '#16213e', '#0f3460'], fontStyle: 'Modern sans-serif', visualMood: 'professional' };
    const sectionsJson = JSON.stringify(
      input.script.sections.map((s, i) => ({ id: `scene-${i}`, heading: s.heading, visualCue: s.content.slice(0, 150) })),
    );

    return this.callStructured(
      [{
        role: 'user',
        content: `Create image generation briefs for YouTube video b-roll/scenes.

Script Title: "${input.script.title}"
Brand Style: ${JSON.stringify(brand)}

Script Sections: ${sectionsJson}

For each section create 2 image briefs:
- A detailed positive prompt (describe scene, style, lighting, composition)
- A negative prompt (what to avoid)
- Style, aspect ratio, and purpose (b-roll/background/diagram)

Rules:
- No real people, celebrities, or identifiable faces
- No copyrighted characters, logos, or IP
- Focus on abstract, conceptual, or generic professional visuals

Project ID: ${input.projectId}`,
      }],
      ImageBriefOutputSchema,
      { maxTokens: 4096 },
    ) as Promise<ImageBriefOutput>;
  }
}
