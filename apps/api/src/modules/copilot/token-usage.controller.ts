import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Token usage dashboard data (Ai-video edit.md §12.2.8/§15): cost, token, and
 * cache-hit aggregates for the Analytics tab, so token spend is visible and
 * the ≥80% cache-hit design target is measurable.
 */
@Controller('token-usage')
@UseGuards(JwtAuthGuard)
export class TokenUsageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('summary')
  async summary(@CurrentUser() user: JwtPayload, @Query('days') days?: string) {
    const since = new Date(Date.now() - (Math.min(Number(days) || 30, 365)) * 24 * 60 * 60 * 1000);

    const [ledger, byModel, actions] = await Promise.all([
      this.prisma.tokenUsage.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { tokensIn: true, tokensOut: true, costUsd: true },
        _count: true,
      }),
      this.prisma.tokenUsage.groupBy({
        by: ['provider', 'model'],
        where: { createdAt: { gte: since } },
        _sum: { tokensIn: true, tokensOut: true, costUsd: true },
        _count: true,
      }),
      // Cache-hit rate over the user's copilot/voice turns (§12.3 target: ≥80%)
      this.prisma.actionRecord.groupBy({
        by: ['fromCache'],
        where: { userId: user.sub, createdAt: { gte: since }, source: { in: ['COPILOT', 'VOICE'] } },
        _count: true,
      }),
    ]);

    const hits = actions.find((a) => a.fromCache)?._count ?? 0;
    const misses = actions.find((a) => !a.fromCache)?._count ?? 0;

    return {
      sinceDays: Math.min(Number(days) || 30, 365),
      totals: {
        calls: ledger._count,
        tokensIn: ledger._sum.tokensIn ?? 0,
        tokensOut: ledger._sum.tokensOut ?? 0,
        costUsd: Number((ledger._sum.costUsd ?? 0).toFixed(4)),
      },
      byModel: byModel.map((m) => ({
        provider: m.provider,
        model: m.model,
        calls: m._count,
        tokensIn: m._sum.tokensIn ?? 0,
        tokensOut: m._sum.tokensOut ?? 0,
        costUsd: Number((m._sum.costUsd ?? 0).toFixed(4)),
      })),
      copilot: {
        turns: hits + misses,
        cacheHits: hits,
        cacheHitRate: hits + misses > 0 ? Number((hits / (hits + misses)).toFixed(3)) : null,
      },
    };
  }
}
