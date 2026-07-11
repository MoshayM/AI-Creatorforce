import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from './wallet.service';
import { BudgetService } from './budget.service';

// ── Pure helpers (exported for tests) ────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BurnForecast {
  windowDays: number;
  /** Credits debited in the window (positive number). */
  totalDebited: number;
  /** Credits per day, from the window average. */
  dailyBurn: number;
  balance: number;
  /** Days until the balance hits zero at the current burn; null when idle. */
  daysToEmpty: number | null;
  /** ISO date the balance runs out; null when idle. */
  emptyOn: string | null;
  /** Month-to-date spend + projected spend for the rest of the month. */
  projectedMonthEndSpend: number;
}

/**
 * Burn-rate forecast (Updates/10 §forecasting): a simple, explainable
 * window-average projection — the same philosophy as the BI forecasts
 * (start with models a user can verify by hand).
 *
 * `debits` are CreditLedger USAGE_DEBIT rows, whose amounts are NEGATIVE
 * by ledger convention; absolute values are summed.
 */
export function burnForecast(args: {
  balance: number;
  debits: Array<{ amount: number }>;
  monthSpentSoFar: number;
  now: Date;
  windowDays?: number;
}): BurnForecast {
  const windowDays = args.windowDays ?? 30;
  const totalDebited = args.debits.reduce((s, d) => s + Math.abs(d.amount), 0);
  const dailyBurn = totalDebited / windowDays;

  const daysToEmpty =
    dailyBurn > 0 && args.balance > 0 ? args.balance / dailyBurn : null;
  const emptyOn =
    daysToEmpty !== null
      ? new Date(args.now.getTime() + daysToEmpty * DAY_MS).toISOString().slice(0, 10)
      : null;

  const endOfMonth = new Date(Date.UTC(args.now.getUTCFullYear(), args.now.getUTCMonth() + 1, 1));
  const daysLeftInMonth = Math.max(0, (endOfMonth.getTime() - args.now.getTime()) / DAY_MS);
  const projectedMonthEndSpend = Math.round(args.monthSpentSoFar + dailyBurn * daysLeftInMonth);

  return {
    windowDays,
    totalDebited,
    dailyBurn: Number(dailyBurn.toFixed(2)),
    balance: args.balance,
    daysToEmpty: daysToEmpty !== null ? Number(daysToEmpty.toFixed(1)) : null,
    emptyOn,
    projectedMonthEndSpend,
  };
}

export interface CreditRecommendation {
  type: 'NO_BUDGET' | 'BUDGET_PACE' | 'LOW_BALANCE' | 'EXPIRING_CREDITS' | 'TOP_ACTION' | 'LOW_CACHE_HIT';
  severity: 'info' | 'warning';
  message: string;
  meta?: Record<string, unknown>;
}

/**
 * Rule-based optimization recommendations (Updates/10 Phase 2).  Every rule
 * is data-backed and actionable; none require ML.  Ordered warnings-first so
 * the UI can render top-down.
 */
