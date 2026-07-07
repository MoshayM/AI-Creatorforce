import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type LedgerEntryType, type LedgerReferenceType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Credit buckets in SPEND priority order: cheapest-to-platform first
 * (billing spec §5.4), with trial credits before everything (Phase 6 §5).
 */
export const DEBIT_PRIORITY = ['trialCredits', 'promotionalCredits', 'bonusCredits', 'referralCredits', 'purchasedCredits'] as const;
export type CreditBucket = (typeof DEBIT_PRIORITY)[number];

export type BucketBalances = Record<CreditBucket, number>;

/**
 * Split a debit across buckets in priority order. Throws on insufficient
 * total (fail closed, §9.1). Pure — exported for tests.
 */
export function planDebit(buckets: BucketBalances, amount: number): Record<CreditBucket, number> {
  if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('Debit amount must be a positive integer');
  const total = DEBIT_PRIORITY.reduce((s, b) => s + buckets[b], 0);
  if (total < amount) throw new BadRequestException('INSUFFICIENT_CREDITS');

  const take: Record<CreditBucket, number> = { trialCredits: 0, promotionalCredits: 0, bonusCredits: 0, referralCredits: 0, purchasedCredits: 0 };
  let remaining = amount;
  for (const bucket of DEBIT_PRIORITY) {
    if (remaining === 0) break;
    const taken = Math.min(buckets[bucket], remaining);
    take[bucket] = taken;
    remaining -= taken;
  }
  return take;
}

/** Which bucket a credit-granting ledger entry type fills. */
export const ENTRY_BUCKET: Partial<Record<LedgerEntryType, CreditBucket>> = {
  PURCHASE: 'purchasedCredits',
  BONUS: 'bonusCredits',
  REFERRAL: 'referralCredits',
  PROMO: 'promotionalCredits',
  TRIAL: 'trialCredits',
  REFUND: 'purchasedCredits',
};

/**
 * Convert real provider spend into credits to debit: ceil(cost × rate ×
 * markup), never negative. Markup is where margin lives (spec §1 "margin is
 * always known"). Pure — exported for tests.
 */
export function creditsForCost(
  costUsd: number,
  rate = Math.max(1, Math.round(Number(process.env['CREDITS_PER_USD']) || 100)),
  markup = Math.max(1, Number(process.env['AI_CREDIT_MARKUP']) || 2),
): number {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return 0;
  return Math.ceil(costUsd * rate * markup);
}

/** Credit-hold enforcement is opt-in (BILLING_ENFORCE_CREDITS) so zero-credit local deployments keep working. */
export function billingEnforced(): boolean {
  return (process.env['BILLING_ENFORCE_CREDITS'] ?? 'false').toLowerCase() === 'true';
}

// ── Credit lots (§5.4: "bonus expires first, purchased expires last") ────────

/** Per-bucket TTL in days; null = never expires. Env-tunable. */
export function lotTtlDays(bucket: CreditBucket): number | null {
  const env = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  switch (bucket) {
    case 'trialCredits': return env('TRIAL_EXPIRY_DAYS', 15);
    case 'promotionalCredits': return env('CREDIT_TTL_PROMO_DAYS', 30);
    case 'bonusCredits': return env('CREDIT_TTL_BONUS_DAYS', 90);
    case 'referralCredits': return env('CREDIT_TTL_REFERRAL_DAYS', 180);
    case 'purchasedCredits': return null;
  }
}

export interface LotView {
  id: string;
  bucket: string;
  remaining: number;
  expiresAt: Date | null;
}

export interface LotTake {
  lotId: string;
  bucket: CreditBucket;
  take: number;
}

/**
 * Split a debit across lots: bucket-priority order first (§5.4), then
 * soonest-expiring lot first within a bucket (never-expiring last). Throws
 * on insufficient spendable total (expired lots are not spendable even if
 * the expiry job hasn't swept them yet). Pure — exported for tests.
 */
