import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobsService } from './jobs.service';

/**
 * DLQ surface (Updates/35): inspect dead jobs and replay them. Permission-string
 * RBAC like every admin route; replays are audit-logged before the response.
 */
@Controller('admin/jobs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminJobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  /** Recent dead jobs (FAILED/CANCELLED), newest first. */
  @Get('failed')
  @RequirePermissions('admin:jobs')
  async failed(@Query('take') take?: string) {
    return this.prisma.agentJob.findMany({
      where: { status: { in: ['FAILED', 'CANCELLED'] } },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(parseInt(take ?? '50', 10) || 50, 200),
      select: { id: true, projectId: true, type: true, status: true, error: true, attempts: true, createdAt: true, updatedAt: true },
    });
  }

  // 202: the replay is queued, not done (Updates/16 — async ops return 202 + job id)
  @Post(':id/replay')
  @RequirePermissions('admin:jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  async replay(@Param('id') id: string, @CurrentUser() admin: JwtPayload) {
    const fresh = await this.jobs.replayFailed(id);
    await this.prisma.auditLog.create({
      data: {
        userId: admin.sub,
        action: 'admin:job-replay',
        target: id,
        meta: { freshJobId: fresh.id, type: fresh.type } as never,
      },
    });
    return { id: fresh.id, type: fresh.type, status: fresh.status, replayedFrom: id };
  }
}
