import { Injectable } from '@nestjs/common';
import { callAIStructured } from '@cf/shared';
import { AudienceOutputSchema, type AudienceOutput } from '@cf/shared';

const AUDIENCE_SYSTEM = `You are a YouTube audience analyst. Analyze channel niches and content to understand the target audience deeply — their demographics, interests, and behavior patterns.`;

@Injectable()
export class AudienceService {
  async analyze(channelNiche: string, recentTopics?: string[]): Promise<AudienceOutput> {
    return callAIStructured(
      [{
        role: 'user',
        content: `Analyze the target audience for this YouTube channel:\n\nNiche: ${channelNiche}\nRecent topics: ${recentTopics?.join(', ') ?? 'N/A'}\n\nRespond with EXACTLY this JSON structure (no extra text, no markdown, no code fences):\n{"primaryDemographic":"e.g. Young adults aged 18-34 interested in tech","ageRange":"e.g. 18-34","interests":["interest1","interest2","interest3"],"peakEngagementTimes":["weekday evenings 7-10pm","Saturday mornings"],"contentPreferences":["how-to tutorials","product reviews","comparison videos"],"recommendations":["recommendation 1","recommendation 2","recommendation 3"]}`,
      }],
      AudienceOutputSchema,
      { systemPrompt: AUDIENCE_SYSTEM, maxTokens: 2048 },
    );
  }
}
