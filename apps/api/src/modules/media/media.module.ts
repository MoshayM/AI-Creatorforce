import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { StorageService } from './storage.service';
import { R2StorageService } from './r2-storage.service';
import { ExportsService } from './exports.service';
import { MediaController } from './media.controller';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    ExportsService,
    {
      provide: StorageService,
      useFactory: (): StorageService =>
        process.env['STORAGE_BACKEND'] === 'r2'
          ? new R2StorageService()
          : new StorageService(),
    },
  ],
  exports: [MediaService, StorageService, ExportsService],
})
export class MediaModule {}
