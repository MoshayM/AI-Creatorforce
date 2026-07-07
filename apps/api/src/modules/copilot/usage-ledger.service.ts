import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { setAIUsageListener, type AIUsageEvent } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { currentAiContext } from '../../common/ai-usage.context';

/**
 * Token usage ledger (Ai-video edit.md §12.2.8): every provider call in this
 * process — copilot turns, agents, workers — lands as a token_usage row, so
 * the Analytics dashboard can show real cost and cache-hit trends.
 * Attribution (user/job/project/video) comes from the AsyncLocalStorage AI
 * context active at call time — see ai-usage.context.ts.
 */
@Injectable()
export class UsageLedgerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    setAIUsageListener((event) => this.record(event));
  }

  onModuleDestroy() {
    setAIUsageListener(null);
  }

  /** Fire-and-forget: the ledger must never slow down or fail an AI call. */
  record(event: AIUsageEvent): void {
    const ctx = currentAiContext();
    if (ctx?.accumulator) {
      ctx.accumulator.costUsd += event.costUsd;
      ctx.accumulator.tokensIn += event.tokensIn;
      ctx.accumulator.tokensOut += event.tokensOut;
      ctx.accumulator.calls += 1;
    }
    void this.prisma.tokenUsage
      .create({
        data: {
          provider: event.provider,
          model: event.model,
          tokensIn: event.tokensIn,
          tokensOut: event.tokensOut,
          costUsd: event.costUsd,
          userId: ctx?.userId ?? null,
          jobId: ctx?.jobId ?? null,
          projectId: ctx?.projectId ?? null,
          importedVideoId: ctx?.importedVideoId ?? null,
        },
      })
      .catch((err) => this.logger.warn(`token_usage write failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}
