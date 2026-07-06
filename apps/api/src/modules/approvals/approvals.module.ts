import { Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { GatewayModule } from '../../gateway/gateway.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [GatewayModule, JobsModule],
  providers: [ApprovalsService],
  controllers: [ApprovalsController],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
