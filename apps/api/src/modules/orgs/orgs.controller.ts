import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrgsService, usageReportCsv } from './orgs.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { SetBudgetDto } from './dto/set-budget.dto';

@UseGuards(JwtAuthGuard)
@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /** POST /orgs — create a new organisation (caller becomes ORG_ADMIN) */
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrgDto) {
    return this.orgs.create(user.sub, dto.name, dto.billingEmail);
  }

  /** GET /orgs/mine — all orgs the authenticated user belongs to */
  @Get('mine')
  mine(@CurrentUser() user: JwtPayload) {
    return this.orgs.myOrgs(user.sub);
  }

  /** POST /orgs/:id/members — add or update a member (requires MANAGE_ORG) */
  @Post(':id/members')
  addMember(
    @CurrentUser() user: JwtPayload,
    @Param('id') orgId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.orgs.addMember(user.sub, orgId, dto);
  }

  /** GET /orgs/:id/members — list members (any org member) */
  @Get(':id/members')
  members(@CurrentUser() user: JwtPayload, @Param('id') orgId: string) {
    return this.orgs.members(user.sub, orgId);
  }

  /** PUT /orgs/:id/budget — create a budget period (requires MANAGE_BUDGET) */
  @Put(':id/budget')
  setBudget(
    @CurrentUser() user: JwtPayload,
    @Param('id') orgId: string,
    @Body() dto: SetBudgetDto,
  ) {
    return this.orgs.setBudget(user.sub, orgId, {
      teamId: dto.teamId,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      allocatedCredits: dto.allocatedCredits,
      hardCap: dto.hardCap,
    });
  }

  /** GET /orgs/:id/budget?teamId= — current budget status */
  @Get(':id/budget')
  budgetStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') orgId: string,
    @Query('teamId') teamId?: string,
  ) {
    return this.orgs.budgetStatus(user.sub, orgId, teamId);
  }

  /**
   * GET /orgs/:id/reports/usage?from=&to=&teamId=&format=json|csv
   * Per-member usage rollup (spec §10). Requires VIEW_REPORTS.
   * format=csv streams a text/csv attachment; default is JSON.
   */
  @Get(':id/reports/usage')
  async usageReport(
    @CurrentUser() user: JwtPayload,
    @Param('id') orgId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('teamId') teamId?: string,
    @Query('format') format?: string,
  ) {
    const parseDate = (label: string, v?: string): Date | undefined => {
      if (!v) return undefined;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid ${label} date`);
      return d;
    };

    const report = await this.orgs.usageReport(user.sub, orgId, {
      from: parseDate('from', from),
      to: parseDate('to', to),
      teamId,
    });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="org-usage-${orgId}.csv"`);
      return usageReportCsv(report);
    }
    return report;
  }
}