export function planLotDebit(lots: LotView[], amount: number, now = new Date()): LotTake[] {
  if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('Debit amount must be a positive integer');
  const live = lots.filter((l) => l.remaining > 0 && (l.expiresAt === null || l.expiresAt > now));
  const priority = new Map(DEBIT_PRIORITY.map((b, i) => [b as string, i]));
  const ordered = [...live].sort((a, b) => {
    const p = (priority.get(a.bucket) ?? 99) - (priority.get(b.bucket) ?? 99);
    if (p !== 0) return p;
    if (a.expiresAt === null && b.expiresAt === null) return 0;
    if (a.expiresAt === null) return 1;
    if (b.expiresAt === null) return -1;
    return a.expiresAt.getTime() - b.expiresAt.getTime();
  });

  const total = ordered.reduce((s, l) => s + l.remaining, 0);
  if (total < amount) throw new BadRequestException('INSUFFICIENT_CREDITS');

  const takes: LotTake[] = [];
  let remaining = amount;
  for (const lot of ordered) {
    if (remaining === 0) break;
    const take = Math.min(lot.remaining, remaining);
    takes.push({ lotId: lot.id, bucket: lot.bucket as CreditBucket, take });
    remaining -= take;
  }
  return takes;
}

export interface LedgerWrite {
  entryType: LedgerEntryType;
  amount: number;
  referenceType: LedgerReferenceType;
  referenceId?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

/**
 * Wallet engine (billing spec §5): ledger-first, idempotent by default. The
 * wallet row is a cached view; every mutation writes an append-only
 * credit_ledger row with a balance snapshot inside one transaction. Replaying
 * an idempotency key is a no-op that returns the original entry.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureWallet(userId: string) {
    return this.prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  async getBalance(userId: string) {
    const w = await this.ensureWallet(userId);
    return {
      balanceCredits: w.balanceCredits,
      buckets: {
        trialCredits: w.trialCredits,
        promotionalCredits: w.promotionalCredits,
        bonusCredits: w.bonusCredits,
        referralCredits: w.referralCredits,
        purchasedCredits: w.purchasedCredits,
      },
      lifetimePurchased: w.lifetimePurchased,
      lifetimeUsed: w.lifetimeUsed,
    };
  }

  async getTransactions(userId: string, take = 50) {
    const wallet = await this.ensureWallet(userId);
    return this.prisma.creditLedger.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 200),
    });
  }

  /** Grant credits (purchase/bonus/referral/promo/refund). Idempotent. */
  async credit(userId: string, write: LedgerWrite) {
    if (!Number.isInteger(write.amount) || write.amount <= 0) {
      throw new BadRequestException('Credit amount must be a positive integer');
    }
    const bucket = ENTRY_BUCKET[write.entryType];
    if (!bucket) throw new BadRequestException(`Entry type ${write.entryType} does not grant credits`);

    const wallet = await this.ensureWallet(userId);
    const ttlDays = lotTtlDays(bucket);
    return this.withIdempotency(write.idempotencyKey, () =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balanceCredits: { increment: write.amount },
            [bucket]: { increment: write.amount },
            ...(write.entryType === 'PURCHASE' ? { lifetimePurchased: { increment: write.amount } } : {}),
          },
        });
        // §5.4: every grant is a lot carrying its own expiry
        const lot = await tx.creditLot.create({
          data: {
            walletId: wallet.id,
            bucket,
            amount: write.amount,
            remaining: write.amount,
            expiresAt: ttlDays === null ? null : new Date(Date.now() + ttlDays * 24 * 60 * 60_000),
          },
        });
        return tx.creditLedger.create({
          data: {
            walletId: wallet.id,
            entryType: write.entryType,
            amount: write.amount,
            balanceAfter: updated.balanceCredits,
            referenceType: write.referenceType,
            referenceId: write.referenceId,
            idempotencyKey: write.idempotencyKey,
            metadata: ({ ...write.metadata, bucket, lotId: lot.id, lotExpiresAt: lot.expiresAt?.toISOString() ?? null }) as Prisma.InputJsonValue,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  /** Spend credits in §5.4 priority order. Fails closed on insufficient funds. Idempotent. */
  async debit(userId: string, write: LedgerWrite) {
    const wallet = await this.ensureWallet(userId);
    return this.withIdempotency(write.idempotencyKey, () =>
      this.prisma.$transaction(async (tx) => {
        // Lots are the debit source of truth: re-read inside the serializable
        // transaction so concurrent debits can't both consume the same lot.
        const lots = await tx.creditLot.findMany({
          where: { walletId: wallet.id, remaining: { gt: 0 } },
          select: { id: true, bucket: true, remaining: true, expiresAt: true },
        });
        const takes = planLotDebit(lots, write.amount);

        const split: Record<CreditBucket, number> = { trialCredits: 0, promotionalCredits: 0, bonusCredits: 0, referralCredits: 0, purchasedCredits: 0 };
        for (const t of takes) {
          split[t.bucket] += t.take;
          await tx.creditLot.update({ where: { id: t.lotId }, data: { remaining: { decrement: t.take } } });
        }
        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balanceCredits: { decrement: write.amount },
            trialCredits: { decrement: split.trialCredits },
            promotionalCredits: { decrement: split.promotionalCredits },
            bonusCredits: { decrement: split.bonusCredits },
            referralCredits: { decrement: split.referralCredits },
            purchasedCredits: { decrement: split.purchasedCredits },
            lifetimeUsed: { increment: write.amount },
          },
        });
        return tx.creditLedger.create({
          data: {
            walletId: wallet.id,
            entryType: write.entryType,
            amount: -write.amount,
            balanceAfter: updated.balanceCredits,
            referenceType: write.referenceType,
            referenceId: write.referenceId,
            idempotencyKey: write.idempotencyKey,
            metadata: ({ ...write.metadata, bucketSplit: split, lotSplit: takes }) as unknown as Prisma.InputJsonValue,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  /**
   * §5.4/§11 credit-expiry-job: post an EXPIRY ledger debit per expired lot
   * (idempotent on the lot id), zero the lot, and sync the cached counters.
   * Returns how many lots were expired.
   */
  async expireLots(): Promise<number> {
    const expired = await this.prisma.creditLot.findMany({
      where: { remaining: { gt: 0 }, expiresAt: { lt: new Date() } },
      take: 500,
    });
    for (const lot of expired) {
      await this.withIdempotency(`expiry:${lot.id}`, () =>
        this.prisma.$transaction(async (tx) => {
          const fresh = await tx.creditLot.findUniqueOrThrow({ where: { id: lot.id } });
          if (fresh.remaining <= 0) return null;
          await tx.creditLot.update({ where: { id: lot.id }, data: { remaining: 0 } });
          const updated = await tx.wallet.update({
            where: { id: lot.walletId },
            data: {
              balanceCredits: { decrement: fresh.remaining },
              [lot.bucket]: { decrement: fresh.remaining },
            },
          });
          return tx.creditLedger.create({
            data: {
              walletId: lot.walletId,
              entryType: 'EXPIRY',
              amount: -fresh.remaining,
              balanceAfter: updated.balanceCredits,
              referenceType: 'ADMIN_ACTION',
              referenceId: lot.id,
              idempotencyKey: `expiry:${lot.id}`,
              metadata: { bucket: lot.bucket, expiredAt: lot.expiresAt?.toISOString() } as Prisma.InputJsonValue,
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
      );
    }
    return expired.length;
  }

  // ── Reserve → settle soft holds (§5.3) ─────────────────────────────────────

  private holdTtlMs(): number {
    return Math.max(5, Number(process.env['HOLD_TTL_MINUTES']) || 120) * 60_000;
  }

  /** Sum of live holds — expired HELD rows don't count (crash safety). */
  private async heldCredits(tx: Prisma.TransactionClient, walletId: string): Promise<number> {
    const agg = await tx.creditReservation.aggregate({
      where: { walletId, status: 'HELD', expiresAt: { gt: new Date() } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  async availableCredits(userId: string) {
    const wallet = await this.ensureWallet(userId);
    const held = await this.heldCredits(this.prisma, wallet.id);
    return { balance: wallet.balanceCredits, held, available: wallet.balanceCredits - held };
  }

  /**
   * Soft-hold credits before an AI run. Fails closed (§9.1) when the
   * available balance (balance − live holds) can't cover the estimate.
   * Replaying the same idempotency key returns the existing reservation.
   */
  async reserve(userId: string, amount: number, idempotencyKey: string, referenceType: string, referenceId?: string) {
    if (!Number.isInteger(amount) || amount <= 0) throw new BadRequestException('Reserve amount must be a positive integer');
    const wallet = await this.ensureWallet(userId);
    const existing = await this.prisma.creditReservation.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;

    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const held = await this.heldCredits(tx, wallet.id);
      if (fresh.balanceCredits - held < amount) {
        throw new BadRequestException('INSUFFICIENT_CREDITS');
      }
      return tx.creditReservation.create({
        data: {
          walletId: wallet.id,
          amount,
          referenceType,
          referenceId,
          idempotencyKey,
          expiresAt: new Date(Date.now() + this.holdTtlMs()),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Close a hold with the REAL debit (§5.3 step 3) — the actual amount may
   * be above or below the estimate. Completed work is never lost: if actual
   * exceeds what the wallet still covers, the debit clamps to available and
   * the shortfall is recorded on the reservation metadata trail.
   */
  async settleReservation(reservationId: string, actualCredits: number, metadata?: Record<string, unknown>) {
    const reservation = await this.prisma.creditReservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (reservation.status !== 'HELD') return reservation; // idempotent: already closed

    let debited = 0;
    if (actualCredits > 0) {
      const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { id: reservation.walletId } });
      debited = Math.min(actualCredits, wallet.balanceCredits);
      if (debited < actualCredits) {
        this.logger.warn(`[settle] reservation ${reservationId}: actual ${actualCredits} exceeds balance — debiting ${debited}`);
      }
      if (debited > 0) {
        await this.debit(wallet.userId, {
          entryType: 'USAGE_DEBIT',
          amount: debited,
          referenceType: 'AI_REQUEST',
          referenceId: reservation.referenceId ?? reservation.id,
          idempotencyKey: `settle:${reservation.id}`,
          metadata: { ...metadata, reservationId: reservation.id, actualCredits, held: reservation.amount },
        });
      }
    }
    return this.prisma.creditReservation.update({
      where: { id: reservationId },
      data: { status: 'SETTLED', settledCredits: debited },
    });
  }

  /** §5.3 step 4: the run failed — release the hold, debit nothing. */
  async releaseReservation(reservationId: string) {
    await this.prisma.creditReservation.updateMany({
      where: { id: reservationId, status: 'HELD' },
      data: { status: 'RELEASED' },
    });
  }

  /** Replay-safe wrapper: a duplicate idempotency key returns the original ledger row (§5.2 step 9). */
  private async withIdempotency<T>(key: string, run: () => Promise<T>): Promise<T | { replayed: true; entry: unknown }> {
    const existing = await this.prisma.creditLedger.findUnique({ where: { idempotencyKey: key } });
    if (existing) return { replayed: true, entry: existing };
    try {
      return await run();
    } catch (err) {
      // Unique-violation race: someone else committed the same key first
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const entry = await this.prisma.creditLedger.findUnique({ where: { idempotencyKey: key } });
        if (entry) return { replayed: true, entry };
      }
      throw err;
    }
  }
}
