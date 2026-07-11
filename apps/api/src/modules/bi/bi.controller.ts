import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BiService } from './bi.service';
import { ForecastJob } from './forecast.job';

/**
 * Phase 5 §11 — BI Analytics & Forecasting admin endpoints.
 *
 * Permission model mirrors admin.controller.ts: permission-string RBAC via
 * PermissionsGuard + @RequirePermissions.  All mutating actions write to
 * audit_logs before returning (§9.7 pattern).
 *
 * Routes:
 *   GET  /admin/analytics/enterprise  → live enterprise KPIs
 *   GET  /admin/forecasts             → latest forecast rows (filter: ?metric=)
 *   POST /admin/forecasts/generate    → trigger forecast generation now (audited)
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BiController {
  constructor(
    private readonly bi: BiService,
    private readonly forecastJob: ForecastJob,
    private readonly prisma: PrismaService,
  ) {}

  @Get('analytics/enterprise')
  @RequirePermissions('admin:revenue')
  async enterpriseMetrics() {
    return this.bi.enterpriseMetrics();
  }

  @Get('forecasts')
  @RequirePermissions('admin:revenue')
  async forecasts(@Query('metric') metric?: string) {
    return this.bi.latestForecasts(metric);
  }

  @Post('forecasts/generate')
  @RequirePermissions('admin:revenue')
  async generateForecasts(@CurrentUser() admin: JwtPayload) {
    // Audit before the action (§9.7 pattern)
    await this.prisma.auditLog.create({
      data: {
        userId: admin.sub,
        action: 'admin:forecasts:generate',
        target: 'forecasts',
        meta: { triggeredBy: 'manual' } as never,
      },
    });

    await this.forecastJob.run();
    return { ok: true, message: 'Forecast generation triggered' };
  }
}
