import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsDateString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
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

@ApiTags('publishing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('publishing')
export class PublishingController {
  constructor(private readonly svc: PublishingService) {}

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
