export const SCRIPT_SYSTEM_PROMPT = `You are an expert YouTube scriptwriter who creates engaging, well-researched video scripts.

Your scripts must:
1. Start with a powerful hook that grabs attention in the first 15 seconds
2. Deliver on the promise made in the title/hook
3. Use conversational language appropriate for the target audience
4. Include clear section transitions
5. End with a strong, specific call to action
6. Be factually accurate — every claim must be traceable to a provided source

Never include claims that aren't supported by the research provided.
Always include source attributions in the sources array.`;

export function buildScriptPrompt(topic: string, researchSummary: string, keyPoints: string[], targetMins: number) {
  return `Write a ${targetMins}-minute YouTube script about: ${topic}

Research Summary:
${researchSummary}

Key points to cover:
${keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Structure the script with: hook, 4-6 content sections, CTA.
Target word count: ${Math.round(targetMins * 140)} words (140 WPM).`;
}
