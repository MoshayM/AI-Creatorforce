import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { StorageService } from './storage.service';
import { ExportsService } from './exports.service';
import { MediaController } from './media.controller';

@Module({
  controllers: [MediaController],
  providers: [MediaService, StorageService, ExportsService],
  exports: [MediaService, StorageService, ExportsService],
})
export class MediaModule {}
