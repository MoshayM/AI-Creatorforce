import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrialService } from './trial.service';
import { TRIAL_FEATURES, TrialLimitsService, type TrialFeature } from './trial-limits.service';
import { UpgradeEngineService } from './upgrade-engine.service';
import { OffersService } from './offers.service';
import { MarketplaceService } from './marketplace.service';
import { ReferralService } from './referral.service';

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

@Controller('offers')
@UseGuards(JwtAuthGuard)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  async mine(@CurrentUser() user: JwtPayload) {
    return this.offers.offersFor(user.sub);
  }

  @Post(':id/redeem')
  async redeem(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.offers.redeem(id, user.sub);
  }
}

@Controller('marketplace')
@UseGuards(JwtAuthGuard)
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('packs')
  async packs(@Query('region') region?: string) {
    return this.marketplace.listPacks(region);
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

  @Get('analytics/conversion-funnel')
  @RequirePermissions('admin:trial')
  async conversionFunnel() {
    const [signups, trialsTotal, trialActive, trialConverted, firstRechargeGroups, subscriptions] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.trialGrant.count(),
      this.prisma.trialGrant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.trialGrant.count({ where: { status: 'CONVERTED' } }),
      this.prisma.payment.groupBy({ by: ['userId'], where: { status: 'SUCCEEDED' } }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    ]);
    const firstRecharges = firstRechargeGroups.length;
    return {
      signups,
      trials: trialsTotal,
      trialActive,
      trialConverted,
      firstRecharges,
      subscriptions,
      conversionPct: {
        trialToRecharge: trialsTotal > 0 ? Number((firstRecharges / trialsTotal * 100).toFixed(1)) : 0,
        rechargeToSubscription: firstRecharges > 0 ? Number((subscriptions / firstRecharges * 100).toFixed(1)) : 0,
      },
    };
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
    @Body() dto: { type: 'FIRST_RECHARGE' | 'WELCOME' | 'LOYALTY' | 'WINBACK' | 'LOW_CREDIT'; name: string; rewardValue: number; minRechargeMinor?: number; validTo?: string; usageLimit?: number; targetRule?: Record<string, number> },
    @CurrentUser() admin: JwtPayload,
  ) {
    if (!dto?.name || !Number.isInteger(dto.rewardValue) || dto.rewardValue < 1) {
      throw new BadRequestException('name and a positive integer rewardValue are required');
    }
    return this.offers.createOffer(dto, admin.sub);
  }
}

@Controller('admin/credit-packs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MarketplaceAdminController {
  constructor(private readonly marketplace: MarketplaceService, private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('admin:pricing')
  async list() {
    return this.prisma.creditPack.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }] });
  }

  @Post()
  @RequirePermissions('admin:pricing')
  async create(
    @Body() dto: { name: string; credits: number; priceMinor: number; currency?: string; region?: string; sortOrder?: number },
    @CurrentUser() admin: JwtPayload,
  ) {
    if (!dto?.name) throw new BadRequestException('name is required');
    return this.marketplace.createPack(dto, admin.sub);
  }

  @Patch(':id/active')
  @RequirePermissions('admin:pricing')
  async toggle(@Param('id') id: string, @Body() dto: { isActive: boolean }, @CurrentUser() admin: JwtPayload) {
    if (typeof dto?.isActive !== 'boolean') throw new BadRequestException('isActive must be a boolean');
    return this.marketplace.setPackActive(id, dto.isActive, admin.sub);
  }
}

class RedeemReferralDto {
  @IsString()
  code!: string;

  @IsString()
  deviceFingerprint?: string;
}

class ReviewReferralDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';
}

@Controller('referral')
@UseGuards(JwtAuthGuard)
export class ReferralController {
  constructor(private readonly referral: ReferralService) {}

  @Post('code')
  async code(@CurrentUser() user: JwtPayload) {
    return this.referral.getOrCreateCode(user.sub);
  }

  @Post('redeem')
  async redeem(
    @Body() dto: RedeemReferralDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: import('express').Request,
  ) {
    if (!dto?.code) throw new BadRequestException('code is required');
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress;
    return this.referral.redeem(user.sub, dto.code, { deviceFingerprint: dto.deviceFingerprint, ip });
  }

  @Get('earnings')
  async earnings(@CurrentUser() user: JwtPayload) {
    return this.referral.earnings(user.sub);
  }

  @Get('leaderboard')
  async leaderboard() {
    return this.referral.leaderboard();
  }
}

@Controller('admin/referrals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReferralAdminController {
  constructor(private readonly referral: ReferralService) {}

  @Get()
  @RequirePermissions('admin:trial')
  async list(@Query('status') status?: string) {
    return this.referral.listFlagged(status);
  }

  @Post(':id/review')
  @RequirePermissions('admin:trial')
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewReferralDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    if (!dto?.decision || !['APPROVE', 'REJECT'].includes(dto.decision)) {
      throw new BadRequestException('decision must be APPROVE or REJECT');
    }
    return this.referral.review(id, dto.decision, admin.sub);
  }
}
