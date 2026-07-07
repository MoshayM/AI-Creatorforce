import { Injectable } from '@nestjs/common';
import type { PricingRule } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PriceQuery {
  action: string;
  model?: string | null;
  provider?: string | null;
  plan?: string | null;
}

/**
 * Most-specific-wins rule resolution (Phase 5 spec §7): a rule matches when
 * each of its non-null matchers equals the query; specificity = number of
 * non-null matchers, ties broken by priority then recency. Pure — exported
 * for tests.
 */
export function resolveRule<T extends Pick<PricingRule, 'action' | 'model' | 'provider' | 'plan' | 'priority' | 'creditCost' | 'effectiveFrom' | 'effectiveTo' | 'isActive'>>(
  rules: T[],
  query: PriceQuery,
  now = new Date(),
): T | null {
  const matches = rules.filter((r) =>
    r.isActive &&
    r.action === query.action &&
    r.effectiveFrom <= now &&
    (r.effectiveTo === null || r.effectiveTo > now) &&
    (r.model === null || r.model === (query.model ?? null)) &&
    (r.provider === null || r.provider === (query.provider ?? null)) &&
    (r.plan === null || r.plan === (query.plan ?? null)),
  );
  if (matches.length === 0) return null;
  const specificity = (r: T) => [r.plan, r.model, r.provider].filter((v) => v !== null).length;
  return matches.sort((a, b) =>
    specificity(b) - specificity(a) ||
    b.priority - a.priority ||
    b.effectiveFrom.getTime() - a.effectiveFrom.getTime(),
  )[0]!;
}

/**
 * Dynamic credit pricing (Phase 5 §7). A resolved price is QUOTED at lookup
 * and LOCKED by the caller at reservation time — the reserve amount IS the
 * settle amount when a rule priced the action. No rule → null → the caller
 * falls back to the legacy cost×markup settle.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async resolvePrice(query: PriceQuery): Promise<{ creditCost: number; ruleId: string } | null> {
    const rules = await this.prisma.pricingRule.findMany({ where: { action: query.action, isActive: true } });
    const rule = resolveRule(rules, query);
    return rule ? { creditCost: rule.creditCost, ruleId: rule.id } : null;
  }
}
