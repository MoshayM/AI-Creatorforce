import { Body, Controller, Get, Headers, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { IsInt, IsUrl, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { WalletService } from '../wallet/wallet.service';
import { BillingService } from './billing.service';

class RechargeDto {
  @IsInt() @Min(1) @Max(10_000) amountUsd!: number;
  @IsUrl({ require_tld: false }) successUrl!: string;
  @IsUrl({ require_tld: false }) cancelUrl!: string;
}

/** Wallet surface (billing spec §10). Every mutating call requires Idempotency-Key. */
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly billing: BillingService,
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
    return this.billing.createRechargeSession(
      user.sub, user.email, dto.amountUsd, idempotencyKey.trim(), dto.successUrl, dto.cancelUrl,
    );
  }
}
