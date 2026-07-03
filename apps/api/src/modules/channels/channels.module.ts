import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { TokenEncryptionService } from './token-encryption.service';

@Module({
  providers: [ChannelsService, TokenEncryptionService],
  controllers: [ChannelsController],
  exports: [ChannelsService, TokenEncryptionService],
})
export class ChannelsModule {}
