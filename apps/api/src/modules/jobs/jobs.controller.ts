import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { JobsService } from './jobs.service';
import type { JobType } from '@cf/shared';

class EnqueueDto {
  @IsString() projectId!: string;
  @IsString() type!: string;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

@ApiTags('jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly svc: JobsService) {}

  @Post()
  enqueue(@Body() dto: EnqueueDto, @CurrentUser() _user: JwtPayload) {
    return this.svc.enqueue(dto.projectId, dto.type as JobType, dto.payload);
  }

  @Get('project/:projectId')
  listByProject(@Param('projectId') projectId: string) {
    return this.svc.listByProject(projectId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.svc.cancel(id);
  }
}
