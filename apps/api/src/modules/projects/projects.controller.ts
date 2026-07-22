import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';

class CreateProjectDto {
  @IsOptional() @IsString() channelId?: string;
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() niche?: string;
  @IsOptional() @IsString() targetLang?: string;
  /** Phase 5 §10: bill agent-job spend to this org; empty string clears. */
  @IsOptional() @IsString() billingOrgId?: string;
  @IsOptional() @IsString() contentFormat?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) platforms?: string[];
}

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: JwtPayload) {
    return this.svc.create(user.sub, dto);
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.list(user.sub, { cursor, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.get(user.sub, id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateProjectDto>, @CurrentUser() user: JwtPayload) {
    return this.svc.update(user.sub, id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.delete(user.sub, id);
  }
}
