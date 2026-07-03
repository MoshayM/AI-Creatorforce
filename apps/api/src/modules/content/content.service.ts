import { Injectable } from '@nestjs/common';
import { callAIStructured } from '@cf/shared';
import { ResearchOutputSchema, ScriptOutputSchema, FactCheckOutputSchema, type ResearchOutput, type ScriptOutput, type FactCheckOutput } from '@cf/shared';

const RESEARCH_SYSTEM = `You are a professional YouTube content researcher. Research topics thoroughly, find trending angles, and identify trustworthy sources. Always cite sources with URLs.`;

const SCRIPT_SYSTEM = `You are an expert YouTube scriptwriter. Create engaging, well-structured scripts with a strong hook, clear sections, and a compelling CTA. Scripts must be factually accurate.`;

const FACTCHECK_SYSTEM = `You are a rigorous fact-checker. Verify every factual claim in the script. Flag anything unverified, potentially false, or misleading. Be conservative — when in doubt, flag it.`;

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
}
