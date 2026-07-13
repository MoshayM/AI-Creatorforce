import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ApprovalsService } from './approvals.service';

class ReviewDto {
  @IsOptional() @IsString() notes?: string;
}

@ApiTags('approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly svc: ApprovalsService) {}

  @Get('pending')
  listPending(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listPending(user.sub, { cursor, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Get('history')
  listHistory(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listHistory(user.sub, { cursor, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: ReviewDto, @CurrentUser() user: JwtPayload) {
    return this.svc.approve(id, user.sub, dto.notes);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: ReviewDto, @CurrentUser() user: JwtPayload) {
    return this.svc.reject(id, user.sub, dto.notes);
  }
}
