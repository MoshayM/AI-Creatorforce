import { Controller, Get, Post, Param, UseGuards, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { Request } from 'express';

interface AuthReq extends Request {
  user: { id: string; email: string };
}

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':channelId/overview')
  async overview(@Param('channelId') channelId: string, @Req() req: AuthReq) {
    return this.analytics.getChannelOverview(channelId, req.user.id);
  }

  @Post(':channelId/report')
  async report(@Param('channelId') channelId: string, @Req() req: AuthReq) {
    return this.analytics.generateReport(channelId, req.user.id);
  }
}
