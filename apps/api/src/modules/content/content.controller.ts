import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ContentService } from './content.service';

class ResearchDto {
  @IsString() topic!: string;
  @IsOptional() @IsString() niche?: string;
  @IsOptional() @IsString() targetLang?: string;
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
}
