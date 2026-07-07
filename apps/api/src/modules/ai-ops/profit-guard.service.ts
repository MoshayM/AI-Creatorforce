import { Injectable } from '@nestjs/common';
import { getDefaultCostRates } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Nominal usage per action for rule-level margin checks (tokens in/out). */
export const NOMINAL_USAGE: Record<string, { tokensIn: number; tokensOut: number }> = {
  chat: { tokensIn: 3_000, tokensOut: 1_000 },
  CHAPTER_DETECTION: { tokensIn: 8_000, tokensOut: 2_000 },
  CHURCH_PACK_GENERATION: { tokensIn: 6_000, tokensOut: 6_000 },
  SOCIAL_CONTENT_GENERATION: { tokensIn: 10_000, tokensOut: 6_000 },
  TOPIC_SEGMENTATION: { tokensIn: 60_000, tokensOut: 20_000 },
  HIGHLIGHT_DETECTION: { tokensIn: 20_000, tokensOut: 8_000 },
  DEFAULT: { tokensIn: 10_000, tokensOut: 4_000 },
};

export interface MarginInput {
  creditCost: number;
  expectedProviderCostUsd: number;
  creditsPerUsd: number;
  minMargin: number;
}

export interface MarginVerdict {
  allow: boolean;
  margin: number;
  netValueUsd: number;
  expectedCostUsd: number;
  minMargin: number;
}

/**
 * Margin math (Phase 5 spec §8). Fail-closed: non-positive net value or
 * unparsable inputs reject. margin = (net − cost) / net. Pure — exported
 * for tests.
 */
export function computeMargin(input: MarginInput): MarginVerdict {
  const netValueUsd = input.creditCost / input.creditsPerUsd;
  const base = { netValueUsd, expectedCostUsd: input.expectedProviderCostUsd, minMargin: input.minMargin };
  if (!Number.isFinite(netValueUsd) || netValueUsd <= 0) return { allow: false, margin: -1, ...base };
  if (!Number.isFinite(input.expectedProviderCostUsd) || input.expectedProviderCostUsd < 0) return { allow: false, margin: -1, ...base };
  const margin = (netValueUsd - input.expectedProviderCostUsd) / netValueUsd;
  return { allow: margin >= input.minMargin, margin: Number(margin.toFixed(4)), ...base };
}

/**
 * Profit Protection Engine (Phase 5 §8), scoped to what exists in this
 * deployment: token-based provider cost (DB-configured rates falling back to
 * the shared client's built-ins) vs credit price. Called before any pricing
 * rule is created and by /admin/profit/preview; the Phase 6 offer engine
 * will call the same check. Every rejection carries the computed numbers.
 */
@Injectable()
export class ProfitGuardService {
  constructor(private readonly prisma: PrismaService) {}

  private minMargin(): number {
    const v = Number(process.env['MIN_PROFIT_MARGIN']);
    return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.3;
  }

  private creditsPerUsd(): number {
    return Math.max(1, Math.round(Number(process.env['CREDITS_PER_USD']) || 100));
  }

  /** Worst-case (most expensive live provider) cost for the nominal usage of an action. */
  async expectedCostUsd(action: string, provider?: string | null, tokensIn?: number, tokensOut?: number): Promise<number> {
    const usage = {
      tokensIn: tokensIn ?? (NOMINAL_USAGE[action] ?? NOMINAL_USAGE['DEFAULT']!).tokensIn,
      tokensOut: tokensOut ?? (NOMINAL_USAGE[action] ?? NOMINAL_USAGE['DEFAULT']!).tokensOut,
    };
    const defaults = getDefaultCostRates();
    const dbRates = await this.prisma.providerCostRate.findMany({
      where: {
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
        ...(provider ? { provider: { name: provider } } : {}),
      },
      include: { provider: { select: { name: true, status: true } } },
    });

    const rates: Array<{ input: number; output: number }> = dbRates.length > 0
      ? dbRates.filter((r) => r.provider.status !== 'DISABLED').map((r) => ({ input: r.inputCostPer1M, output: r.outputCostPer1M }))
      : Object.entries(defaults)
          .filter(([name]) => !provider || name === provider)
          .map(([, r]) => r);
    if (rates.length === 0) return Number.POSITIVE_INFINITY; // unknown cost → fail closed upstream

    // Worst case: the priciest provider the request could route to
    return Math.max(...rates.map((r) => (usage.tokensIn / 1_000_000) * r.input + (usage.tokensOut / 1_000_000) * r.output));
  }

  async check(params: { creditCost: number; action: string; provider?: string | null; tokensIn?: number; tokensOut?: number }): Promise<MarginVerdict> {
    const expected = await this.expectedCostUsd(params.action, params.provider, params.tokensIn, params.tokensOut);
    return computeMargin({
      creditCost: params.creditCost,
      expectedProviderCostUsd: expected,
      creditsPerUsd: this.creditsPerUsd(),
      minMargin: this.minMargin(),
    });
  }
}
