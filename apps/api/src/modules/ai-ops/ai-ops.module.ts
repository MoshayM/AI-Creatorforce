import { Module } from '@nestjs/common';
import { ProviderRegistryService } from './provider-registry.service';
import { PricingService } from './pricing.service';
import { ProfitGuardService } from './profit-guard.service';
import { AiOpsController } from './ai-ops.controller';
import { AiCacheAdapter } from './ai-cache.adapter';

// Kill-switch: AI_RESPONSE_CACHE_ENABLED=false disables Redis cache adapter
const cacheEnabled = process.env['AI_RESPONSE_CACHE_ENABLED'] !== 'false';

@Module({
  providers: [
    ProviderRegistryService,
    PricingService,
    ProfitGuardService,
    ...(cacheEnabled ? [AiCacheAdapter] : []),
  ],
  controllers: [AiOpsController],
  exports: [PricingService, ProfitGuardService],
})
export class AiOpsModule {}
