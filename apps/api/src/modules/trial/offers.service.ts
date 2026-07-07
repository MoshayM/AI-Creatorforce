import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Offer } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

/**
 * A first-recharge bonus keeps margin when the bonus credits' face value
 * stays within the recharge's allowed cost share:
 * bonus$ ≤ recharge$ × (1 − minMargin). Conservative — values bonus credits
 * at full face value. Pure — exported for tests (Phase 6 §9 via Phase 5 §8).
 */
export function bonusWithinMargin(amountMinor: number, bonusCredits: number, creditsPerUsd: number, minMargin: number): boolean {
  if (amountMinor <= 0 || bonusCredits < 0) return false;
  const rechargeUsd = amountMinor / 100;
  const bonusUsd = bonusCredits / creditsPerUsd;
  return bonusUsd <= rechargeUsd * (1 - minMargin);
}

/** Highest qualifying threshold wins (§9). Pure — exported for tests. */
export function pickFirstRechargeOffer<T extends Pick<Offer, 'minRechargeMinor' | 'status' | 'validFrom' | 'validTo'>>(
  offers: T[],
  amountMinor: number,
  now = new Date(),
): T | null {
  const qualifying = offers.filter((o) =>
    o.status === 'active' &&
    o.validFrom <= now &&
    (o.validTo === null || o.validTo > now) &&
    (o.minRechargeMinor ?? 0) <= amountMinor,
  );
  if (qualifying.length === 0) return null;
  return qualifying.sort((a, b) => (b.minRechargeMinor ?? 0) - (a.minRechargeMinor ?? 0))[0]!;
}

/**
 * First-recharge rewards (Phase 6 §9): after a first successful payment,
 * grant the highest qualifying FIRST_RECHARGE offer as a BONUS credit lot.
 * Idempotent on the payment (offer_redemptions unique key + ledger key), so
 * a replayed webhook can never double-grant. Offers are margin-validated at
 * creation AND re-checked at grant time (fail closed).
 */
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  private creditsPerUsd(): number {
    return Math.max(1, Math.round(Number(process.env['CREDITS_PER_USD']) || 100));
  }

  private minMargin(): number {
    const v = Number(process.env['MIN_PROFIT_MARGIN']);
    return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.3;
  }

  /** §8 profit gate at offer creation: a losing offer cannot exist. */
  async createOffer(dto: { type: 'FIRST_RECHARGE' | 'WELCOME'; name: string; rewardValue: number; minRechargeMinor?: number; validTo?: string; usageLimit?: number }, adminId: string) {
    if (dto.type === 'FIRST_RECHARGE') {
      const threshold = dto.minRechargeMinor ?? 0;
      if (threshold < 100) throw new BadRequestException('FIRST_RECHARGE offers need minRechargeMinor >= 100 (minor units)');
      if (!bonusWithinMargin(threshold, dto.rewardValue, this.creditsPerUsd(), this.minMargin())) {
        throw new BadRequestException(
          `Rejected by profit guard: ${dto.rewardValue} bonus credits on a ${(threshold / 100).toFixed(2)} recharge breaks the ${(this.minMargin() * 100).toFixed(0)}% margin floor`,
        );
      }
    }
    const offer = await this.prisma.offer.create({
      data: {
        type: dto.type,
        name: dto.name,
        rewardValue: dto.rewardValue,
        minRechargeMinor: dto.minRechargeMinor ?? null,
        validTo: dto.validTo ? new Date(dto.validTo) : null,
        usageLimit: dto.usageLimit ?? null,
        profitChecked: true,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId: adminId, action: 'admin:offer-created', target: offer.id, meta: dto as never },
    });
    return offer;
  }

  async listOffers() {
    return this.prisma.offer.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { redemptions: true } } } });
  }

  /** Called from the recharge settle path — must never throw into the webhook. */
  async applyFirstRechargeReward(userId: string, paymentId: string, amountMinor: number): Promise<void> {
    try {
      const priorPayments = await this.prisma.payment.count({
        where: { userId, status: 'SUCCEEDED', id: { not: paymentId } },
      });
      if (priorPayments > 0) return; // not the first recharge

      const offers = await this.prisma.offer.findMany({ where: { type: 'FIRST_RECHARGE', status: 'active' } });
      const offer = pickFirstRechargeOffer(offers, amountMinor);
      if (!offer) return;

      // Re-check margin at grant time with the REAL amount (fail closed)
      if (!bonusWithinMargin(amountMinor, offer.rewardValue, this.creditsPerUsd(), this.minMargin())) {
        this.logger.warn(`[offer] ${offer.id} skipped for payment ${paymentId}: fails margin at real amount ${amountMinor}`);
        return;
      }
      if (offer.usageLimit !== null) {
        const uses = await this.prisma.offerRedemption.count({ where: { offerId: offer.id } });
        if (uses >= offer.usageLimit) return;
      }

      const idempotencyKey = `offer:${offer.id}:payment:${paymentId}`;
      try {
        await this.prisma.offerRedemption.create({
          data: { offerId: offer.id, userId, paymentId, rewardGranted: offer.rewardValue, idempotencyKey },
        });
      } catch {
        return; // unique violation = already granted (replayed webhook)
      }
      await this.wallet.credit(userId, {
        entryType: 'BONUS',
        amount: offer.rewardValue,
        referenceType: 'COUPON',
        referenceId: offer.id,
        idempotencyKey,
        metadata: { offerType: 'FIRST_RECHARGE', offerName: offer.name, paymentId },
      });
      this.logger.log(`[offer] first-recharge +${offer.rewardValue} bonus → ${userId} (${offer.name})`);
    } catch (err) {
      this.logger.warn(`[offer] first-recharge reward failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
