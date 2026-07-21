import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Features the trial tier can gate today (Phase 6 §7, scoped to what exists). */
export const TRIAL_FEATURES = ['daily_ai_requests', 'max_projects', 'publishing'] as const;
export type TrialFeature = (typeof TRIAL_FEATURES)[number];

const DEFAULTS: Record<TrialFeature, { access: string; limitValue: number | null }> = {
  daily_ai_requests: { access: 'limited', limitValue: 20 },
  max_projects: { access: 'limited', limitValue: 2 },
  publishing: { access: 'enabled', limitValue: null },
};

/**
 * Server-side trial feature gating (§7): applies only while the user is
 * actually on trial (no purchase yet, trial grant active). Disabled features
 * and exceeded limits throw an "upgrade to unlock" error the UI/Upgrade
 * Engine can act on. Config lives in trial_limits rows (Super-Admin
 * editable); absent rows fall back to defaults.
 */
@Injectable()
export class TrialLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Trial users = active grant and no purchased credits yet. OWNER/SUPER_ADMIN are never trial users. */
  async isTrialUser(userId: string): Promise<boolean> {
    const [user, grant, wallet] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      this.prisma.trialGrant.findUnique({ where: { userId } }),
      this.prisma.wallet.findUnique({ where: { userId }, select: { lifetimePurchased: true } }),
    ]);
    if (user?.role === 'SUPER_ADMIN' || user?.role === 'OWNER') return false;
    if (!grant || grant.status === 'CONVERTED') return false;
    if ((wallet?.lifetimePurchased ?? 0) > 0) return false;
    return true;
  }

  async effectiveLimits(): Promise<Record<TrialFeature, { access: string; limitValue: number | null }>> {
    const rows = await this.prisma.trialLimit.findMany();
    const byFeature = new Map(rows.map((r) => [r.feature, r]));
    return Object.fromEntries(
      TRIAL_FEATURES.map((f) => {
        const row = byFeature.get(f);
        return [f, row ? { access: row.access, limitValue: row.limitValue } : DEFAULTS[f]];
      }),
    ) as Record<TrialFeature, { access: string; limitValue: number | null }>;
  }

  /** Throws ForbiddenException('TRIAL_LIMIT:<feature>') when the trial tier blocks the action. */
  async assertAllowed(userId: string, feature: TrialFeature): Promise<void> {
    if (!(await this.isTrialUser(userId))) return;
    const limits = await this.effectiveLimits();
    const rule = limits[feature];
    if (rule.access === 'enabled') return;
    if (rule.access === 'disabled') {
      throw new ForbiddenException(`TRIAL_LIMIT:${feature} — upgrade to unlock this feature`);
    }
    const used = await this.currentUsage(userId, feature);
    if (rule.limitValue !== null && used >= rule.limitValue) {
      throw new ForbiddenException(`TRIAL_LIMIT:${feature} — trial cap of ${rule.limitValue} reached, upgrade to continue`);
    }
  }

  private async currentUsage(userId: string, feature: TrialFeature): Promise<number> {
    switch (feature) {
      case 'daily_ai_requests': {
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        return this.prisma.agentJob.count({ where: { project: { userId }, createdAt: { gte: since } } });
      }
      case 'max_projects':
        return this.prisma.project.count({ where: { userId } });
      case 'publishing':
        return 0;
    }
  }
}
