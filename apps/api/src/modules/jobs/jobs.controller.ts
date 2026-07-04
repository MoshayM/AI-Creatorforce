import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { JobsService } from './jobs.service';
import { ScriptOutputSchema } from '@cf/shared';
import type { JobType } from '@cf/shared';

// Stage results the creator may edit inline; downstream stages read the
// edited version via lastResult(). SCRIPT is schema-validated so edits can
// never break voice/subtitle/video generation.
const OVERRIDABLE_TYPES: ReadonlySet<string> = new Set(['SCRIPT', 'TREND_ANALYSIS', 'MUSIC_BRIEF', 'METADATA']);

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

  // Human edits to a stage result — stored as a new COMPLETED job so the
  // pipeline's resume/caching and downstream lastResult() reads pick it up.
  @Patch('project/:projectId/override/:type')
  override(
    @Param('projectId') projectId: string,
    @Param('type') type: string,
    @Body() body: { result: Record<string, unknown> },
  ) {
    if (!OVERRIDABLE_TYPES.has(type)) {
      throw new BadRequestException(`Stage ${type} is not editable`);
    }
    if (!body?.result || typeof body.result !== 'object') {
      throw new BadRequestException('result object is required');
    }
    let result: unknown = body.result;
    if (type === 'SCRIPT') {
      const parsed = ScriptOutputSchema.safeParse(body.result);
      if (!parsed.success) {
        throw new BadRequestException(`Edited script is invalid: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
      result = parsed.data;
    }
    return this.svc.overrideResult(projectId, type as JobType, result);
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
