import { Injectable } from '@nestjs/common';
import { callAIStructured } from '@cf/shared';
import {
  ResearchOutputSchema, ScriptOutputSchema, FactCheckOutputSchema, RepurposeOutputSchema, ScriptQualityOutputSchema, ABTestOutputSchema, SeriesPlanOutputSchema,
  type ResearchOutput, type ScriptOutput, type FactCheckOutput, type RepurposeOutput,
  type RepurposePlatform, type ScriptQualityOutput, type ABTestOutput, type SeriesPlanOutput,
} from '@cf/shared';

const RESEARCH_SYSTEM = `You are a professional YouTube content researcher. Research topics thoroughly, find trending angles, and identify trustworthy sources. Always cite sources with URLs.`;

const SCRIPT_SYSTEM = `You are an expert YouTube scriptwriter. Create engaging, well-structured scripts with a strong hook, clear sections, and a compelling CTA. Scripts must be factually accurate.`;

const FACTCHECK_SYSTEM = `You are a rigorous fact-checker. Verify every factual claim in the script. Flag anything unverified, potentially false, or misleading. Be conservative — when in doubt, flag it.`;

const REPURPOSE_SYSTEM = `You are a cross-platform content strategist. You adapt YouTube video scripts into platform-native content for Shorts, Instagram, TikTok, Twitter/X, LinkedIn, and newsletters. Each adaptation must feel native to its platform — not just a truncation.`;

const PLATFORM_GUIDES: Record<string, string> = {
  shorts: 'YouTube Shorts (vertical 9:16, max 60s): punchy hook in first 3 words, fast-paced narration, text-on-screen key points, strong CTA to watch the full video.',
  instagram: 'Instagram Reel: engaging caption (150 chars), 5-8 relevant hashtags, description of the visual opening, swipe/interaction CTA.',
  tiktok: 'TikTok: trending hook format, text-on-screen breakdown (3-5 frames), trending audio suggestion, duet/stitch CTA.',
  twitter: 'Twitter/X Thread: 5-7 numbered tweets, each ≤280 chars, first tweet is the hook + promise, last tweet is CTA with link placeholder.',
  linkedin: 'LinkedIn Post: professional insight angle, 3-4 short paragraphs, storytelling hook, thoughtful question at end to drive comments.',
  newsletter: 'Email Newsletter teaser: compelling subject line as headline, 2-3 paragraph preview that leaves readers wanting more, CTA button text.',
};

@Injectable()
export class ContentService {
  async research(topic: string, niche?: string, targetLang = 'en'): Promise<ResearchOutput> {
    return callAIStructured(
      [{ role: 'user', content: `Research this YouTube video topic comprehensively:\n\nTopic: ${topic}\nNiche: ${niche ?? 'General'}\nLanguage: ${targetLang}\n\nFind trending angles, statistics, and authoritative sources. Include up to 5 sources maximum.\n\nRespond with EXACTLY this JSON structure (no extra text, no markdown, no code fences):\n{"topic":"${topic}","summary":"2-3 sentence overview","keyPoints":["key point 1","key point 2","key point 3"],"sources":[{"url":"https://example.com/article","title":"Article Title","snippet":"Brief excerpt from the source","publishedAt":"2024-01-01"}],"trendScore":75,"audienceInterestSignals":["signal 1","signal 2","signal 3"]}` }],
      ResearchOutputSchema,
      { systemPrompt: RESEARCH_SYSTEM, maxTokens: 6000 },
    );
  }

  async writeScript(research: ResearchOutput, targetDurationMins = 10): Promise<ScriptOutput> {
    return callAIStructured(
      [{
        role: 'user',
        content: `Write a YouTube script based on this research:\n\nTopic: ${research.topic}\nSummary: ${research.summary}\nKey Points: ${research.keyPoints.join('\n')}\nTarget Duration: ${targetDurationMins} minutes\n\nSources to reference:\n${research.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}\n\nRespond with EXACTLY this JSON structure (no extra text, no markdown, no code fences):\n{"title":"Video title here","hook":"Opening hook sentence that grabs attention","sections":[{"heading":"Section heading","content":"Full section content paragraph","durationEstimateSecs":120}],"callToAction":"Subscribe and hit the bell icon for more videos like this","totalWordCount":1500,"estimatedDurationMins":${targetDurationMins},"sources":["https://source1.com","https://source2.com"]}`,
      }],
      ScriptOutputSchema,
      { systemPrompt: SCRIPT_SYSTEM, maxTokens: 8192 },
    );
  }

