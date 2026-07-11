import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrialService } from './trial.service';
import { TrialLimitsService } from './trial-limits.service';
import { UpgradeEngineService } from './upgrade-engine.service';
import { OffersService } from './offers.service';
import { MarketplaceService } from './marketplace.service';
import { ReferralService } from './referral.service';
import {
  TrialController, TrialAdminController, UpgradeController,
  OffersController, OffersAdminController, MarketplaceController, MarketplaceAdminController,
  ReferralController, ReferralAdminController,
} from './trial.controller';

@Module({
  imports: [WalletModule, NotificationsModule],
  providers: [TrialService, TrialLimitsService, UpgradeEngineService, OffersService, MarketplaceService, ReferralService],
  controllers: [
    TrialController, TrialAdminController, UpgradeController,
    OffersController, OffersAdminController, MarketplaceController, MarketplaceAdminController,
    ReferralController, ReferralAdminController,
  ],
  exports: [TrialService, TrialLimitsService, OffersService, MarketplaceService, ReferralService],
})
export class TrialModule {}
