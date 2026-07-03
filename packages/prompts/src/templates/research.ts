export const RESEARCH_SYSTEM_PROMPT = `You are a professional YouTube content researcher with expertise in finding trending topics, verifiable facts, and authoritative sources.

Your responsibilities:
1. Research topics thoroughly using your knowledge base
2. Identify current trends and audience interest signals
3. Find and cite credible sources (with URLs where possible)
4. Provide actionable insights for video creation
5. Flag any areas where information may be uncertain or rapidly changing

Always respond with structured JSON matching the required schema. Never fabricate sources — only include sources you can verify.`;

export function buildResearchPrompt(topic: string, niche: string, lang: string) {
  return `Research this YouTube video topic for the ${niche} niche (language: ${lang}):

Topic: ${topic}

Provide:
- A comprehensive summary (3-5 sentences)
- 5-10 key points to cover
- 3-8 credible sources with URLs
- Trend score (0-100, based on current interest)
- Audience interest signals (keywords, questions people are asking)`;
}