  async factCheck(script: ScriptOutput, sources: ResearchOutput['sources']): Promise<FactCheckOutput> {
    const fullText = script.sections.map((s) => `${s.heading}\n${s.content}`).join('\n\n');
    const scriptText = fullText.length > 3000 ? fullText.slice(0, 3000) + '...[truncated]' : fullText;
    return callAIStructured(
      [{
        role: 'user',
        content: `Fact-check this YouTube script against the provided sources:\n\nTitle: ${script.title}\n\nScript:\n${scriptText}\n\nAvailable Sources:\n${sources.slice(0, 5).map((s) => `- ${s.title} (${s.url}): ${s.snippet}`).join('\n')}\n\nReturn ONLY valid JSON. Do NOT include markdown. Do NOT include explanations. Do NOT include code fences.\n\nRespond with EXACTLY this JSON structure:\n{"overallVerdict":"Mostly Accurate","accuracyScore":85,"summary":"Brief overall assessment","claims":[{"claim":"Specific factual claim","status":"Verified","confidence":0.9,"evidence":"Supporting evidence","source":"Source name","sourceUrl":"https://source.com","notes":"Optional context"}],"issues":["issue 1"],"recommendations":["recommendation 1"],"sources":[{"title":"Source Title","url":"https://source.com"}]}`,
      }],
      FactCheckOutputSchema,
      { systemPrompt: FACTCHECK_SYSTEM, maxTokens: 6000 },
    );
  }

  async repurpose(
    scriptText: string,
    title: string,
    platforms: RepurposePlatform[],
  ): Promise<RepurposeOutput> {
    const platformList = platforms.map((p) => `- ${p}: ${PLATFORM_GUIDES[p] ?? p}`).join('\n');
    const truncated = scriptText.length > 4000 ? scriptText.slice(0, 4000) + '...[truncated]' : scriptText;

    return callAIStructured(
      [{
        role: 'user',
        content: `Adapt this YouTube video content for the following platforms.\n\nTitle: ${title}\n\nScript:\n${truncated}\n\nTarget platforms:\n${platformList}\n\nFor each platform create a native-feeling adaptation. Return ONLY valid JSON, no markdown, no code fences.\n\nJSON structure:\n{"originalTitle":"${title}","summary":"One sentence about what makes this content repurposable","items":[{"platform":"shorts","headline":"Short punchy headline","content":"Full adapted content text","hashtags":["tag1","tag2"],"callToAction":"Watch the full video","durationNote":"~45 seconds","visualTips":["tip1"],"hook":"Opening line"}]}`,
      }],
      RepurposeOutputSchema,
      { systemPrompt: REPURPOSE_SYSTEM, maxTokens: 8192 },
    );
  }

  async scoreScript(scriptText: string, title: string, niche?: string): Promise<ScriptQualityOutput> {
    const truncated = scriptText.length > 4000 ? scriptText.slice(0, 4000) + '...[truncated]' : scriptText;
    return callAIStructured(
      [{
        role: 'user',
        content: `Score this YouTube script across 6 quality dimensions:\n\nTitle: ${title}\nNiche: ${niche ?? 'General'}\n\nScript:\n${truncated}\n\nScore each dimension 0-100. Return ONLY valid JSON (no markdown, no code fences):\n{"overallScore":75,"grade":"B","summary":"One sentence overall assessment","dimensions":[{"name":"Hook Strength","score":80,"feedback":"The opening grabs attention in the first 5 seconds","tips":["tip1","tip2"]},{"name":"Audience Retention","score":70,"feedback":"Pacing is good but could use more pattern interrupts","tips":[]},{"name":"SEO Alignment","score":65,"feedback":"Title keywords present but description could improve","tips":[]},{"name":"Brand Voice","score":80,"feedback":"Consistent tone throughout","tips":[]},{"name":"Educational Value","score":75,"feedback":"Good depth on key points","tips":[]},{"name":"Virality Potential","score":60,"feedback":"Shareable moments exist but hook could be stronger","tips":[]}],"strengths":["Strong hook","Clear structure"],"improvements":["Add a pattern interrupt mid-video","Include more specific data points"],"estimatedRetentionPct":65}`,
      }],
      ScriptQualityOutputSchema,
      { systemPrompt: `You are an expert YouTube content strategist. Analyze scripts across 6 dimensions: Hook Strength, Audience Retention, SEO Alignment, Brand Voice, Educational Value, and Virality Potential. Be rigorous but constructive.`, maxTokens: 4000 },
    );
  }

