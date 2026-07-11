import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrgsService } from './orgs.service';
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
}
