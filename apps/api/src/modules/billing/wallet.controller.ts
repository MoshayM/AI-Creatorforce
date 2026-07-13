import { Body, Controller, Get, Headers, Post, Put, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { WalletService } from '../wallet/wallet.service';
import { BudgetService } from '../wallet/budget.service';
import { CreditInsightsService } from '../wallet/credit-insights.service';
import { BillingService } from './billing.service';

class RechargeDto {
  /** Custom amount; ignored when packId is set. */
  @IsOptional() @IsInt() @Min(1) @Max(10_000) amountUsd?: number;
  /** Marketplace pack (Phase 6 §12) — fixes price and credits. */
  @IsOptional() @IsString() packId?: string;
  @IsUrl({ require_tld: false }) successUrl!: string;
  @IsUrl({ require_tld: false }) cancelUrl!: string;
}

class BudgetDto {
  @IsInt() @Min(0) monthlyLimit!: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) alertThreshold?: number;
  @IsOptional() @IsBoolean() hardCap?: boolean;
}

/** Wallet surface (billing spec §10). Every mutating call requires Idempotency-Key. */
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly billing: BillingService,
    private readonly budgetService: BudgetService,
    private readonly insights: CreditInsightsService,
  ) {}

  @Get('balance')
  async balance(@CurrentUser() user: JwtPayload) {
    return this.wallet.getBalance(user.sub);
  }

  @Get('transactions')
  async transactions(@CurrentUser() user: JwtPayload, @Query('take') take?: string) {
    return this.wallet.getTransactions(user.sub, parseInt(take ?? '50', 10) || 50);
  }

  /**
   * Active credit lots, soonest-expiring first (Phase 6 §11 expiry timeline).
   * Never-expiring lots (purchased/grandfathered) sort last.
   */
  @Get('lots')
  async lots(@CurrentUser() user: JwtPayload) {
    return this.wallet.getActiveLots(user.sub);
  }

  @Post('recharge')
  async recharge(
    @Body() dto: RechargeDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    if (!idempotencyKey?.trim()) throw new BadRequestException('Idempotency-Key header is required');
    if (dto.packId) {
      return this.billing.createPackRechargeSession(
        user.sub, user.email, dto.packId, idempotencyKey.trim(), dto.successUrl, dto.cancelUrl,
      );
    }
    if (!dto.amountUsd) throw new BadRequestException('Provide amountUsd or packId');
    return this.billing.createRechargeSession(
      user.sub, user.email, dto.amountUsd, idempotencyKey.trim(), dto.successUrl, dto.cancelUrl,
    );
  }

  // ── Budget endpoints ─────────────────────────────────────────────────────────

  /** GET /wallet/budget — current budget status (NONE shape when no budget set). */
  @Get('budget')
  async getBudget(@CurrentUser() user: JwtPayload) {
    const [check, budget] = await Promise.all([
      this.budgetService.check(user.sub, 0),
      this.budgetService.get(user.sub),
    ]);
    return {
      ...check,
      alertThreshold: budget?.alertThreshold ?? 80,
      hardCap: budget?.hardCap ?? false,
    };
  }

  /** PUT /wallet/budget — upsert budget settings. */
  @Put('budget')
  async setBudget(@Body() dto: BudgetDto, @CurrentUser() user: JwtPayload) {
    await this.budgetService.set(user.sub, dto);
    const [check, budget] = await Promise.all([
      this.budgetService.check(user.sub, 0),
      this.budgetService.get(user.sub),
    ]);
    return {
      ...check,
      alertThreshold: budget?.alertThreshold ?? 80,
      hardCap: budget?.hardCap ?? false,
    };
  }

  // ── Usage summary ─────────────────────────────────────────────────────────────

  /**
   * GET /wallet/usage-summary?days=30
   * Aggregates AI spend by action (intentType from ActionRecord via TokenUsage.actionId).
   * Falls back to grouping by provider+model if no action attribution is available.
   * NOTE: per-action grouping via ActionRecord.intentType is used when available;
   * because TokenUsage.actionId → ActionRecord.intentType is the richest grouping.
   */
  @Get('usage-summary')
  async usageSummary(@CurrentUser() user: JwtPayload, @Query('days') days?: string) {
    const lookbackDays = Math.min(Math.max(1, parseInt(days ?? '30', 10) || 30), 365);
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60_000);

    const byAction = await this.insights.usageByAction(user.sub, since);
    return {
      totalSpent: byAction.reduce((s, a) => s + a.credits, 0),
      byAction,
    };
  }

  // ── Credit intelligence (Updates/10 Phase 2) ─────────────────────────────────

  /**
   * GET /wallet/forecast?days=30 — window-average burn projection:
   * daily burn, days-to-empty, and projected month-end spend.
   */
  @Get('forecast')
  async forecast(@CurrentUser() user: JwtPayload, @Query('days') days?: string) {
    const windowDays = Math.min(Math.max(7, parseInt(days ?? '30', 10) || 30), 90);
    return this.insights.forecast(user.sub, windowDays);
  }

  /**
   * GET /wallet/recommendations — rule-based optimization tips (budget pace,
   * low balance, expiring lots, dominant action, cache-hit rate).
   */
  @Get('recommendations')
  async recommendations(@CurrentUser() user: JwtPayload) {
    return this.insights.recommendations(user.sub);
  }
}
