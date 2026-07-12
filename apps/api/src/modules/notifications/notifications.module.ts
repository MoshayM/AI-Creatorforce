import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TrialExpiryJob } from './trial-expiry.job';
import { LotExpiryJob } from './lot-expiry.job';

@Module({
  providers: [NotificationsService, TrialExpiryJob, LotExpiryJob],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
