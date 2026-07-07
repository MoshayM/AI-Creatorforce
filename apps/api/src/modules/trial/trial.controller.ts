import { Body, Controller, Get, Param, Patch, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrialService } from './trial.service';
import { TRIAL_FEATURES, TrialLimitsService, type TrialFeature } from './trial-limits.service';
import { UpgradeEngineService } from './upgrade-engine.service';
import { OffersService } from './offers.service';

@Controller('trial')
@UseGuards(JwtAuthGuard)
export class TrialController {
  constructor(
    private readonly trial: TrialService,
    private readonly limits: TrialLimitsService,
  ) {}

  @Get('status')
  async status(@CurrentUser() user: JwtPayload) {
    return this.trial.status(user.sub);
  }

  @Get('limits')
  async limitsFor(@CurrentUser() user: JwtPayload) {
    return {
      isTrialUser: await this.limits.isTrialUser(user.sub),
      limits: await this.limits.effectiveLimits(),
    };
  }
}

@Controller('upgrade')
@UseGuards(JwtAuthGuard)
export class UpgradeController {
  constructor(private readonly upgrade: UpgradeEngineService) {}

  @Get('recommendations')
  async recommendations(@CurrentUser() user: JwtPayload) {
    return this.upgrade.recommendationsFor(user.sub);
  }

  @Post('recommendations/:id/dismiss')
  async dismiss(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.upgrade.dismiss(id, user.sub);
  }
}

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TrialAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trial: TrialService,
  ) {}

  @Get('trial-config')
  @RequirePermissions('admin:trial')
  async config() {
    return {
      trialCredits: Number(process.env['TRIAL_CREDITS']) || 100,
      expiryDays: Number(process.env['TRIAL_EXPIRY_DAYS']) || 15,
      limits: await this.prisma.trialLimit.findMany({ orderBy: { feature: 'asc' } }),
    };
  }

  @Patch('trial-config')
  @RequirePermissions('admin:trial')
  async patchConfig(
    @Body() dto: { feature: string; access: 'enabled' | 'limited' | 'disabled'; limitValue?: number | null },
    @CurrentUser() admin: JwtPayload,
  ) {
    if (!TRIAL_FEATURES.includes(dto.feature as TrialFeature)) {
      throw new BadRequestException(`Unknown trial feature "${dto.feature}" — known: ${TRIAL_FEATURES.join(', ')}`);
    }
    if (!['enabled', 'limited', 'disabled'].includes(dto.access)) throw new BadRequestException('Invalid access value');
    const row = await this.prisma.trialLimit.upsert({
      where: { feature: dto.feature },
      create: { feature: dto.feature, access: dto.access, limitValue: dto.limitValue ?? null },
      update: { access: dto.access, limitValue: dto.limitValue ?? null },
    });
    await this.prisma.auditLog.create({
      data: { userId: admin.sub, action: 'admin:trial-config', target: dto.feature, meta: dto as never },
    });
    return row;
  }

  @Get('abuse-signals')
  @RequirePermissions('admin:trial')
  async abuseSignals() {
    return this.prisma.abuseSignal.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Post('trial/:userId/approve')
  @RequirePermissions('admin:trial')
  async approve(@Param('userId') userId: string, @CurrentUser() admin: JwtPayload) {
    return this.trial.approvePendingTrial(userId, admin.sub);
  }
}

@Controller('admin/offers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OffersAdminController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @RequirePermissions('admin:trial')
  async list() {
    return this.offers.listOffers();
  }

  @Post()
  @RequirePermissions('admin:trial')
  async create(
    @Body() dto: { type: 'FIRST_RECHARGE' | 'WELCOME'; name: string; rewardValue: number; minRechargeMinor?: number; validTo?: string; usageLimit?: number },
    @CurrentUser() admin: JwtPayload,
  ) {
    if (!dto?.name || !Number.isInteger(dto.rewardValue) || dto.rewardValue < 1) {
      throw new BadRequestException('name and a positive integer rewardValue are required');
    }
    return this.offers.createOffer(dto, admin.sub);
  }
}
