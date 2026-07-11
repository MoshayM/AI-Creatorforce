import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { BiService } from './bi.service';
import { BiController } from './bi.controller';
import { ForecastJob } from './forecast.job';

@Module({
  imports: [PrismaModule],
  providers: [BiService, ForecastJob],
  controllers: [BiController],
  exports: [BiService],
})
export class BiModule {}
