import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ContentService } from './content.service';
import type { RepurposePlatform } from '@cf/shared';

class ResearchDto {
  @IsString() topic!: string;
  @IsOptional() @IsString() niche?: string;
  @IsOptional() @IsString() targetLang?: string;
}

class RepurposeDto {
  @IsString() scriptText!: string;
  @IsString() title!: string;
  @IsArray() platforms!: RepurposePlatform[];
}

@ApiTags('content')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('content')
export class ContentController {
  constructor(private readonly svc: ContentService) {}

  @Post('research')
  research(@Body() dto: ResearchDto) {
    return this.svc.research(dto.topic, dto.niche, dto.targetLang);
  }

  @Post('repurpose')
  repurpose(@Body() dto: RepurposeDto) {
    return this.svc.repurpose(dto.scriptText, dto.title, dto.platforms);
  }
}
