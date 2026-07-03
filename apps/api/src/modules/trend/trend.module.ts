import { Module } from '@nestjs/common';
import { TrendService } from './trend.service';
import { TrendController } from './trend.controller';

@Module({
  providers: [TrendService],
  controllers: [TrendController],
  exports: [TrendService],
})
export class TrendModule {}
