import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { JobsModule } from '../jobs/jobs.module';
import { ShortsStudioModule } from '../shorts-studio/shorts-studio.module';
import { AutonomyModule } from '../autonomy/autonomy.module';

@Module({
  imports: [JobsModule, ShortsStudioModule, AutonomyModule],
  controllers: [AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
