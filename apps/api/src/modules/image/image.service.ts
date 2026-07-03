import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { callAIStructured } from '@cf/shared';
import { ImageBriefOutputSchema, type ImageBriefOutput } from '@cf/shared';
import type { ScriptOutput } from '@cf/shared';

const IMAGE_SYSTEM = `You are a visual content director for YouTube. Create detailed image generation briefs. No real people, no copyrighted IP. Respond only with valid JSON.`;

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  async generateBriefs(script: ScriptOutput, projectId: string, brandKit?: Record<string, unknown>): Promise<ImageBriefOutput> {
    this.logger.log(`Generating image briefs — projectId="${projectId}" sections=${script.sections.length}`);
    const brand = brandKit ?? { colorPalette: ['#1a1a2e', '#16213e', '#0f3460'], fontStyle: 'modern', visualMood: 'professional' };

    try {
      const sectionsJson = JSON.stringify(
        script.sections.map((s, i) => ({ id: `scene-${i}`, heading: s.heading, content: s.content.slice(0, 150) })),
      );

      return await callAIStructured(
        [{
          role: 'user',
          content: `Create image briefs for YouTube video "${script.title}"\nBrand: ${JSON.stringify(brand)}\nSections: ${sectionsJson}\nProject: ${projectId}\n\nFor each section, include: sceneId, sectionHeading, prompt (descriptive, no people/IP), negativePrompt, style, aspectRatio ("16:9"), count (2), purpose ("b-roll").`,
        }],
        ImageBriefOutputSchema,
        { systemPrompt: IMAGE_SYSTEM, maxTokens: 4096 },
      ) as ImageBriefOutput;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Image briefs failed — ${msg}`);
      throw new InternalServerErrorException(`Image brief generation failed: ${msg}`);
    }
  }
}
