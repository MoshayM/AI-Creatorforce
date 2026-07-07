import { Body, Controller, Get, Post, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { IsIn, IsInt, IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

class AdjustWalletDto {
  @IsString() userId!: string;
  /** Positive = grant, negative = claw back. */
  @IsInt() amount!: number;
  @IsString() @MinLength(5) reason!: string;
  @IsIn(['BONUS', 'PROMO', 'ADJUSTMENT']) entryType!: 'BONUS' | 'PROMO' | 'ADJUSTMENT';
}

/**
 * Super Admin surface (billing spec §10) — permission-string RBAC, never
 * email/role checks in handlers. Every sensitive action lands in audit_logs
 * BEFORE the response (§9.7).
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  @Get('billing/revenue')
  @RequirePermissions('admin:revenue')
  async revenue(@Query('days') days?: string) {
    const since = new Date(Date.now() - (Math.min(Number(days) || 30, 365)) * 24 * 60 * 60 * 1000);
    const [succeeded, byGateway] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'SUCCEEDED', createdAt: { gte: since } },
        _sum: { amount: true, creditsGranted: true },
        _count: true,
      }),
      this.prisma.payment.groupBy({
        by: ['gateway'],
        where: { status: 'SUCCEEDED', createdAt: { gte: since } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    return {
      sinceDays: Math.min(Number(days) || 30, 365),
      payments: succeeded._count,
      grossMinorUnits: succeeded._sum.amount ?? 0,
      creditsGranted: succeeded._sum.creditsGranted ?? 0,
      byGateway: byGateway.map((g) => ({ gateway: g.gateway, payments: g._count, grossMinorUnits: g._sum.amount ?? 0 })),
    };
  }

  @Get('audit-logs')
  @RequirePermissions('admin:audit-logs')
  async auditLogs(@Query('take') take?: string) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(take ?? '100', 10) || 100, 500),
    });
  }

  @Get('users')
  @RequirePermissions('admin:users')
  async users() {
    return this.prisma.user.findMany({
      select: {
        id: true, email: true, name: true, role: true, createdAt: true,
        wallet: { select: { balanceCredits: true, lifetimePurchased: true, lifetimeUsed: true } },
        subscription: { select: { plan: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('wallet/adjust')
  @RequirePermissions('wallet:adjust')
  async adjustWallet(@Body() dto: AdjustWalletDto, @CurrentUser() admin: JwtPayload) {
    if (dto.amount === 0) throw new BadRequestException('Adjustment amount cannot be zero');
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!target) throw new BadRequestException('User not found');

    const before = await this.wallet.getBalance(dto.userId);
    const idempotencyKey = `admin:${admin.sub}:${dto.userId}:${dto.entryType}:${dto.amount}:${dto.reason}`;
    const entry = dto.amount > 0
      ? await this.wallet.credit(dto.userId, {
          entryType: dto.entryType === 'ADJUSTMENT' ? 'BONUS' : dto.entryType,
          amount: dto.amount,
          referenceType: 'ADMIN_ACTION',
          referenceId: admin.sub,
          idempotencyKey,
          metadata: { reason: dto.reason, adminId: admin.sub },
        })
      : await this.wallet.debit(dto.userId, {
          entryType: 'ADJUSTMENT',
          amount: -dto.amount,
          referenceType: 'ADMIN_ACTION',
          referenceId: admin.sub,
          idempotencyKey,
          metadata: { reason: dto.reason, adminId: admin.sub },
        });
    const after = await this.wallet.getBalance(dto.userId);

    // §9.7: audit synchronously before the action is considered complete
    await this.prisma.auditLog.create({
      data: {
        userId: admin.sub,
        action: 'admin:wallet-adjust',
        target: dto.userId,
        meta: { reason: dto.reason, amount: dto.amount, entryType: dto.entryType, before, after } as never,
      },
    });
    return { entry, before: before.balanceCredits, after: after.balanceCredits };
  }
}
