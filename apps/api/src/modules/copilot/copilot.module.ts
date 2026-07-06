import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ShortsStudioModule } from '../shorts-studio/shorts-studio.module';
import { CopilotService } from './copilot.service';
import { CopilotController } from './copilot.controller';

@Module({
  imports: [JobsModule, ApprovalsModule, ShortsStudioModule],
  controllers: [CopilotController],
  providers: [CopilotService],
  exports: [CopilotService],
})
export class CopilotModule {}
