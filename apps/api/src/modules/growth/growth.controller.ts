import { Controller, Post, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { GrowthService } from './growth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { Request } from 'express';

interface AuthReq extends Request {
  user: { id: string; email: string };
}

@Controller('growth')
@UseGuards(JwtAuthGuard)
export class GrowthController {
  constructor(private readonly growth: GrowthService) {}

  @Post('report')
  async report(
    @Body() body: { channelId: string; analyticsReport: unknown },
    @Req() req: AuthReq,
  ) {
    return this.growth.generateRecommendations(body.channelId, body.analyticsReport as never, req.user.id);
  }
}
