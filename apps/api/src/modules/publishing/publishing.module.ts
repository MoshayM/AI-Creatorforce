import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { ChannelsModule } from '../channels/channels.module';
import { PublishAccessModule } from '../publish-access/publish-access.module';

@Module({
  imports: [ChannelsModule, PublishAccessModule],
  providers: [PublishingService],
  controllers: [PublishingController],
  exports: [PublishingService],
})
export class PublishingModule {}
