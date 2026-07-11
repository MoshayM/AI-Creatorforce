import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { billingEnforced } from './billing.config';

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Returns the UTC start and end of the calendar month containing `now`.
 * Used to bound the month-to-date spend query.
 */
export function monthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export type BudgetStatus = 'NONE' | 'OK' | 'ALERT' | 'EXCEEDED';

/**
 * Classify the current spend relative to the limit.
 * - limit <= 0  → NONE (no budget set)
 * - spent >= limit → EXCEEDED
 * - spent/limit*100 >= alertThreshold → ALERT
 * - else → OK
 */
export function budgetStatus(
  limit: number,
  spent: number,
  alertThreshold: number,
): BudgetStatus {
  if (limit <= 0) return 'NONE';
  if (spent >= limit) return 'EXCEEDED';
  if ((spent / limit) * 100 >= alertThreshold) return 'ALERT';
  return 'OK';
}

/**
 * Returns true when adding `nextCost` credits to `spent` would exceed `limit`.
 * A zero/negative limit means no budget — always returns false.
 */
export function wouldExceed(limit: number, spent: number, nextCost: number): boolean {
  return limit > 0 && spent + nextCost > limit;
}

// ── Injectable service ────────────────────────────────────────────────────────

export interface BudgetCheckResult {
  status: BudgetStatus;
  monthlyLimit: number;
  spent: number;
  remaining: number;
  willExceed: boolean;
  blocked: boolean;
}

@Injectable()
export class BudgetService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fetch the user's budget row, or null if none set. */
  async get(userId: string) {
    return this.prisma.budget.findUnique({ where: { userId } });
  }

  /**
   * Upsert the user's budget settings.
   * Validates: monthlyLimit >= 0, alertThreshold in [1, 100].
   */
  async set(
    userId: string,
    dto: { monthlyLimit: number; alertThreshold?: number; hardCap?: boolean },
  ) {
    if (!Number.isInteger(dto.monthlyLimit) || dto.monthlyLimit < 0) {
      throw new BadRequestException('monthlyLimit must be a non-negative integer');
    }
    const threshold = dto.alertThreshold ?? 80;
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
      throw new BadRequestException('alertThreshold must be an integer between 1 and 100');
    }
    return this.prisma.budget.upsert({
      where: { userId },
      create: {
        userId,
        monthlyLimit: dto.monthlyLimit,
        alertThreshold: threshold,
        hardCap: dto.hardCap ?? false,
      },
      update: {
        monthlyLimit: dto.monthlyLimit,
        alertThreshold: threshold,
        hardCap: dto.hardCap ?? false,
      },
    });
  }

  /**
   * Sum of USAGE_DEBIT ledger entries in the current calendar month.
   * CreditLedger amounts are negative for debits; we return a positive spent number.
   */
  async monthToDateSpend(userId: string): Promise<number> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return 0;

    const { start, end } = monthWindow(new Date());
    const agg = await this.prisma.creditLedger.aggregate({
      where: {
        walletId: wallet.id,
        entryType: 'USAGE_DEBIT',
        createdAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    });
    // Amounts are stored as negative integers for debits; negate to get positive spend.
    return Math.abs(agg._sum.amount ?? 0);
  }

  /**
   * Full budget check for a user before spending `nextCost` credits.
   * Returns status, limits, spend, and whether the action would be blocked.
   */
  async check(userId: string, nextCost: number): Promise<BudgetCheckResult> {
    const [budget, spent] = await Promise.all([
      this.get(userId),
      this.monthToDateSpend(userId),
    ]);

    const monthlyLimit = budget?.monthlyLimit ?? 0;
    const alertThreshold = budget?.alertThreshold ?? 80;
    const hardCap = budget?.hardCap ?? false;

    const status = budgetStatus(monthlyLimit, spent, alertThreshold);
    const willExceedFlag = wouldExceed(monthlyLimit, spent, nextCost);
    const blocked = hardCap && willExceedFlag;
    const remaining = monthlyLimit > 0 ? Math.max(0, monthlyLimit - spent) : 0;

    return {
      status,
      monthlyLimit,
      spent,
      remaining,
      willExceed: willExceedFlag,
      blocked,
    };
  }

  /**
   * Enforcement hook: called before a wallet reservation when billing is
   * enforced. Throws BadRequestException with code BUDGET_EXCEEDED when the
   * user's hard cap would be crossed by `nextCost`.
   */
  async enforceBeforeReserve(userId: string, nextCost: number): Promise<void> {
    if (!billingEnforced()) return;
    const result = await this.check(userId, nextCost);
    if (result.blocked) {
      throw new BadRequestException('BUDGET_EXCEEDED');
    }
  }
}
