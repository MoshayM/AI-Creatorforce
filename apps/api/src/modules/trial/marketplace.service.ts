import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Pack margin gate (Phase 6 §12 via Phase 5 §8): credits redeem against AI
 * usage at CREDITS_PER_USD × AI_CREDIT_MARKUP, so C credits ultimately cost
 * ~C/(rate×markup) dollars of provider spend. A pack keeps margin when
 * price − expectedCost ≥ price × minMargin. With rate=100, markup=2,
 * minMargin=0.3 a $10 pack may carry up to 1,400 credits (40% bonus).
 * Pure — exported for tests.
 */
export function packWithinMargin(
  priceMinor: number,
  credits: number,
  creditsPerUsd: number,
  markup: number,
  minMargin: number,
): boolean {
  if (priceMinor <= 0 || credits <= 0 || creditsPerUsd <= 0 || markup <= 0) return false;
  const priceUsd = priceMinor / 100;
  const expectedCostUsd = credits / (creditsPerUsd * markup);
  return priceUsd - expectedCostUsd >= priceUsd * minMargin;
}

/**
 * Credit marketplace (Phase 6 §12): packs define what can be bought; the
 * existing recharge/payment path (with all its idempotency and webhook
 * settlement) does the buying. Regional pricing = per-region rows; a client
 * region filters, no region shows global (region=null) packs.
 */
@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  private creditsPerUsd(): number {
    return Math.max(1, Math.round(Number(process.env['CREDITS_PER_USD']) || 100));
  }

  private markup(): number {
    return Math.max(1, Number(process.env['AI_CREDIT_MARKUP']) || 2);
  }

  private minMargin(): number {
    const v = Number(process.env['MIN_PROFIT_MARGIN']);
    return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.3;
  }

  async listPacks(region?: string) {
    return this.prisma.creditPack.findMany({
      where: { isActive: true, OR: [{ region: null }, ...(region ? [{ region }] : [])] },
      orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }],
    });
  }

  async getPack(packId: string) {
    const pack = await this.prisma.creditPack.findFirst({ where: { id: packId, isActive: true } });
    if (!pack) throw new NotFoundException('Credit pack not found');
    return pack;
  }

  /** §8 fail closed: a pack that would sell credits below margin cannot exist. */
  async createPack(dto: { name: string; credits: number; priceMinor: number; currency?: string; region?: string; sortOrder?: number }, adminId: string) {
    if (!Number.isInteger(dto.credits) || dto.credits < 1) throw new BadRequestException('credits must be a positive integer');
    if (!Number.isInteger(dto.priceMinor) || dto.priceMinor < 100) throw new BadRequestException('priceMinor must be >= 100');
    if (!packWithinMargin(dto.priceMinor, dto.credits, this.creditsPerUsd(), this.markup(), this.minMargin())) {
      throw new BadRequestException(
        `Rejected by profit guard: ${dto.credits} credits at ${(dto.priceMinor / 100).toFixed(2)} breaks the ${(this.minMargin() * 100).toFixed(0)}% margin floor`,
      );
    }
    const pack = await this.prisma.creditPack.create({
      data: {
        name: dto.name,
        credits: dto.credits,
        priceMinor: dto.priceMinor,
        currency: (dto.currency ?? 'usd').toLowerCase(),
        region: dto.region ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId: adminId, action: 'admin:credit-pack-created', target: pack.id, meta: dto as never },
    });
    return pack;
  }

  async setPackActive(packId: string, isActive: boolean, adminId: string) {
    const pack = await this.prisma.creditPack.update({ where: { id: packId }, data: { isActive } });
    await this.prisma.auditLog.create({
      data: { userId: adminId, action: 'admin:credit-pack-toggled', target: packId, meta: { isActive } as never },
    });
    return pack;
  }
}
