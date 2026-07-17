import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsDateString, IsIn, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { VideoStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PublishingService } from './publishing.service';

class PublishDto {
  @IsString() videoId!: string;
  @IsString() channelId!: string;
  @IsString() title!: string;
  @IsString() description!: string;
  @IsArray() tags!: string[];
  @IsString() approvalId!: string;
  @IsOptional() @IsDateString() scheduledAt?: string;
}

const TRACKED_STATUSES = ['SCHEDULED', 'PUBLISHED', 'FAILED'] as const;

class ListTrackedVideosDto {
  @IsOptional() @IsString() channelId?: string;
  /** Comma-separated subset of SCHEDULED,PUBLISHED,FAILED. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsIn(TRACKED_STATUSES, { each: true })
  status?: VideoStatus[];
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) take?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
}

@ApiTags('publishing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('publishing')
export class PublishingController {
  constructor(private readonly svc: PublishingService) {}

  @Get('videos')
  listTracked(@Query() dto: ListTrackedVideosDto, @CurrentUser() user: JwtPayload) {
    return this.svc.listTracked(user.sub, {
      channelId: dto.channelId,
      status: dto.status,
      from: dto.from ? new Date(dto.from) : undefined,
      to: dto.to ? new Date(dto.to) : undefined,
      q: dto.q,
      take: dto.take,
      skip: dto.skip,
    });
  }

  @Get('videos/summary')
  trackingSummary(@Query('channelId') channelId: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.svc.trackingSummary(user.sub, channelId || undefined);
  }

  @Post('publish')
  publish(@Body() dto: PublishDto) {
    return this.svc.publish(
      {
        videoId: dto.videoId,
        channelId: dto.channelId,
        title: dto.title,
        description: dto.description,
        tags: dto.tags,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
      },
      dto.approvalId,
    );
  }
}
