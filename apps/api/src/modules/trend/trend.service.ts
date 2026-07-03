import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { callAIStructured } from '@cf/shared';
import { TrendOutputSchema, type TrendOutput } from '@cf/shared';

const TREND_SYSTEM = `You are a YouTube trend analyst. Identify trending topics and content opportunities based on current search data and platform patterns. Today's date: ${new Date().toISOString().split('T')[0]}.`;

@Injectable()
export class TrendService {
  private readonly logger = new Logger(TrendService.name);

  async analyze(niche: string, channelSize?: number): Promise<TrendOutput> {
    this.logger.log(`Analyzing trends — niche="${niche}" channelSize=${channelSize ?? 'unknown'}`);
    try {
      const result = await callAIStructured(
        [{
          role: 'user',
          content: `Analyze current YouTube trends for this niche:\n\nNiche: ${niche}\nChannel subscriber range: ${channelSize ? `~${channelSize}` : 'unknown'}\n\nIdentify top 10 trending topics. For each topic provide an opportunity score (integer 0–100), related keywords, and optional peak engagement time.\n\nRespond with EXACTLY this JSON structure (no extra text):\n{"trending":[{"topic":"Topic Name","score":75,"relatedKeywords":["keyword1","keyword2","keyword3"],"peakTime":"weekday evenings"}],"recommendations":["recommendation 1","recommendation 2"],"analysisDate":"${new Date().toISOString().split('T')[0]}"}`,
        }],
        TrendOutputSchema,
        { systemPrompt: TREND_SYSTEM, maxTokens: 3000 },
      );
      this.logger.log(`Trend analysis complete — niche="${niche}" topics=${result.trending.length}`);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Trend analysis failed — niche="${niche}" error="${msg}"`);
      if (msg.includes('ANTHROPIC_API_KEY') || msg.includes('OPENAI_API_KEY')) {
        throw new InternalServerErrorException('AI service not configured. Check ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.');
      }
      if (msg.includes('credit balance is too low') || msg.includes('insufficient_quota') || msg.includes('exceeded your current quota')) {
        throw new InternalServerErrorException('AI provider has insufficient credits. Please top up your Anthropic or OpenAI account.');
      }
      if (msg.includes('429') || msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('Too Many Requests')) {
        throw new InternalServerErrorException('AI provider rate limit reached. Please wait a few seconds and try again.');
      }
      if (msg.includes('schema mismatch')) {
        throw new InternalServerErrorException(`AI returned unexpected format — ${msg}`);
      }
      if (msg.includes('JSON parse failed')) {
        throw new InternalServerErrorException('AI returned invalid JSON. Please try again.');
      }
      throw new InternalServerErrorException(`Trend analysis failed: ${msg}`);
    }
  }
}
