import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { TokenEncryptionService } from './token-encryption.service';
import { LibraryService } from './library.service';
import { ChannelSyncService } from './channel-sync.service';
import { LibraryController } from './library.controller';
import { AGENT_QUEUE } from '../jobs/jobs.constants';

@Module({
  imports: [BullModule.registerQueue({ name: AGENT_QUEUE })],
  providers: [ChannelsService, TokenEncryptionService, LibraryService, ChannelSyncService],
  controllers: [ChannelsController, LibraryController],
  exports: [ChannelsService, TokenEncryptionService, LibraryService, ChannelSyncService],
})
export class ChannelsModule {}
