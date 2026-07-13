import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { JobReaperJob } from './job-reaper.job';
import { AGENT_QUEUE } from './jobs.constants';
export { AGENT_QUEUE } from './jobs.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: AGENT_QUEUE }),
  ],
  providers: [JobsService, JobReaperJob],
  controllers: [JobsController],
  exports: [JobsService, BullModule],
})
export class JobsModule {}
