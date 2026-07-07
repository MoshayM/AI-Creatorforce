import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { setAIUsageListener } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Token usage ledger (Ai-video edit.md §12.2.8): every provider call in this
 * process — copilot turns, agents, workers — lands as a token_usage row, so
 * the Analytics dashboard can show real cost and cache-hit trends.
 */
@Injectable()
export class UsageLedgerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    setAIUsageListener((event) => {
      // Fire-and-forget: the ledger must never slow down or fail an AI call
      void this.prisma.tokenUsage
        .create({
          data: {
            provider: event.provider,
            model: event.model,
            tokensIn: event.tokensIn,
            tokensOut: event.tokensOut,
            costUsd: event.costUsd,
          },
        })
        .catch((err) => this.logger.warn(`token_usage write failed: ${err instanceof Error ? err.message : String(err)}`));
    });
  }

  onModuleDestroy() {
    setAIUsageListener(null);
  }
}
