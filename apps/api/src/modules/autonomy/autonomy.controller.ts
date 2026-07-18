import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { CalendarEntryStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { AutonomyService } from './autonomy.service';

class GenerateCalendarDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) weeks?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(7) perWeek?: number;
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

class ListCalendarDto {
  @IsOptional()
  @IsIn(['PROPOSED', 'APPROVED', 'DISMISSED', 'SCHEDULED'])
  status?: CalendarEntryStatus;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

class GetProfileDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  refresh?: boolean;
}

@ApiTags('autonomy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('autonomy')
export class AutonomyController {
  constructor(private readonly svc: AutonomyService) {}

  @Get('channels/:channelId/profile')
  profile(
    @Param('channelId') channelId: string,
    @Query() dto: GetProfileDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.getProfile(channelId, user.sub, dto.refresh ?? false);
  }

  @Post('channels/:channelId/calendar/generate')
  generate(
    @Param('channelId') channelId: string,
    @Body() dto: GenerateCalendarDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.generateCalendar(channelId, user.sub, dto);
  }

  /** Async variant: returns a jobId immediately; poll GET /jobs/:id for completion. */
  @Post('channels/:channelId/calendar/generate-async')
  generateAsync(
    @Param('channelId') channelId: string,
    @Body() dto: GenerateCalendarDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.generateCalendarQueued(channelId, user.sub, dto);
  }

  @Get('channels/:channelId/calendar/stats')
  calendarStats(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.getCalendarStats(channelId, user.sub);
  }

  @Get('channels/:channelId/calendar')
  list(
    @Param('channelId') channelId: string,
    @Query() dto: ListCalendarDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.listCalendar(channelId, user.sub, {
      status: dto.status,
      from: dto.from ? new Date(dto.from) : undefined,
      to: dto.to ? new Date(dto.to) : undefined,
    });
  }

  @Post('calendar/:entryId/approve')
  approve(@Param('entryId') entryId: string, @CurrentUser() user: JwtPayload) {
    return this.svc.approve(entryId, user.sub);
  }

  @Post('calendar/:entryId/dismiss')
  dismiss(@Param('entryId') entryId: string, @CurrentUser() user: JwtPayload) {
    return this.svc.dismiss(entryId, user.sub);
  }

  @Post('channels/:channelId/calendar/bulk-approve')
  bulkApprove(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { ids: string[] },
  ) {
    return this.svc.bulkApprove(channelId, user.sub, body.ids);
  }

  @Post('channels/:channelId/calendar/bulk-dismiss')
  bulkDismiss(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { ids: string[] },
  ) {
    return this.svc.bulkDismiss(channelId, user.sub, body.ids);
  }

  @Patch('calendar/:entryId/title')
  updateTitle(
    @Param('entryId') entryId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { title: string },
  ) {
    return this.svc.updateEntryTitle(entryId, user.sub, body.title);
  }

  @Post('channels/:channelId/profile/feedback')
  recordFeedback(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { ytVideoId: string; views: number; likeCount?: number; ctr?: number; avgViewDurationSecs?: number },
  ) {
    return this.svc.recordPerformanceFeedback(channelId, user.sub, body);
  }

  @Get('insights/cross-channel')
  crossChannelInsights(@CurrentUser() user: JwtPayload) {
    return this.svc.getCrossChannelInsights(user.sub);
  }

  @Post('channels/:channelId/goal-plan')
  goalDecompose(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { goal: string; timeframeWeeks?: number },
  ) {
    return this.svc.goalDecompose(channelId, user.sub, body.goal, body.timeframeWeeks ?? 8);
  }

  @Get('channels/:channelId/audit-log')
  auditLog(
    @Param('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
    @Query('take') take?: string,
  ) {
    return this.svc.getAuditLog(channelId, user.sub, take ? parseInt(take, 10) : 50);
  }
}
