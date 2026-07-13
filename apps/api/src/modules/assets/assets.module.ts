import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { AssetGcJob } from './asset-gc.job';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [MediaModule],
  providers: [AssetsService, AssetGcJob],
  controllers: [AssetsController],
  exports: [AssetsService],
})
export class AssetsModule {}
