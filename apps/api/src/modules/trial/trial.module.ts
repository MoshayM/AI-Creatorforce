import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { TrialService } from './trial.service';
import { TrialLimitsService } from './trial-limits.service';
import { TrialController, TrialAdminController } from './trial.controller';

@Module({
  imports: [WalletModule],
  providers: [TrialService, TrialLimitsService],
  controllers: [TrialController, TrialAdminController],
  exports: [TrialService, TrialLimitsService],
})
export class TrialModule {}
