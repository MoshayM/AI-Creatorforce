import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { TrialExpiryJob } from './trial-expiry.job';

@Module({
  providers: [NotificationsService, TrialExpiryJob],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
