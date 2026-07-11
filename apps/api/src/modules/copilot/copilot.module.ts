import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ShortsStudioModule } from '../shorts-studio/shorts-studio.module';
import { WalletModule } from '../wallet/wallet.module';
import { AiOpsModule } from '../ai-ops/ai-ops.module';
import { MetricsModule } from '../metrics/metrics.module';
import { OrgsModule } from '../orgs/orgs.module';
import { CopilotService } from './copilot.service';
import { CopilotController } from './copilot.controller';
import { IntentCacheService } from './intent-cache.service';
import { UsageLedgerService } from './usage-ledger.service';
import { IntentsController } from './intents.controller';
import { TokenUsageController } from './token-usage.controller';

@Module({
  imports: [JobsModule, ApprovalsModule, ShortsStudioModule, WalletModule, AiOpsModule, MetricsModule, OrgsModule],
  controllers: [CopilotController, IntentsController, TokenUsageController],
  providers: [CopilotService, IntentCacheService, UsageLedgerService],
  exports: [CopilotService],
})
export class CopilotModule {}
