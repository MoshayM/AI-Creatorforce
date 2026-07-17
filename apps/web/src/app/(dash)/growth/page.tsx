'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Loader2, CheckCircle, AlertCircle, X, Copy, Trophy, Clock, Users, AlertTriangle } from 'lucide-react';
import {
  api,
  type TrialStatusResponse,
  type Offer,
  type UpgradeRecommendation,
  type ReferralEarnings,
  type LeaderboardEntry,
} from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCredits(n: number) {
  return n.toLocaleString();
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60_000));
}

function statusChipStyle(s: string): string {
  switch (s) {
    case 'ACTIVE': return 'bg-green-50 text-green-700 border-green-200';
    case 'EXPIRED': return 'bg-red-50 text-red-700 border-red-200';
    case 'CONVERTED': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'PENDING_REVIEW': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'REVOKED': return 'bg-gray-100 text-gray-500 border-gray-200';
    case 'PENDING': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case 'QUALIFIED': return 'bg-green-50 text-green-700 border-green-200';
    case 'REWARDED': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'FLAGGED': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

function offerTypeBadge(type: string): string {
  switch (type) {
    case 'FIRST_RECHARGE': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'WELCOME': return 'bg-purple-50 text-purple-700 border-purple-200';
    case 'LOYALTY': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'WINBACK': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'LOW_CREDIT': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

function reasonLabel(code: string): string {
  const map: Record<string, string> = {
    low_trial_credits: "You're running low on trial credits",
    trial_expiring: 'Your trial is expiring soon',
    video_heavy: 'You are a heavy video user — unlock more renders',
    clip_heavy: 'You generate a lot of clips — upgrade for higher limits',
    chat_heavy: 'You rely heavily on AI chat — upgrade for more usage',
  };
  return map[code] ?? code.replace(/_/g, ' ');
}

// ── Trial Status Card ─────────────────────────────────────────────────────────

function TrialStatusCard() {
  const { data, isError, isLoading } = useQuery<TrialStatusResponse>({
    queryKey: ['trial-status'],
    queryFn: () => api.trial.status().then((r) => r.data),
    retry: false,
  });

  if (isLoading) return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
    </div>
  );
  if (isError || !data?.hasTrial) return null;

  const { status, creditsGranted, trialCreditsRemaining, expiresAt } = data;
  const days = expiresAt ? daysUntil(expiresAt) : null;
  const pct = creditsGranted && creditsGranted > 0 && trialCreditsRemaining !== undefined
    ? Math.min(100, Math.round((trialCreditsRemaining / creditsGranted) * 100))
    : 0;

  if (status === 'CONVERTED') {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
        <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
        <div>
          <span className="text-sm font-semibold text-gray-800">Trial converted</span>
          <span className="ml-1 text-gray-500 text-sm">— you are on a paid plan now.</span>
        </div>
      </div>
    );
  }

  const expiryColor = days === null ? '' : days <= 0 ? 'text-red-600' : days <= 3 ? 'text-amber-600' : 'text-gray-500';

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-brand-600" />
        <span className="text-sm font-semibold text-gray-800">Free Trial</span>
        {status && (
          <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${statusChipStyle(status)}`}>
            {status.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {trialCreditsRemaining !== undefined && creditsGranted !== undefined && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{fmtCredits(trialCreditsRemaining)} remaining</span>
            <span>{fmtCredits(creditsGranted)} granted</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pct > 30 ? 'bg-brand-500' : pct > 10 ? 'bg-amber-400' : 'bg-red-400'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-gray-500">{pct}% remaining</p>
        </div>
      )}

      {days !== null && expiresAt && (
        <p className={`text-xs font-medium ${expiryColor}`}>
          {days <= 0
            ? 'Trial expired'
            : `Expires in ${days} day${days === 1 ? '' : 's'} (${new Date(expiresAt).toLocaleDateString()})`}
        </p>
      )}
    </div>
  );
}

// ── Upgrade Nudges ────────────────────────────────────────────────────────────

function UpgradeNudges() {
  const qc = useQueryClient();
  const { data: recs = [], isLoading } = useQuery<UpgradeRecommendation[]>({
    queryKey: ['upgrade-recommendations'],
    queryFn: () => api.upgrade.recommendations().then((r) => r.data),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.upgrade.dismiss(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['upgrade-recommendations'] }),
  });

  if (isLoading || recs.length === 0) return null;

  return (
    <section className="space-y-2">
      {recs.map((rec) => (
        <div
          key={rec.id}
          className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 flex items-center gap-3"
        >
          <AlertCircle className="w-4 h-4 text-brand-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-800">{reasonLabel(rec.reasonCode)}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Recommended plan: <span className="font-semibold">{rec.recommendedPlan}</span>
            </p>
          </div>
          <a
            href="/wallet"
            className="shrink-0 text-xs font-semibold text-brand-700 hover:underline px-2 py-1 rounded"
          >
            Upgrade
          </a>
          <button
            onClick={() => dismissMutation.mutate(rec.id)}
            aria-label="Dismiss recommendation"
            className="shrink-0 text-gray-500 hover:text-gray-600 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </section>
  );
}

// ── Offer Center ──────────────────────────────────────────────────────────────

function OfferCenter() {
  const qc = useQueryClient();
  const { data: offers = [], isLoading } = useQuery<Offer[]>({
    queryKey: ['offers'],
    queryFn: () => api.offers.mine().then((r) => r.data),
  });

  const [successId, setSuccessId] = useState<string | null>(null);

  const redeemMutation = useMutation({
    mutationFn: (id: string) => api.offers.redeem(id),
    onSuccess: (_data, id) => {
      setSuccessId(id);
      void qc.invalidateQueries({ queryKey: ['wallet-balance'] });
      void qc.invalidateQueries({ queryKey: ['offers'] });
    },
  });

  if (isLoading) return <div className="bg-white border border-gray-200 rounded-xl p-4"><Loader2 className="w-5 h-5 animate-spin text-brand-600" /></div>;
  if (offers.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <Gift className="w-4 h-4 text-brand-600" />
        <span className="text-sm font-semibold text-gray-800">Offer Center</span>
      </div>
      <div className="divide-y divide-gray-50">
        {offers.map((offer) => (
          <div key={offer.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${offerTypeBadge(offer.type)}`}>
                  {offer.type.replace(/_/g, ' ')}
                </span>
                <span className="text-sm font-medium text-gray-800">{offer.name}</span>
              </div>
              <p className="text-xs text-green-700 font-semibold">+{fmtCredits(offer.rewardValue)} bonus credits</p>
              {offer.minRechargeMinor !== null && (
                <p className="text-xs text-gray-500">
                  Applied automatically on recharge &ge; ${(offer.minRechargeMinor / 100).toFixed(2)}
                </p>
              )}
              {offer.validTo && (
                <p className="text-xs text-gray-500">
                  Expires {new Date(offer.validTo).toLocaleDateString()}
                </p>
              )}
            </div>
            <div className="shrink-0">
              {successId === offer.id ? (
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> Redeemed!
                </span>
              ) : offer.redeemable ? (
                <button
                  onClick={() => redeemMutation.mutate(offer.id)}
                  disabled={redeemMutation.isPending && redeemMutation.variables === offer.id}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-700 disabled:opacity-50"
                >
                  {redeemMutation.isPending && redeemMutation.variables === offer.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : null}
                  Redeem
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {redeemMutation.isError && (
        <p className="text-xs text-red-500 px-4 pb-3">{getErrorMessage(redeemMutation.error) || 'Redemption failed'}</p>
      )}
    </div>
  );
}

// ── Referral Center ───────────────────────────────────────────────────────────

function ReferralCenter() {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [redeemInput, setRedeemInput] = useState('');
  const [redeemError, setRedeemError] = useState('');
  const [redeemSuccess, setRedeemSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: earnings, isLoading: earningsLoading } = useQuery<ReferralEarnings>({
    queryKey: ['referral-earnings'],
    queryFn: () => api.referral.earnings().then((r) => r.data),
  });

  const { data: leaderboard = [], isLoading: lbLoading } = useQuery<LeaderboardEntry[]>({
    queryKey: ['referral-leaderboard'],
    queryFn: () => api.referral.leaderboard().then((r) => r.data),
  });

  // get-or-create referral code on mount
  const { data: codeData, isLoading: codeLoading } = useQuery<{ code: string }>({
    queryKey: ['referral-code'],
    queryFn: () => api.referral.code().then((r) => r.data),
  });

  // On mount, check localStorage for pending referral code
  useEffect(() => {
    const pending = localStorage.getItem('cf.pendingReferralCode');
    if (pending) setRedeemInput(pending);
  }, []);

  const redeemMutation = useMutation({
    mutationFn: (code: string) => api.referral.redeem(code),
    onSuccess: () => {
      setRedeemSuccess(true);
      setRedeemError('');
      localStorage.removeItem('cf.pendingReferralCode');
      void qc.invalidateQueries({ queryKey: ['referral-earnings'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setRedeemError(msg ?? getErrorMessage(err) ?? 'Redemption failed');
    },
  });

  const shareUrl = codeData ? `${window.location.origin}/register?ref=${codeData.code}` : '';

  async function copyCode(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (inputRef.current) {
        inputRef.current.select();
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* Share section */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-brand-600" />
          <span className="text-sm font-semibold text-gray-800">Referral Center</span>
        </div>

        {codeLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-600" />}

        {codeData && (
          <>
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Your referral code</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold tracking-widest text-brand-700 font-mono">{codeData.code}</span>
                <button
                  onClick={() => void copyCode(codeData.code)}
                  aria-label="Copy referral code"
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-brand-600 hover:border-brand-300 transition-colors"
                >
                  {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-gray-500">Share link</p>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-700 focus:outline-none"
                />
                <button
                  onClick={() => void copyCode(shareUrl)}
                  aria-label="Copy share link"
                  className="px-3 py-2 border border-gray-200 rounded-lg text-gray-500 hover:text-brand-600 hover:border-brand-300 transition-colors text-xs"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Earnings summary */}
        {earningsLoading && <Loader2 className="w-4 h-4 animate-spin text-brand-600" />}
        {earnings && (
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col bg-gray-50 rounded-lg px-3 py-2 min-w-[80px]">
              <span className="text-xs text-gray-500">Total earned</span>
              <span className="text-lg font-bold text-gray-800">{fmtCredits(earnings.totalCredits)}</span>
              <span className="text-[10px] text-gray-500">credits</span>
            </div>
            <div className="flex flex-col bg-green-50 rounded-lg px-3 py-2 min-w-[80px]">
              <span className="text-xs text-gray-500">Qualified</span>
              <span className="text-lg font-bold text-green-700">{earnings.qualifiedCount}</span>
            </div>
            <div className="flex flex-col bg-yellow-50 rounded-lg px-3 py-2 min-w-[80px]">
              <span className="text-xs text-gray-500">Pending</span>
              <span className="text-lg font-bold text-yellow-700">{earnings.pendingCount}</span>
            </div>
            {earnings.flaggedCount > 0 && (
              <div className="flex flex-col bg-red-50 rounded-lg px-3 py-2 min-w-[80px]">
                <span className="text-xs text-gray-500">Under review</span>
                <span className="text-lg font-bold text-red-600">{earnings.flaggedCount}</span>
              </div>
            )}
          </div>
        )}

        {/* Referrals table */}
        {earnings && earnings.referrals.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-gray-700">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="text-left pb-2 font-medium">Date</th>
                  <th className="text-left pb-2 font-medium">Status</th>
                  <th className="text-right pb-2 font-medium">Reward</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {earnings.referrals.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 text-gray-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="py-1.5">
                      <span className={`border rounded-full px-2 py-0.5 text-[10px] font-medium ${statusChipStyle(r.status)}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-semibold text-green-700">+{fmtCredits(r.reward)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Redeem referral code */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-800">Have a referral code?</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={redeemInput}
            onChange={(e) => { setRedeemInput(e.target.value); setRedeemError(''); setRedeemSuccess(false); }}
            placeholder="Enter code"
            aria-label="Referral code input"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            onClick={() => { if (redeemInput.trim()) redeemMutation.mutate(redeemInput.trim()); }}
            disabled={!redeemInput.trim() || redeemMutation.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {redeemMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Apply
          </button>
        </div>
        {redeemError && (
          <p className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {redeemError}
          </p>
        )}
        {redeemSuccess && (
          <p className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            Referral code applied successfully!
          </p>
        )}
      </div>

      {/* Leaderboard */}
      {!lbLoading && leaderboard.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-gray-800">Referral Leaderboard</span>
            <span className="text-xs text-gray-500">(top 10)</span>
          </div>
          <div className="divide-y divide-gray-50">
            {leaderboard.slice(0, 10).map((entry) => (
              <div
                key={entry.rank}
                className={`flex items-center gap-3 px-4 py-2.5 ${entry.userLabel.includes('(you)') ? 'bg-brand-50' : ''}`}
              >
                <span className={`text-sm font-bold w-6 text-center ${entry.rank <= 3 ? 'text-amber-500' : 'text-gray-500'}`}>
                  {entry.rank}
                </span>
                <span className="flex-1 text-sm text-gray-700 truncate">{entry.userLabel}</span>
                <div className="text-right text-xs text-gray-500">
                  <p className="font-semibold text-gray-800">{entry.qualifiedCount} referred</p>
                  <p>{fmtCredits(entry.totalCredits)} credits</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GrowthPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-10">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Gift className="w-6 h-6 text-brand-600" />
        Growth
      </h1>

      <TrialStatusCard />
      <UpgradeNudges />

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Offers</h2>
        <OfferCenter />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Invite &amp; Earn</h2>
        <ReferralCenter />
      </section>
    </div>
  );
}
