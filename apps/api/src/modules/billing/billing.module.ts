import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { WalletController } from './wallet.controller';
import { AdminController } from './admin.controller';

@Module({
  imports: [WalletModule],
  providers: [BillingService],
  controllers: [BillingController, WalletController, AdminController],
  exports: [BillingService],
})
export class BillingModule {}
