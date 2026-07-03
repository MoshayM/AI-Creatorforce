import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { callAIStructured } from '@cf/shared';
import { GrowthOutputSchema, type GrowthOutput, type AnalyticsOutput } from '@cf/shared';

const GROWTH_SYSTEM = `You are a YouTube growth strategist. Turn analytics into actionable next steps: topics, optimizations, and channel memory notes. Respond only with valid JSON.`;

@Injectable()
export class GrowthService {
  private readonly logger = new Logger(GrowthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateRecommendations(channelId: string, analyticsReport: AnalyticsOutput, userId: string): Promise<GrowthOutput> {
    this.logger.log(`Generating growth recommendations — channelId="${channelId}"`);

    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
      include: {
        projects: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { title: true },
        },
      },
    });

    if (!channel) throw new InternalServerErrorException('Channel not found');

    const existingTopics = channel.projects.map(p => p.title);

    try {
      return await callAIStructured(
        [{
          role: 'user',
          content: `Create growth strategy for channel "${channel.title}" (${channel.niche ?? 'General'}).\n\nAnalytics Score: ${analyticsReport.overallScore}/100\nTop Insights: ${analyticsReport.insights.slice(0, 5).map(i => i.finding).join('; ')}\nExisting Topics: ${existingTopics.slice(0, 10).join(', ')}\n\nGenerate: 5-10 next video topics with opportunity scores, 5 optimization actions, 3-5 channel memory notes.`,
        }],
        GrowthOutputSchema,
        { systemPrompt: GROWTH_SYSTEM, maxTokens: 4096 },
      ) as never as GrowthOutput;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(`Growth report failed: ${msg}`);
    }
  }
}
