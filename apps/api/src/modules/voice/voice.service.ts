import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { callAIStructured } from '@cf/shared';
import { VoiceSpecOutputSchema, type VoiceSpecOutput } from '@cf/shared';
import type { ScriptOutput } from '@cf/shared';

const VOICE_SYSTEM = `You are a professional voice direction specialist for YouTube narration. Create detailed TTS specifications. Respond only with valid JSON.`;

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  async generateSpec(script: ScriptOutput, projectId: string, voiceProfile?: Record<string, unknown>): Promise<VoiceSpecOutput> {
    this.logger.log(`Generating voice spec — projectId="${projectId}" sections=${script.sections.length}`);
    try {
      const profile = voiceProfile ?? { name: 'Narrator', style: 'conversational', tone: 'engaging', pace: 'moderate' };
      const sectionsJson = JSON.stringify(
        script.sections.map((s, i) => ({ id: `section-${i}`, heading: s.heading, content: s.content.slice(0, 300) })),
      );

      return await callAIStructured(
        [{
          role: 'user',
          content: `Create voice narration specifications for YouTube script.\n\nVoice Profile: ${JSON.stringify(profile)}\nTitle: "${script.title}"\nSections: ${sectionsJson}\nProject: ${projectId}\n\nFor each section, include: sectionId (e.g. "section-0"), heading, ssmlMarkup, provider (use "elevenlabs"), speed (number 0.5-2.0, default 1.0), stability (number 0-1, default 0.75), pronunciationNotes (array). Total duration estimate. Set disclosureRequired: true.`,
        }],
        VoiceSpecOutputSchema,
        { systemPrompt: VOICE_SYSTEM, maxTokens: 4096 },
      ) as VoiceSpecOutput;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Voice spec failed — ${msg}`);
      throw new InternalServerErrorException(`Voice spec generation failed: ${msg}`);
    }
  }
}
