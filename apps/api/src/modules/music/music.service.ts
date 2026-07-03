import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { callAIStructured } from '@cf/shared';
import { MusicBriefOutputSchema, type MusicBriefOutput } from '@cf/shared';
import type { ScriptOutput } from '@cf/shared';

const MUSIC_SYSTEM = `You are a music director for YouTube content. Create detailed AI music generation briefs. All output is original creator-licensed AI generation. Respond only with valid JSON.`;

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);

  async generateBrief(script: ScriptOutput, projectId: string, mood?: string, genre?: string): Promise<MusicBriefOutput> {
    this.logger.log(`Generating music brief — projectId="${projectId}"`);
    const durationSecs = Math.round(script.estimatedDurationMins * 60);

    try {
      return await callAIStructured(
        [{
          role: 'user',
          content: `Create a music generation brief for YouTube video "${script.title}"\nDuration: ${durationSecs}s\nMood: ${mood ?? 'professional and engaging'}\nGenre: ${genre ?? 'electronic/ambient'}\nHook: "${script.hook.slice(0, 150)}"\n\nGenerate: mood, genre, bpm (60-160), instruments (array), energy (low/medium/high/dynamic), durationSecs, structure, prompt, provider ("suno").`,
        }],
        MusicBriefOutputSchema,
        { systemPrompt: MUSIC_SYSTEM, maxTokens: 2048 },
      ) as MusicBriefOutput;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Music brief failed — ${msg}`);
      throw new InternalServerErrorException(`Music brief generation failed: ${msg}`);
    }
  }
}
