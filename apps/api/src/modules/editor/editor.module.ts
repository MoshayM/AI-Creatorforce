import { Module } from '@nestjs/common';
import { EditorService } from './editor.service';
import { EditorController } from './editor.controller';
import { JobsModule } from '../jobs/jobs.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [JobsModule, MediaModule],
  providers: [EditorService],
  controllers: [EditorController],
  exports: [EditorService],
})
export class EditorModule {}
