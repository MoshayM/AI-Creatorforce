import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TrendService } from './trend.service';

class TrendDto {
  @IsString() niche!: string;
  @IsOptional() @IsNumber() channelSize?: number;
}

@ApiTags('trends')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trends')
export class TrendController {
  constructor(private readonly svc: TrendService) {}

  @Post('analyze')
  analyze(@Body() dto: TrendDto) {
    return this.svc.analyze(dto.niche, dto.channelSize);
  }
}
