import { Module } from '@nestjs/common';
import { RenderService } from './render.service';
import { RenderController } from './render.controller';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JobsModule],
  providers: [RenderService],
  controllers: [RenderController],
  exports: [RenderService],
})
export class RenderModule {}