export function buildRecommendations(input: {
  forecast: BurnForecast;
  budget: { monthlyLimit: number; spent: number; hardCap: boolean };
  byAction: Array<{ action: string; credits: number }>;
  cacheHitRate: number | null;
  copilotTurns: number;
  expiringLots: Array<{ remaining: number; expiresAt: Date }>;
  now: Date;
}): CreditRecommendation[] {
  const recs: CreditRecommendation[] = [];
  const { forecast, budget } = input;

  // Balance runs out within a week at the current pace.
  if (forecast.daysToEmpty !== null && forecast.daysToEmpty <= 7) {
    recs.push({
      type: 'LOW_BALANCE',
      severity: 'warning',
      message: `At your current usage your balance covers about ${Math.max(1, Math.round(forecast.daysToEmpty))} more day(s) (empty around ${forecast.emptyOn}). Recharge to avoid interruptions.`,
      meta: { daysToEmpty: forecast.daysToEmpty, emptyOn: forecast.emptyOn },
    });
  }

  // On pace to blow through the monthly budget.
  if (budget.monthlyLimit > 0 && forecast.projectedMonthEndSpend > budget.monthlyLimit) {
    const over = forecast.projectedMonthEndSpend - budget.monthlyLimit;
    recs.push({
      type: 'BUDGET_PACE',
      severity: 'warning',
      message: `You are on pace to spend ${forecast.projectedMonthEndSpend} credits this month — ${over} over your ${budget.monthlyLimit}-credit budget${budget.hardCap ? ' (hard cap will block actions when reached)' : ''}.`,
      meta: { projected: forecast.projectedMonthEndSpend, limit: budget.monthlyLimit, over },
    });
  }

  // Credits expiring within 7 days.
  const soon = new Date(input.now.getTime() + 7 * DAY_MS);
  const expiring = input.expiringLots
    .filter((l) => l.remaining > 0 && l.expiresAt <= soon)
    .reduce((s, l) => s + l.remaining, 0);
  if (expiring > 0) {
    recs.push({
      type: 'EXPIRING_CREDITS',
      severity: 'warning',
      message: `${expiring} credit(s) expire within 7 days — they are spent before purchased credits, so using AI features this week consumes them first.`,
      meta: { expiring },
    });
  }

  // Spending without any budget guard rails.
  if (budget.monthlyLimit <= 0 && forecast.totalDebited > 0) {
    recs.push({
      type: 'NO_BUDGET',
      severity: 'info',
      message: 'You have no monthly budget set. A budget with an alert threshold (and optional hard cap) prevents surprise spend.',
    });
  }

  // One action dominates spend.
  const total = input.byAction.reduce((s, a) => s + a.credits, 0);
  const top = input.byAction[0];
  if (top && total >= 50 && top.credits / total >= 0.5) {
    recs.push({
      type: 'TOP_ACTION',
      severity: 'info',
      message: `"${top.action}" drives ${Math.round((top.credits / total) * 100)}% of your spend (${top.credits} of ${total} credits). Review whether all of those runs are needed.`,
      meta: { action: top.action, credits: top.credits, share: top.credits / total },
    });
  }

  // Cache misses cost money that identical phrasing would save.
  if (
    input.copilotTurns >= 20 &&
    input.cacheHitRate !== null &&
    input.cacheHitRate < 0.3
  ) {
    recs.push({
      type: 'LOW_CACHE_HIT',
      severity: 'info',
      message: `Only ${Math.round(input.cacheHitRate * 100)}% of your copilot turns hit the free intent cache. Repeating the same phrasing for routine commands makes them cost zero credits.`,
      meta: { cacheHitRate: input.cacheHitRate, turns: input.copilotTurns },
    });
  }

  return recs;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class CreditInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly budget: BudgetService,
  ) {}

  /** Credits spent by action over the window (shared by usage-summary + recommendations). */
  async usageByAction(userId: string, since: Date): Promise<Array<{ action: string; credits: number }>> {
    const rows = await this.prisma.tokenUsage.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { costUsd: true, action: { select: { intentType: true } } },
    });

    const rate = Math.max(1, Math.round(Number(process.env['CREDITS_PER_USD']) || 100));
    const markup = Math.max(1, Number(process.env['AI_CREDIT_MARKUP']) || 2);
    const toCredits = (usd: number) => Math.ceil(usd * rate * markup);

    const byAction = new Map<string, number>();
    for (const row of rows) {
      const key = row.action?.intentType ?? 'other';
      byAction.set(key, (byAction.get(key) ?? 0) + row.costUsd);
    }
    return Array.from(byAction.entries())
      .map(([action, usd]) => ({ action, credits: toCredits(usd) }))
      .sort((a, b) => b.credits - a.credits);
  }

  /** GET /wallet/forecast payload. */
  async forecast(userId: string, windowDays = 30): Promise<BurnForecast> {
    const now = new Date();
    const since = new Date(now.getTime() - windowDays * DAY_MS);

    const wallet = await this.wallet.ensureWallet(userId);
    const [debits, budgetCheck] = await Promise.all([
      this.prisma.creditLedger.findMany({
        where: { walletId: wallet.id, entryType: 'USAGE_DEBIT', createdAt: { gte: since } },
        select: { amount: true },
      }),
      this.budget.check(userId, 0),
    ]);

    return burnForecast({
      balance: wallet.balanceCredits,
      debits,
      monthSpentSoFar: budgetCheck.spent,
      now,
      windowDays,
    });
  }

  /** GET /wallet/recommendations payload. */
  async recommendations(userId: string): Promise<CreditRecommendation[]> {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const wallet = await this.wallet.ensureWallet(userId);

    const [forecast, budgetCheck, budgetRow, byAction, cacheGroups, lots] = await Promise.all([
      this.forecast(userId),
      this.budget.check(userId, 0),
      this.budget.get(userId),
      this.usageByAction(userId, since),
      this.prisma.actionRecord.groupBy({
        by: ['fromCache'],
        where: { userId, createdAt: { gte: since }, source: { in: ['COPILOT', 'VOICE'] } },
        _count: true,
      }),
      this.prisma.creditLot.findMany({
        where: { walletId: wallet.id, remaining: { gt: 0 }, expiresAt: { not: null } },
        select: { remaining: true, expiresAt: true },
      }),
    ]);

    const hits = cacheGroups.find((a) => a.fromCache)?._count ?? 0;
    const misses = cacheGroups.find((a) => !a.fromCache)?._count ?? 0;
    const turns = hits + misses;

    return buildRecommendations({
      forecast,
      budget: {
        monthlyLimit: budgetCheck.monthlyLimit,
        spent: budgetCheck.spent,
        hardCap: budgetRow?.hardCap ?? false,
      },
      byAction,
      cacheHitRate: turns > 0 ? hits / turns : null,
      copilotTurns: turns,
      expiringLots: lots.filter((l): l is { remaining: number; expiresAt: Date } => l.expiresAt !== null),
      now,
    });
  }
}
