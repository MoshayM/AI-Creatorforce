import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AudienceService } from './audience.service';

class AudienceDto {
  @IsString() niche!: string;
  @IsOptional() @IsArray() recentTopics?: string[];
}

@ApiTags('audience')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audience')
export class AudienceController {
  constructor(private readonly svc: AudienceService) {}

  @Post('analyze')
  analyze(@Body() dto: AudienceDto) {
    return this.svc.analyze(dto.niche, dto.recentTopics);
  }
}
