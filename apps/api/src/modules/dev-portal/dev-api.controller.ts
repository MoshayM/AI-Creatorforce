import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { JobTypeSchema, type JobType } from '@cf/shared';
import { DeveloperKeyGuard, RequireScope } from './developer-key.guard';
import { WalletService } from '../wallet/wallet.service';
import { ChannelsService } from '../channels/channels.service';
import { ProjectsService } from '../projects/projects.service';
import { JobsService } from '../jobs/jobs.service';

interface DevKeyUser {
  sub: string;
  scopes: string[];
  sandbox: boolean;
  developerKeyId: string;
}

class DevEnqueueDto {
  @IsString() type!: string;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

/**
 * Public developer API surface — authenticated via DeveloperKeyGuard.
 *
 * Sandbox note: sandbox keys are accepted here. Routes that would spend
 * real credits MUST check `req.user.sandbox` and reject or use play-money —
 * job enqueue below is the first such route.
 *
 * Ownership: every project/job route resolves through the key owner's
 * userId (ProjectsService.get is ownership-scoped), so a key can never
 * touch another user's resources regardless of scopes.
 */
@ApiTags('developer-api')
@ApiSecurity('api-key')
@Controller('dev-api/v1')
@UseGuards(DeveloperKeyGuard)
export class DevApiController {
  constructor(
    private readonly wallet: WalletService,
    private readonly channels: ChannelsService,
    private readonly projects: ProjectsService,
    private readonly jobs: JobsService,
  ) {}

  /** Returns the identity and capabilities associated with the API key. */
  @Get('me')
  me(@Request() req: ExpressRequest & { user: DevKeyUser }) {
    const { sub: userId, scopes, sandbox } = req.user;
    return { userId, scopes, sandbox };
  }

  /** Returns the caller's wallet balance. Requires scope: wallet:read */
  @Get('wallet/balance')
  @RequireScope('wallet:read')
  async walletBalance(@Request() req: ExpressRequest & { user: DevKeyUser }) {
    return this.wallet.getBalance(req.user.sub);
  }

  /** Returns the caller's channels (id + title only). Requires scope: channels:read */
  @Get('channels')
  @RequireScope('channels:read')
  async listMyChannels(@Request() req: ExpressRequest & { user: DevKeyUser }) {
    const all = await this.channels.listChannels(req.user.sub);
    return all.map((c) => ({ id: c.id, title: c.title }));
  }

  /** Returns the caller's projects. Requires scope: projects:read */
  @Get('projects')
  @RequireScope('projects:read')
  async listProjects(@Request() req: ExpressRequest & { user: DevKeyUser }) {
    const all = await this.projects.list(req.user.sub);
    return all.map((p) => ({ id: p.id, title: p.title, status: p.status, niche: p.niche, updatedAt: p.updatedAt }));
  }

  /** Returns one project (ownership-checked). Requires scope: projects:read */
  @Get('projects/:id')
  @RequireScope('projects:read')
  async getProject(@Request() req: ExpressRequest & { user: DevKeyUser }, @Param('id') id: string) {
    return this.projects.get(req.user.sub, id);
  }

  /** Lists a project's agent jobs. Requires scope: jobs:read */
  @Get('projects/:id/jobs')
  @RequireScope('jobs:read')
  async listJobs(@Request() req: ExpressRequest & { user: DevKeyUser }, @Param('id') id: string) {
    await this.projects.get(req.user.sub, id); // ownership gate (404 on foreign)
    const all = await this.jobs.listByProject(id);
    return all.map((j) => ({ id: j.id, type: j.type, status: j.status, error: j.error, createdAt: j.createdAt, completedAt: j.completedAt }));
  }

  /** Returns one job with its result (ownership-checked via its project). Requires scope: jobs:read */
  @Get('jobs/:id')
  @RequireScope('jobs:read')
  async getJob(@Request() req: ExpressRequest & { user: DevKeyUser }, @Param('id') id: string) {
    const job = await this.jobs.get(id);
    // Channel-scoped jobs (projectId null) are not part of the public surface.
    if (!job.projectId) throw new NotFoundException('Job not found');
    await this.projects.get(req.user.sub, job.projectId).catch(() => {
      throw new NotFoundException('Job not found');
    });
    return { id: job.id, projectId: job.projectId, type: job.type, status: job.status, result: job.result, error: job.error, createdAt: job.createdAt, completedAt: job.completedAt };
  }

  /**
   * Enqueues an agent job — the dev API's first paid AI action.
   * Requires scope: jobs:write. Sandbox keys are rejected (real credit
   * spend). Token usage from the run is attributed to this key
   * (token_usage.developerKeyId) for per-key analytics.
   */
  @Post('projects/:id/jobs')
  @RequireScope('jobs:write')
  async enqueueJob(
    @Request() req: ExpressRequest & { user: DevKeyUser },
    @Param('id') id: string,
    @Body() dto: DevEnqueueDto,
  ) {
    if (req.user.sandbox) {
      throw new ForbiddenException('Sandbox keys cannot run paid AI actions — create a live key');
    }
    const parsed = JobTypeSchema.safeParse(dto.type);
    if (!parsed.success) {
      throw new BadRequestException(`Unknown job type '${dto.type}'`);
    }
    await this.projects.get(req.user.sub, id); // ownership gate
    // Idempotency-Key (Wave 17): paid enqueues especially must not double-run
    // on a client retry — a replayed key returns the original job.
    const job = await this.jobs.enqueue(id, parsed.data as JobType, dto.payload ?? {}, {
      developerKeyId: req.user.developerKeyId,
      idempotencyKey: req.header('idempotency-key') ?? undefined,
    });
    return { id: job.id, type: job.type, status: job.status, createdAt: job.createdAt };
  }
}
