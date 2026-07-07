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

export interface OfferUserContext {
  hasPaid: boolean;
  lifetimePurchased: number;
  inactiveDays: number;
  balanceCredits: number;
}

/**
 * Behavior-based qualification per offer type (Phase 6 §10.1): WELCOME needs
 * no payment history, LOYALTY needs spend history, WINBACK needs absence,
 * LOW_CREDIT needs an empty-ish wallet. Thresholds come from the offer's
 * targetRule with sensible defaults. Pure — exported for tests.
 */
export function offerQualifies(
  offer: { type: string; targetRule?: unknown },
  ctx: OfferUserContext,
): boolean {
  const rule = (offer.targetRule ?? {}) as { inactiveDaysMin?: number; maxBalance?: number; lifetimePurchasedMin?: number };
  switch (offer.type) {
    case 'FIRST_RECHARGE':
    case 'WELCOME':
      return !ctx.hasPaid;
    case 'LOYALTY':
      return ctx.lifetimePurchased >= (rule.lifetimePurchasedMin ?? 1_000);
    case 'WINBACK':
      return ctx.inactiveDays >= (rule.inactiveDaysMin ?? 14);
    case 'LOW_CREDIT':
      return ctx.balanceCredits <= (rule.maxBalance ?? 50);
    case 'UPGRADE':
      return true;
    default:
      return false;
  }
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
  async createOffer(
    dto: { type: 'FIRST_RECHARGE' | 'WELCOME' | 'LOYALTY' | 'WINBACK' | 'LOW_CREDIT'; name: string; rewardValue: number; minRechargeMinor?: number; validTo?: string; usageLimit?: number; targetRule?: Record<string, number> },
    adminId: string,
  ) {
    if (dto.minRechargeMinor !== undefined && dto.minRechargeMinor !== null) {
      // Recharge-attached: bonus must fit inside the recharge's margin envelope
      if (dto.minRechargeMinor < 100) throw new BadRequestException('Recharge-attached offers need minRechargeMinor >= 100 (minor units)');
      if (!bonusWithinMargin(dto.minRechargeMinor, dto.rewardValue, this.creditsPerUsd(), this.minMargin())) {
        throw new BadRequestException(
          `Rejected by profit guard: ${dto.rewardValue} bonus credits on a ${(dto.minRechargeMinor / 100).toFixed(2)} recharge breaks the ${(this.minMargin() * 100).toFixed(0)}% margin floor`,
        );
      }
    } else {
      // Direct grant: pure cost — capped like the trial grant (fail closed)
      const cap = Math.max(0, Number(process.env['MAX_FREE_GRANT_CREDITS']) || 100);
      if (dto.type === 'FIRST_RECHARGE') throw new BadRequestException('FIRST_RECHARGE offers must set minRechargeMinor');
      if (dto.rewardValue > cap) {
        throw new BadRequestException(`Rejected by profit guard: direct grants are capped at ${cap} credits (MAX_FREE_GRANT_CREDITS)`);
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
        targetRule: (dto.targetRule ?? undefined) as never,
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

  private async userContext(userId: string, excludePaymentId?: string): Promise<OfferUserContext> {
    const [payments, wallet, behaviour] = await Promise.all([
      this.prisma.payment.count({ where: { userId, status: 'SUCCEEDED', ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}) } }),
      this.prisma.wallet.findUnique({ where: { userId }, select: { balanceCredits: true, lifetimePurchased: true } }),
      this.prisma.userBehaviour.findUnique({ where: { userId }, select: { inactiveDays: true } }),
    ]);
    return {
      hasPaid: payments > 0,
      lifetimePurchased: wallet?.lifetimePurchased ?? 0,
      inactiveDays: behaviour?.inactiveDays ?? 0,
      balanceCredits: wallet?.balanceCredits ?? 0,
    };
  }

  /** Offers visible to this user right now (§10.1 Offer Center). */
  async offersFor(userId: string) {
    const [offers, ctx, myRedemptions] = await Promise.all([
      this.prisma.offer.findMany({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } }),
      this.userContext(userId),
      this.prisma.offerRedemption.groupBy({ by: ['offerId'], where: { userId }, _count: true }),
    ]);
    const usedByOffer = new Map(myRedemptions.map((r) => [r.offerId, r._count]));
    const now = new Date();
    return offers
      .filter((o) => o.validFrom <= now && (o.validTo === null || o.validTo > now))
      .filter((o) => (usedByOffer.get(o.id) ?? 0) < o.perUserLimit)
      .filter((o) => offerQualifies(o, ctx))
      .map((o) => ({
        id: o.id, type: o.type, name: o.name, rewardType: o.rewardType, rewardValue: o.rewardValue,
        minRechargeMinor: o.minRechargeMinor, validTo: o.validTo,
        redeemable: o.minRechargeMinor === null, // recharge-attached offers apply automatically
      }));
  }

  /** Direct-grant redemption for offers without a recharge condition. Idempotent per user. */
  async redeem(offerId: string, userId: string) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer || offer.status !== 'active') throw new BadRequestException('Offer not available');
    if (offer.minRechargeMinor !== null) {
      throw new BadRequestException('This offer applies automatically on a qualifying recharge');
    }
    const ctx = await this.userContext(userId);
    if (!offerQualifies(offer, ctx)) throw new BadRequestException('You do not qualify for this offer');
    const myUses = await this.prisma.offerRedemption.count({ where: { offerId, userId } });
    if (myUses >= offer.perUserLimit) throw new BadRequestException('Offer already redeemed');
    if (offer.usageLimit !== null) {
      const uses = await this.prisma.offerRedemption.count({ where: { offerId } });
      if (uses >= offer.usageLimit) throw new BadRequestException('Offer fully redeemed');
    }

    const idempotencyKey = `offer:${offer.id}:user:${userId}`;
    try {
      await this.prisma.offerRedemption.create({
        data: { offerId: offer.id, userId, rewardGranted: offer.rewardValue, idempotencyKey },
      });
    } catch {
      throw new BadRequestException('Offer already redeemed');
    }
    await this.wallet.credit(userId, {
      entryType: 'BONUS',
      amount: offer.rewardValue,
      referenceType: 'COUPON',
      referenceId: offer.id,
      idempotencyKey,
      metadata: { offerType: offer.type, offerName: offer.name },
    });
    return { redeemed: true, credits: offer.rewardValue };
  }

  /** Called from the recharge settle path — must never throw into the webhook. */
  async applyFirstRechargeReward(userId: string, paymentId: string, amountMinor: number): Promise<void> {
    try {
      const ctx = await this.userContext(userId, paymentId);

      // Recharge-attached offers: FIRST_RECHARGE for first payments, else the
      // best qualifying campaign (LOYALTY/WINBACK/LOW_CREDIT) — one per payment
      const offers = await this.prisma.offer.findMany({
        where: { status: 'active', minRechargeMinor: { not: null } },
      });
      const now = new Date();
      const live = offers.filter((o) => o.validFrom <= now && (o.validTo === null || o.validTo > now));
      const firstRecharge = !ctx.hasPaid
        ? pickFirstRechargeOffer(live.filter((o) => o.type === 'FIRST_RECHARGE'), amountMinor)
        : null;
      let offer = firstRecharge;
      if (!offer) {
        const candidates = live
          .filter((o) => o.type !== 'FIRST_RECHARGE' && (o.minRechargeMinor ?? 0) <= amountMinor)
          .filter((o) => offerQualifies(o, ctx))
          .sort((a, b) => b.rewardValue - a.rewardValue);
        for (const c of candidates) {
          const myUses = await this.prisma.offerRedemption.count({ where: { offerId: c.id, userId } });
          if (myUses < c.perUserLimit) { offer = c; break; }
        }
      }
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
