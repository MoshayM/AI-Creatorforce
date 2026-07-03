import { Injectable } from '@nestjs/common';
import { callAIStructured } from '@cf/shared';
import { MetadataOutputSchema, type MetadataOutput, type ScriptOutput } from '@cf/shared';

const METADATA_SYSTEM = `You are a YouTube SEO expert. Generate optimized titles, descriptions, and tags to maximize discoverability. Follow YouTube best practices. Titles max 100 chars, descriptions max 5000 chars.`;

@Injectable()
export class MetadataService {
  async generate(script: ScriptOutput, channelNiche?: string): Promise<MetadataOutput> {
    return callAIStructured(
      [{
        role: 'user',
        content: `Generate optimized YouTube metadata for this video:\n\nTitle: ${script.title}\nHook: ${script.hook}\nKey sections: ${script.sections.map((s) => s.heading).join(', ')}\nCTA: ${script.callToAction}\nNiche: ${channelNiche ?? 'General'}\n\nOptimize for search and click-through-rate.\n\nRespond with EXACTLY this JSON structure (no extra text, no markdown, no code fences):\n{"title":"SEO-optimized video title (max 100 chars)","description":"Full video description optimized for YouTube search (max 5000 chars)","tags":["tag1","tag2","tag3","tag4","tag5"],"category":"Science & Technology","language":"en","thumbnailPrompt":"Description for thumbnail visual design"}`,
      }],
      MetadataOutputSchema,
      { systemPrompt: METADATA_SYSTEM, maxTokens: 2048 },
    );
  }
}
