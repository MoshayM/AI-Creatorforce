import { Injectable } from '@nestjs/common';
import { callAIStructured } from '@cf/shared';
import { SEOOutputSchema, type SEOOutput } from '@cf/shared';

const SEO_SYSTEM = `You are a YouTube SEO specialist. Analyze keywords, competition, and search intent to optimize video content for maximum organic reach.`;

@Injectable()
export class SeoService {
  async optimize(title: string, description: string, niche?: string): Promise<SEOOutput> {
    return callAIStructured(
      [{
        role: 'user',
        content: `Optimize this YouTube content for SEO:\n\nTitle: ${title}\nDescription: ${description}\nNiche: ${niche ?? 'General'}\n\nProvide primary keyword, secondary keywords, competition level, and optimized versions.\n\nRespond with EXACTLY this JSON structure (no extra text, no markdown, no code fences):\n{"primaryKeyword":"main search keyword","secondaryKeywords":["keyword2","keyword3","keyword4"],"searchVolume":50000,"competition":"MEDIUM","optimizedTitle":"SEO-optimized video title","optimizedDescription":"SEO-optimized video description with keywords naturally integrated","recommendedTags":["tag1","tag2","tag3","tag4","tag5"]}`,
      }],
      SEOOutputSchema,
      { systemPrompt: SEO_SYSTEM, maxTokens: 2048 },
    );
  }
}
