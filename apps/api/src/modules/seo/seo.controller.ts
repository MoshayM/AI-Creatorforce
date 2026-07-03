import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SeoService } from './seo.service';

class SeoDto {
  @IsString() title!: string;
  @IsString() description!: string;
  @IsOptional() @IsString() niche?: string;
}

@ApiTags('seo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('seo')
export class SeoController {
  constructor(private readonly svc: SeoService) {}

  @Post('optimize')
  optimize(@Body() dto: SeoDto) {
    return this.svc.optimize(dto.title, dto.description, dto.niche);
  }
}