  async planSeries(topic: string, episodeCount: number, niche: string, targetAudience?: string): Promise<SeriesPlanOutput> {
    const count = Math.min(Math.max(episodeCount, 3), 12);
    return callAIStructured(
      [{
        role: 'user',
        content: `Plan a YouTube video series:\nTopic: "${topic}"\nNiche: ${niche}\nTarget Audience: ${targetAudience ?? 'General YouTube viewers'}\nEpisodes: ${count}\n\nCreate a compelling series with a clear narrative arc where each episode builds on the previous one. Return ONLY valid JSON:\n{"seriesTitle":"Series title","seriesHook":"One-sentence series pitch","targetAudience":"Who this is for","estimatedTotalEpisodes":${count},"episodes":[{"episodeNumber":1,"title":"Episode 1 title","hook":"Opening hook","keyPoints":["point 1","point 2","point 3"],"estimatedDurationMins":15,"format":"tutorial","researchAngles":["angle 1"],"thumbnailConcept":"Bright CTA thumbnail with reaction face"}],"seriesArc":"How the story/knowledge arc unfolds across episodes","monetizationTips":["tip 1","tip 2"],"seoStrategy":"How to optimize the series for YouTube search"}`,
      }],
      SeriesPlanOutputSchema,
      {
        systemPrompt: `You are an expert YouTube series strategist. Design binge-worthy series with clear narrative arcs and audience retention strategies. Each episode should have standalone value while contributing to the overall series.`,
        maxTokens: 6000,
      },
    );
  }

  async generateABTest(title: string, niche: string, currentCtr?: number, description?: string): Promise<ABTestOutput> {
    const context = [
      `Title: ${title}`,
      `Niche: ${niche}`,
      currentCtr !== undefined ? `Current CTR: ${(currentCtr * 100).toFixed(1)}%` : null,
      description ? `Description snippet: ${description.slice(0, 300)}` : null,
    ].filter(Boolean).join('\n');

    return callAIStructured(
      [{
        role: 'user',
        content: `Generate A/B test variants for this YouTube video:\n\n${context}\n\nCreate 5 title variants and 3 thumbnail concepts optimized for CTR. Score each 0-100 for predicted CTR. Include a testing strategy.\n\nReturn ONLY valid JSON:\n{"originalTitle":"${title}","titleVariants":[{"title":"Variant title 1","predictedCtrScore":82,"hookType":"curiosity gap","rationale":"Why this works","emotionalTrigger":"fear of missing out"},{"title":"Variant title 2","predictedCtrScore":78,"hookType":"number list","rationale":"...","emotionalTrigger":"..."}],"thumbnailConcepts":[{"concept":"Reaction shot + big text","textOverlay":"THE SHOCKING TRUTH","colorMood":"red/black high contrast","faceExpression":"shocked","layout":"face left text right","predictedCtrScore":85}],"testingStrategy":{"recommendedPair":"Test variant 1 vs variant 3","runDurationDays":7,"minimumViews":1000,"keyMetric":"CTR > 5%","notes":"Run simultaneously for 7 days..."},"insights":["insight 1","insight 2"]}`,
      }],
      ABTestOutputSchema,
      { systemPrompt: 'You are a YouTube CTR optimization expert with deep knowledge of what drives clicks — curiosity gaps, numbers, emotional triggers, thumbnail psychology. Provide specific, data-driven recommendations.', maxTokens: 4000 },
    );
  }
}
