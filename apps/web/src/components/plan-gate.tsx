'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';

export type Plan = 'FREE' | 'STARTER' | 'PRO' | 'AGENCY';

const PLAN_ORDER: Record<Plan, number> = { FREE: 0, STARTER: 1, PRO: 2, AGENCY: 3 };
const PLAN_LABEL: Record<Plan, string> = { FREE: 'Free', STARTER: 'Starter', PRO: 'Pro', AGENCY: 'Agency' };
const PLAN_PRICE: Record<Plan, string> = { FREE: '', STARTER: '$29/mo', PRO: '$79/mo', AGENCY: '$199/mo' };

export function planFromToken(): Plan {
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cf_token') : null;
    if (!token) return 'FREE';
    const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { plan?: string };
    const p = ((payload.plan ?? 'FREE') as string).toUpperCase() as Plan;
    return p in PLAN_ORDER ? p : 'FREE';
  } catch {
    return 'FREE';
  }
}

export function usePlan(): Plan {
  const [plan, setPlan] = useState<Plan>('FREE');
  useEffect(() => { setPlan(planFromToken()); }, []);
  return plan;
}

export function planAtLeast(userPlan: Plan, required: Plan): boolean {
  return PLAN_ORDER[userPlan] >= PLAN_ORDER[required];
}

interface PlanGateProps {
  /** Minimum plan required to see the children. */
  requiredPlan: Plan;
  children?: React.ReactNode;
  /** Short label shown in the locked overlay, e.g. "AI Analysis". */
  featureLabel?: string;
  /** Blur + dim the children when locked (default true). */
  preview?: boolean;
}

/**
 * Wraps content that requires a minimum subscription plan.
 * Shows a locked overlay with an upgrade CTA for users below the required tier.
 * The API always enforces the real gate; this is a UI affordance only.
 */
export function PlanGate({ requiredPlan, children, featureLabel, preview = true }: PlanGateProps) {
  const userPlan = usePlan();
  const allowed = planAtLeast(userPlan, requiredPlan);

  if (allowed) return <>{children}</>;

  return (
    <div className="relative rounded-2xl overflow-hidden">
      {preview && (
        <div className="opacity-25 pointer-events-none select-none blur-[2px]">
          {children}
        </div>
      )}
      <div
        className={`${preview ? 'absolute inset-0' : 'py-16'} flex flex-col items-center justify-center z-10`}
        style={{
          background: preview ? 'rgba(250,249,255,0.88)' : 'white',
          backdropFilter: preview ? 'blur(4px)' : undefined,
          border: preview ? undefined : '1.5px dashed #c4b5fd',
          borderRadius: preview ? undefined : 16,
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}
        >
          <Lock className="w-6 h-6" style={{ color: '#6D4AE0' }} />
        </div>

        <p className="text-sm font-extrabold text-gray-900 mb-1 text-center px-6">
          {featureLabel ? `${featureLabel} requires ` : 'Requires '}
          <span style={{ color: '#6D4AE0' }}>{PLAN_LABEL[requiredPlan]}</span>
          {PLAN_PRICE[requiredPlan] && (
            <span className="text-gray-400 font-medium"> ({PLAN_PRICE[requiredPlan]})</span>
          )}
        </p>
        <p className="text-xs text-gray-400 mb-5 text-center px-10 leading-relaxed">
          {requiredPlan === 'PRO'
            ? 'Unlock AI-powered analytics, growth reports, all 15 AI agents, and unlimited publishing.'
            : requiredPlan === 'AGENCY'
            ? 'Unlock team seats, white-label, and dedicated support for your agency.'
            : 'Unlock AI agent workflows, 5 videos/month, and basic analytics.'}
        </p>

        <Link
          href="/wallet"
          className="flex items-center gap-2 px-6 py-2.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
            boxShadow: '0 4px 16px rgba(109,74,224,0.30)',
          }}
        >
          Upgrade to {PLAN_LABEL[requiredPlan]}
        </Link>

        <p className="text-[11px] text-gray-400 mt-3">
          Current plan: <span className="font-semibold">{PLAN_LABEL[userPlan]}</span>
        </p>
      </div>
    </div>
  );
}
