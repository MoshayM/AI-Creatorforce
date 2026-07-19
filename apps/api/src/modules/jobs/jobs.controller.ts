import { Controller, Get, Post, Patch, Delete, Param, Body, Headers, Query, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { JobsService } from './jobs.service';
import { ScriptOutputSchema } from '@cf/shared';
import type { JobType } from '@cf/shared';
import { roleHasPermission } from '../../common/rbac';
import { MEDIA_ERROR_RETRYABLE, type MediaErrorCode } from '@cf/shared';

// Stage results the creator may edit inline; downstream stages read the
// edited version via lastResult(). SCRIPT is schema-validated so edits can
// never break voice/subtitle/video generation.
const OVERRIDABLE_TYPES: ReadonlySet<string> = new Set(['SCRIPT', 'TREND_ANALYSIS', 'MUSIC_BRIEF', 'METADATA']);

function sanitizeJob(job: Record<string, unknown>, isAdmin: boolean): Record<string, unknown> {
  const { errorDetails, errorCode, ...rest } = job as {
    errorDetails?: unknown;
    errorCode?: string;
    [key: string]: unknown;
  };
  const retryable = errorCode
    ? (MEDIA_ERROR_RETRYABLE[errorCode as MediaErrorCode] ?? true)
    : true;
  return {
    ...rest,
    errorCode: errorCode ?? null,
    retryable,
    ...(isAdmin && errorDetails !== undefined ? { errorDetails } : {}),
  };
}

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

  @Get()
  async listForUser(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.svc.listForUser(user.sub, {
      status,
      type,
      limit: limit ? Math.min(parseInt(limit, 10), 500) : 100,
    });
    const isAdmin = roleHasPermission(user.role as never, 'admin:jobs');
    return {
      ...result,
      jobs: result.jobs.map((j) => sanitizeJob(j as unknown as Record<string, unknown>, isAdmin)),
    };
  }

  // 202: the work is queued, not done (docs4/16 — async ops return 202 + job id)
  // Optional Idempotency-Key header (Wave 17): a replay returns the original job.
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  enqueue(
    @Body() dto: EnqueueDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() _user: JwtPayload,
  ) {
    return this.svc.enqueue(dto.projectId, dto.type as JobType, dto.payload, { idempotencyKey });
  }

  @Get('project/:projectId')
  async listByProject(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    const jobs = await this.svc.listByProject(projectId);
    const isAdmin = roleHasPermission(user.role as never, 'admin:jobs');
    return jobs.map((j) => sanitizeJob(j as unknown as Record<string, unknown>, isAdmin));
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
  async get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const job = await this.svc.get(id);
    const isAdmin = roleHasPermission(user.role as never, 'admin:jobs');
    return sanitizeJob(job as unknown as Record<string, unknown>, isAdmin);
  }

  // Permanent history deletion (cancel() above only stops an active job)
  @Delete(':id/record')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.remove(id, user.sub);
  }

  @Delete(':id')
  cancel(@Param('id') id: string) {
    return this.svc.cancel(id);
  }

  @Patch(':id/pause')
  pause(@Param('id') id: string) {
    return this.svc.pause(id);
  }

  @Patch(':id/resume')
  resume(@Param('id') id: string) {
    return this.svc.resume(id);
  }
}
