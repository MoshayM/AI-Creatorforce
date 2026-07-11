import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { TrialModule } from '../trial/trial.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingService } from './billing.service';
import { BillingJobsService } from './billing-jobs.service';
import { BillingController } from './billing.controller';
import { WalletController } from './wallet.controller';
import { AdminController } from './admin.controller';

@Module({
  imports: [WalletModule, TrialModule, NotificationsModule],
  providers: [BillingService, BillingJobsService],
  controllers: [BillingController, WalletController, AdminController],
  exports: [BillingService],
})
export class BillingModule {}
