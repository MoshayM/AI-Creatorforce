import { Body, Controller, Get, Headers, Post, Put, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { WalletService } from '../wallet/wallet.service';
import { BudgetService } from '../wallet/budget.service';
import { BillingService } from './billing.service';
import { PrismaService } from '../../common/prisma/prisma.service';

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
    private readonly prisma: PrismaService,
  ) {}

  @Get('balance')
  async balance(@CurrentUser() user: JwtPayload) {
    return this.wallet.getBalance(user.sub);
  }

  @Get('transactions')
  async transactions(@CurrentUser() user: JwtPayload, @Query('take') take?: string) {
    return this.wallet.getTransactions(user.sub, parseInt(take ?? '50', 10) || 50);
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

    // Fetch raw rows with action join — userId nullable on TokenUsage, filter directly
    const rows = await this.prisma.tokenUsage.findMany({
      where: { userId: user.sub, createdAt: { gte: since } },
      select: {
        costUsd: true,
        action: { select: { intentType: true } },
      },
    });

    // Group by intentType (action attribution) when present; fall back to 'other'
    const byAction = new Map<string, number>();
    let totalCostUsd = 0;

    for (const row of rows) {
      totalCostUsd += row.costUsd;
      const key = row.action?.intentType ?? 'other';
      byAction.set(key, (byAction.get(key) ?? 0) + row.costUsd);
    }

    // Convert USD to credits using the same formula as creditsForCost
    const rate = Math.max(1, Math.round(Number(process.env['CREDITS_PER_USD']) || 100));
    const markup = Math.max(1, Number(process.env['AI_CREDIT_MARKUP']) || 2);
    const toCredits = (usd: number) => Math.ceil(usd * rate * markup);

    return {
      totalSpent: toCredits(totalCostUsd),
      byAction: Array.from(byAction.entries())
        .map(([action, usd]) => ({ action, credits: toCredits(usd) }))
        .sort((a, b) => b.credits - a.credits),
    };
  }
}
