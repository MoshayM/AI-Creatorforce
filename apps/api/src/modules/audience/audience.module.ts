import { Module } from '@nestjs/common';
import { AudienceService } from './audience.service';
import { AudienceController } from './audience.controller';

@Module({
  providers: [AudienceService],
  controllers: [AudienceController],
  exports: [AudienceService],
})
export class AudienceModule {}
