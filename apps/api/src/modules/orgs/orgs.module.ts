import { Module } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { OrgsController } from './orgs.controller';
import { BudgetRolloverJob } from './budget-rollover.job';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    WalletModule,        // exports WalletService + BudgetService
    NotificationsModule, // exports NotificationsService
  ],
  providers: [OrgsService, BudgetRolloverJob],
  controllers: [OrgsController],
  exports: [OrgsService],
})
export class OrgsModule {}
