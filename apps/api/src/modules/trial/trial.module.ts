import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { TrialService } from './trial.service';
import { TrialLimitsService } from './trial-limits.service';
import { UpgradeEngineService } from './upgrade-engine.service';
import { OffersService } from './offers.service';
import { MarketplaceService } from './marketplace.service';
import {
  TrialController, TrialAdminController, UpgradeController,
  OffersController, OffersAdminController, MarketplaceController, MarketplaceAdminController,
} from './trial.controller';

@Module({
  imports: [WalletModule],
  providers: [TrialService, TrialLimitsService, UpgradeEngineService, OffersService, MarketplaceService],
  controllers: [
    TrialController, TrialAdminController, UpgradeController,
    OffersController, OffersAdminController, MarketplaceController, MarketplaceAdminController,
  ],
  exports: [TrialService, TrialLimitsService, OffersService, MarketplaceService],
})
export class TrialModule {}
