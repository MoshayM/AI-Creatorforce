import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsNumber } from 'class-validator';
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

class ScoreScriptDto {
  @IsString() scriptText!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() niche?: string;
}

class ABTestDto {
  @IsString() title!: string;
  @IsString() niche!: string;
  @IsOptional() currentCtr?: number;
  @IsOptional() @IsString() description?: string;
}

class SeriesPlanDto {
  @IsString() topic!: string;
  @IsString() niche!: string;
  @IsNumber() episodeCount!: number;
  @IsOptional() @IsString() targetAudience?: string;
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

  @Post('score-script')
  scoreScript(@Body() dto: ScoreScriptDto) {
    return this.svc.scoreScript(dto.scriptText, dto.title, dto.niche);
  }

  @Post('ab-test')
  generateABTest(@Body() dto: ABTestDto) {
    return this.svc.generateABTest(dto.title, dto.niche, dto.currentCtr, dto.description);
  }

  @Post('series-plan')
  planSeries(@Body() dto: SeriesPlanDto) {
    return this.svc.planSeries(dto.topic, dto.episodeCount, dto.niche, dto.targetAudience);
  }
}
