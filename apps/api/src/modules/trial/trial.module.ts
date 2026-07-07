import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { TrialService } from './trial.service';
import { TrialLimitsService } from './trial-limits.service';
import { UpgradeEngineService } from './upgrade-engine.service';
import { OffersService } from './offers.service';
import { TrialController, TrialAdminController, UpgradeController, OffersAdminController } from './trial.controller';

@Module({
  imports: [WalletModule],
  providers: [TrialService, TrialLimitsService, UpgradeEngineService, OffersService],
  controllers: [TrialController, TrialAdminController, UpgradeController, OffersAdminController],
  exports: [TrialService, TrialLimitsService, OffersService],
})
export class TrialModule {}
