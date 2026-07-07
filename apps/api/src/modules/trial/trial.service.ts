import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { AbuseDecision, TrialGrant } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

/** Normalized-email hash — the one-trial-per-verified-identity key (§5/§6). */
export function identityKeyFor(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export interface AbuseInputs {
  duplicateDevice: boolean;
  duplicateIp: boolean;
  isVpn: boolean;
}

export interface AbuseVerdict {
  fraudScore: number;
  riskScore: number;
  decision: AbuseDecision;
}

/**
 * Rule-based abuse scoring (Phase 6 §6): duplicate device is the strongest
 * fraud signal, duplicate IP moderate (shared households exist), VPN weak on
 * its own. Fail-closed thresholds: ambiguity lands in REVIEW, never in an
 * automatic grant. Pure — exported for tests.
 */
export function scoreAbuse(inputs: AbuseInputs): AbuseVerdict {
  const fraudScore = (inputs.duplicateDevice ? 0.6 : 0) + (inputs.duplicateIp ? 0.25 : 0);
  const riskScore = Math.min(1, fraudScore + (inputs.isVpn ? 0.15 : 0));
  const decision: AbuseDecision = fraudScore >= 0.6 ? 'BLOCK' : riskScore >= 0.35 ? 'REVIEW' : 'ALLOW';
  return { fraudScore: Number(fraudScore.toFixed(2)), riskScore: Number(riskScore.toFixed(2)), decision };
}

/** Effective status: expiry is derived, never trusted from the stored row. */
export function effectiveTrialStatus(grant: Pick<TrialGrant, 'status' | 'expiresAt'>, now = new Date()): TrialGrant['status'] {
  if (grant.status === 'ACTIVE' && grant.expiresAt < now) return 'EXPIRED';
  return grant.status;
}

export function trialCreditsConfig(): number {
  const v = Number(process.env['TRIAL_CREDITS']);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : 100;
}

/**
 * Free trial system (Phase 6 §5): the trial is an ordinary credit lot
 * (bucket=trialCredits, consumed first, expiring via the existing lot
 * machinery) plus a trial_grants row whose unique identityKey is the hard
 * one-trial backstop. Abuse scoring gates the grant; REVIEW parks the user
 * for a Super Admin decision instead of granting.
 */
@Injectable()
export class TrialService {
  private readonly logger = new Logger(TrialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async grantTrial(userId: string, email: string, opts: { deviceFingerprint?: string; ip?: string; verificationMethod?: string } = {}) {
    const credits = trialCreditsConfig();
    if (credits === 0) return null; // trials disabled

    const identityKey = identityKeyFor(email);
    const existing = await this.prisma.trialGrant.findFirst({
      where: { OR: [{ userId }, { identityKey }] },
    });
    if (existing) return existing; // hard backstop: one trial, ever

    const fingerprint = opts.deviceFingerprint?.slice(0, 128);
    const ipHash = opts.ip ? createHash('sha256').update(opts.ip).digest('hex') : undefined;
    const [dupDevice, dupIp] = await Promise.all([
      fingerprint ? this.prisma.trialGrant.count({ where: { deviceFingerprint: fingerprint } }) : Promise.resolve(0),
      ipHash ? this.prisma.trialGrant.count({ where: { ipHash } }) : Promise.resolve(0),
    ]);
    const verdict = scoreAbuse({ duplicateDevice: dupDevice > 0, duplicateIp: dupIp >= 3, isVpn: false });

    await this.prisma.abuseSignal.create({
      data: {
        userId,
        deviceFingerprint: fingerprint,
        ipHash,
        duplicateDevice: dupDevice > 0,
        duplicateIp: dupIp >= 3,
        fraudScore: verdict.fraudScore,
        riskScore: verdict.riskScore,
        decision: verdict.decision,
      },
    });

    if (verdict.decision === 'BLOCK') {
      this.logger.warn(`[trial] BLOCKED for ${userId} (fraud ${verdict.fraudScore})`);
      return null;
    }

    const expiryDays = Math.max(1, Number(process.env['TRIAL_EXPIRY_DAYS']) || 15);
    const grant = await this.prisma.trialGrant.create({
      data: {
        userId,
        identityKey,
        creditsGranted: verdict.decision === 'ALLOW' ? credits : 0,
        status: verdict.decision === 'ALLOW' ? 'ACTIVE' : 'PENDING_REVIEW',
        verificationMethod: opts.verificationMethod ?? 'email',
        deviceFingerprint: fingerprint,
        ipHash,
        expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60_000),
      },
    });
    if (verdict.decision === 'ALLOW') {
      await this.creditTrialLot(userId, credits, identityKey);
      this.logger.log(`[trial] +${credits} trial credits → ${userId}`);
    }
    return grant;
  }

  private async creditTrialLot(userId: string, credits: number, identityKey: string) {
    await this.wallet.credit(userId, {
      entryType: 'TRIAL',
      amount: credits,
      referenceType: 'ADMIN_ACTION',
      idempotencyKey: `trial:${identityKey}`,
      metadata: { source: 'trial' },
    });
  }

  /** Super Admin approves a PENDING_REVIEW grant after manual review (§6 override). */
  async approvePendingTrial(userId: string, adminId: string) {
    const grant = await this.prisma.trialGrant.findUnique({ where: { userId } });
    if (!grant || grant.status !== 'PENDING_REVIEW') throw new BadRequestException('No trial pending review for this user');
    const credits = trialCreditsConfig();
    await this.creditTrialLot(userId, credits, grant.identityKey);
    const updated = await this.prisma.trialGrant.update({
      where: { userId },
      data: { status: 'ACTIVE', creditsGranted: credits },
    });
    await this.prisma.auditLog.create({
      data: { userId: adminId, action: 'admin:trial-approved', target: userId, meta: { credits } as never },
    });
    return updated;
  }

  async status(userId: string) {
    const grant = await this.prisma.trialGrant.findUnique({ where: { userId } });
    if (!grant) return { hasTrial: false as const };
    const wallet = await this.wallet.getBalance(userId);
    return {
      hasTrial: true as const,
      status: effectiveTrialStatus(grant),
      creditsGranted: grant.creditsGranted,
      trialCreditsRemaining: wallet.buckets.trialCredits,
      grantedAt: grant.grantedAt,
      expiresAt: grant.expiresAt,
    };
  }
}
