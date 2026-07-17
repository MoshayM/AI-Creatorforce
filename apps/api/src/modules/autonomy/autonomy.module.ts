import { Module } from '@nestjs/common';
import { AutonomyService } from './autonomy.service';
import { AutonomyController } from './autonomy.controller';
import { TrendModule } from '../trend/trend.module';

@Module({
  imports: [TrendModule],
  providers: [AutonomyService],
  controllers: [AutonomyController],
  exports: [AutonomyService],
})
export class AutonomyModule {}
