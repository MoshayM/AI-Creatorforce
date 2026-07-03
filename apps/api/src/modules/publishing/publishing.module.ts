import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [ChannelsModule],
  providers: [PublishingService],
  controllers: [PublishingController],
  exports: [PublishingService],
})
export class PublishingModule {}
