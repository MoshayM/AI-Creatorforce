import { Module } from '@nestjs/common';
import { PublishAccessService } from './publish-access.service';
import { PublishAccessController } from './publish-access.controller';

@Module({
  controllers: [PublishAccessController],
  providers: [PublishAccessService],
  exports: [PublishAccessService],
})
export class PublishAccessModule {}
