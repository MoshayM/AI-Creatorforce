import { Module } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { ChannelsModule } from '../channels/channels.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [ChannelsModule, MediaModule],
  providers: [PublishingService],
  controllers: [PublishingController],
  exports: [PublishingService],
})
export class PublishingModule {}
