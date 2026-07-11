import { Body, Controller, Get, Param, Patch, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProviderRegistryService } from './provider-registry.service';
import { PricingService } from './pricing.service';
import { ProfitGuardService } from './profit-guard.service';
import { simulateRouting } from '@cf/shared';

class CreatePricingRuleDto {
  @IsString() action!: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() plan?: string;
  @IsInt() @Min(1) creditCost!: number;
  @IsOptional() @IsInt() priority?: number;
}

class ProfitPreviewDto {
  @IsString() action!: string;
  @IsInt() @Min(1) creditCost!: number;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsInt() tokensIn?: number;
  @IsOptional() @IsInt() tokensOut?: number;
}

class PatchRuleDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(1) creditCost?: number;
  @IsOptional() @IsInt() priority?: number;
}

class RoutingSimulateDto {
  @IsString() action!: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsInt() @Min(0) estimatedTokensIn?: number;
  @IsOptional() @IsInt() @Min(0) estimatedTokensOut?: number;
}

/** Phase 5 §16 admin surface: providers, pricing rules (profit-gated), margin preview. */
@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiOpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly pricing: PricingService,
    private readonly profit: ProfitGuardService,
  ) {}

  @Get('providers')
  @RequirePermissions('admin:providers')
  async providers() {
    return this.registry.listProviders();
  }

  @Get('pricing-rules')
  @RequirePermissions('admin:pricing')
  async pricingRules() {
    return this.prisma.pricingRule.findMany({ orderBy: [{ action: 'asc' }, { priority: 'desc' }] });
  }

  @Post('pricing-rules')
  @RequirePermissions('admin:pricing')
  async createPricingRule(@Body() dto: CreatePricingRuleDto, @CurrentUser() admin: JwtPayload) {
    // §8 fail-closed: a rule that would sell below margin cannot be created
    const verdict = await this.profit.check({ creditCost: dto.creditCost, action: dto.action, provider: dto.provider });
    if (!verdict.allow) {
      throw new BadRequestException(
        `Rejected by profit guard: margin ${(verdict.margin * 100).toFixed(1)}% < required ${(verdict.minMargin * 100).toFixed(0)}% ` +
        `(net $${verdict.netValueUsd.toFixed(4)}, expected cost $${verdict.expectedCostUsd.toFixed(4)})`,
      );
    }
    const rule = await this.prisma.pricingRule.create({
      data: {
        action: dto.action,
        model: dto.model ?? null,
        provider: dto.provider ?? null,
        plan: dto.plan ?? null,
        creditCost: dto.creditCost,
        priority: dto.priority ?? 0,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId: admin.sub, action: 'admin:pricing-rule-created', target: rule.id, meta: { ...dto, verdict } as never },
    });
    return { rule, verdict };
  }

  @Patch('pricing-rules/:id')
  @RequirePermissions('admin:pricing')
  async patchPricingRule(@Param('id') id: string, @Body() dto: PatchRuleDto, @CurrentUser() admin: JwtPayload) {
    const before = await this.prisma.pricingRule.findUnique({ where: { id } });
    if (!before) throw new BadRequestException('Rule not found');
    if (dto.creditCost !== undefined) {
      const verdict = await this.profit.check({ creditCost: dto.creditCost, action: before.action, provider: before.provider });
      if (!verdict.allow) throw new BadRequestException(`Rejected by profit guard: margin ${(verdict.margin * 100).toFixed(1)}%`);
    }
    const rule = await this.prisma.pricingRule.update({ where: { id }, data: dto });
    await this.prisma.auditLog.create({
      data: { userId: admin.sub, action: 'admin:pricing-rule-updated', target: id, meta: { before, after: rule } as never },
    });
    return rule;
  }

  @Post('profit/preview')
  @RequirePermissions('admin:pricing')
  async profitPreview(@Body() dto: ProfitPreviewDto) {
    return this.profit.check(dto);
  }

  /**
   * Phase 5 §16 — dry-run routing simulation.
   * Returns routing candidates for a given action without making any provider
   * call or spending credits.  Includes credit-cost estimate from the pricing
   * service if a rule exists.
   */
  @Post('routing/simulate')
  @RequirePermissions('admin:pricing')
  async routingSimulate(@Body() dto: RoutingSimulateDto, @CurrentUser() admin: JwtPayload) {
    const tokensIn = dto.estimatedTokensIn ?? 3_000;
    const tokensOut = dto.estimatedTokensOut ?? 1_000;

    const candidates = simulateRouting(dto.action, tokensIn, tokensOut);

    // Resolve credit price for context — read-only, no spend
    const priceRule = await this.pricing.resolvePrice({ action: dto.action, model: dto.model ?? null });

    // Audit-log the dry-run so admin actions remain traceable
    await this.prisma.auditLog.create({
      data: {
        userId: admin.sub,
        action: 'admin:routing-simulate',
        target: dto.action,
        meta: { dto, candidates } as never,
      },
    });

    return {
      candidates: candidates.map((c) => ({
        ...c,
        estCredits: priceRule?.creditCost ?? null,
      })),
      resolvedPricingRule: priceRule,
    };
  }
}
