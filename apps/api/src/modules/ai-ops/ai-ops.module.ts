import { Module } from '@nestjs/common';
import { ProviderRegistryService } from './provider-registry.service';
import { PricingService } from './pricing.service';
import { ProfitGuardService } from './profit-guard.service';
import { AiOpsController } from './ai-ops.controller';

@Module({
  providers: [ProviderRegistryService, PricingService, ProfitGuardService],
  controllers: [AiOpsController],
  exports: [PricingService, ProfitGuardService],
})
export class AiOpsModule {}
