import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { UpgradeRecommendation, UserBehaviour } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { effectiveTrialStatus } from './trial.service';

const AGGREGATE_INTERVAL_MS = 30 * 60_000;
const BOOT_DELAY_MS = 3 * 60_000;
/** Don't repeat the same nudge within this window (§8: never intrusive). */
const NUDGE_COOLDOWN_DAYS = 7;
const DISMISS_COOLDOWN_DAYS = 14;

export interface TrialSnapshot {
  active: boolean;
  usedPct: number;
  daysToExpiry: number | null;
}

export interface UpgradeRule {
  reasonCode: string;
  recommendedPlan: string;
  confidence: number;
}

/**
 * Behavior-driven upgrade rules (Phase 6 §8, mapped to this platform's real
 * features — video analysis, clip rendering, copilot chat). Pure — exported
 * for tests.
 */
export function evaluateUpgradeRules(b: Pick<UserBehaviour, 'chatsSent' | 'videosAnalyzed' | 'clipsGenerated' | 'rendersRun'>, trial: TrialSnapshot): UpgradeRule[] {
  const rules: UpgradeRule[] = [];
  if (trial.active && trial.usedPct >= 0.8) {
    rules.push({ reasonCode: 'low_trial_credits', recommendedPlan: 'STARTER', confidence: 0.9 });
  }
  if (trial.active && trial.daysToExpiry !== null && trial.daysToExpiry <= 3) {
    rules.push({ reasonCode: 'trial_expiring', recommendedPlan: 'STARTER', confidence: 0.85 });
  }
  if (b.rendersRun >= 10 || b.videosAnalyzed >= 5) {
    rules.push({ reasonCode: 'video_heavy', recommendedPlan: 'PRO', confidence: 0.8 });
  }
  if (b.clipsGenerated >= 20) {
    rules.push({ reasonCode: 'clip_heavy', recommendedPlan: 'STARTER', confidence: 0.7 });
  }
  if (b.chatsSent >= 50) {
    rules.push({ reasonCode: 'chat_heavy', recommendedPlan: 'PRO', confidence: 0.7 });
  }
  return rules;
}

/**
 * Frequency cap (§8): a nudge is suppressed while an identical reasonCode was
 * recently created or recently dismissed. Pure — exported for tests.
 */
export function shouldNudge(
  reasonCode: string,
  history: Array<Pick<UpgradeRecommendation, 'reasonCode' | 'createdAt' | 'dismissedAt'>>,
  now = new Date(),
): boolean {
  const dayMs = 24 * 60 * 60_000;
  for (const rec of history) {
    if (rec.reasonCode !== reasonCode) continue;
    if (rec.dismissedAt && now.getTime() - rec.dismissedAt.getTime() < DISMISS_COOLDOWN_DAYS * dayMs) return false;
    if (now.getTime() - rec.createdAt.getTime() < NUDGE_COOLDOWN_DAYS * dayMs) return false;
  }
  return true;
}

/**
 * Behavior tracker + upgrade engine (Phase 6 §8): a periodic aggregation
 * rebuilds each user's UserBehaviour profile from the audit/job tables the
 * platform already writes, then evaluates the upgrade rules under the
 * frequency cap. Recommendations are recorded with a reason code; the UI
 * reads them via GET /upgrade/recommendations.
 */
@Injectable()
export class UpgradeEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpgradeEngineService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test') return;
    this.timers.push(setTimeout(() => void this.aggregateAll(), BOOT_DELAY_MS));
    this.timers.push(setInterval(() => void this.aggregateAll(), AGGREGATE_INTERVAL_MS));
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  async aggregateAll(): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({ select: { id: true } });
      for (const u of users) await this.refreshUser(u.id);
    } catch (err) {
      this.logger.warn(`[behavior] aggregation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async refreshUser(userId: string) {
    const [chats, analyzed, clips, renders, jobsTotal, lastAction, wallet, grant] = await Promise.all([
      this.prisma.actionRecord.count({ where: { userId, source: { in: ['COPILOT', 'VOICE'] } } }),
      this.prisma.agentJob.count({ where: { project: { userId }, type: 'SHORTS_ANALYZE' } }),
      this.prisma.shortClip.count({ where: { project: { userId } } }),
      this.prisma.agentJob.count({ where: { project: { userId }, type: { in: ['SHORTS_RENDER', 'RENDER'] } } }),
      this.prisma.agentJob.count({ where: { project: { userId } } }),
      this.prisma.agentJob.findFirst({ where: { project: { userId } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      this.prisma.wallet.findUnique({ where: { userId }, select: { trialCredits: true } }),
      this.prisma.trialGrant.findUnique({ where: { userId } }),
    ]);

    const usedPct = grant && grant.creditsGranted > 0
      ? Math.min(1, 1 - (wallet?.trialCredits ?? 0) / grant.creditsGranted)
      : 0;
    const behaviour = await this.prisma.userBehaviour.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    const updated = await this.prisma.userBehaviour.update({
      where: { id: behaviour.id },
      data: {
        chatsSent: chats,
        videosAnalyzed: analyzed,
        clipsGenerated: clips,
        rendersRun: renders,
        jobsTotal,
        lastActiveAt: lastAction?.createdAt ?? null,
        inactiveDays: lastAction ? Math.floor((Date.now() - lastAction.createdAt.getTime()) / (24 * 60 * 60_000)) : 0,
        trialCreditsUsedPct: Number(usedPct.toFixed(3)),
      },
    });

    const trial: TrialSnapshot = grant
      ? {
          active: effectiveTrialStatus(grant) === 'ACTIVE',
          usedPct,
          daysToExpiry: Math.ceil((grant.expiresAt.getTime() - Date.now()) / (24 * 60 * 60_000)),
        }
      : { active: false, usedPct: 0, daysToExpiry: null };

    const candidates = evaluateUpgradeRules(updated, trial);
    if (candidates.length === 0) return updated;

    const history = await this.prisma.upgradeRecommendation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    for (const c of candidates) {
      if (!shouldNudge(c.reasonCode, history)) continue;
      await this.prisma.upgradeRecommendation.create({
        data: { userId, reasonCode: c.reasonCode, recommendedPlan: c.recommendedPlan, confidence: c.confidence },
      });
    }
    return updated;
  }

  async recommendationsFor(userId: string) {
    await this.refreshUser(userId).catch(() => undefined); // responsive on read
    return this.prisma.upgradeRecommendation.findMany({
      where: { userId, dismissedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
  }

  async dismiss(recommendationId: string, userId: string) {
    await this.prisma.upgradeRecommendation.updateMany({
      where: { id: recommendationId, userId },
      data: { dismissedAt: new Date() },
    });
    return { dismissed: true };
  }
}
