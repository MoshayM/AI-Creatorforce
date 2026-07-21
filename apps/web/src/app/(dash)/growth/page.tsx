'use client';
import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Gift, Loader2, CheckCircle, AlertCircle, X, Copy, Trophy, Clock, Users, AlertTriangle,
  TrendingUp, Coins, Target, Share2, Flame, Zap, BarChart3, CheckCircle2, ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import {
  api,
  apiClient,
  type TrialStatusResponse,
  type Offer,
  type UpgradeRecommendation,
  type ReferralEarnings,
  type LeaderboardEntry,
  type UsageSummary,
  type PublishTrackingSummary,
} from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCredits(n: number | undefined | null) {
  return (n ?? 0).toLocaleString();
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60_000));
}

function statusChipStyle(s: string): string {
  switch (s) {
    case 'ACTIVE': return 'bg-[#ecfdf5] text-[#065f46]';
    case 'EXPIRED': return 'bg-red-50 text-red-700 border-red-200';
    case 'CONVERTED': return 'bg-[#f5f2fd] text-[#6D4AE0]';
    case 'PENDING_REVIEW': return 'bg-[#fff7ed] text-[#c2410c]';
    case 'REVOKED': return 'bg-[#f3f4f6] text-[#4b5563]';
    case 'PENDING': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case 'QUALIFIED': return 'bg-[#ecfdf5] text-[#065f46]';
    case 'REWARDED': return 'bg-[#f5f2fd] text-[#6D4AE0]';
    case 'FLAGGED': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-[#f3f4f6] text-[#4b5563]';
  }
}

function offerTypeBadge(type: string): string {
  switch (type) {
    case 'FIRST_RECHARGE': return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'WELCOME': return 'bg-[#f5f2fd] text-[#6D4AE0]';
    case 'LOYALTY': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'WINBACK': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'LOW_CREDIT': return 'bg-red-50 text-red-700 border-red-200';
    default: return 'bg-[#f3f4f6] text-[#4b5563]';
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
    <div className="bg-white rounded-2xl p-4" style={{ border: '1.5px solid #e3ddf8' }}>
      <Loader2 className="w-5 h-5 animate-spin text-[#6D4AE0]" />
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
      <div className="bg-white rounded-2xl p-4 flex items-center gap-3" style={{ border: '1.5px solid #e3ddf8' }}>
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
    <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-[#6D4AE0]" />
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
              className={`h-full rounded-full transition-all ${pct > 30 ? 'bg-[#6D4AE0]' : pct > 10 ? 'bg-amber-400' : 'bg-red-400'}`}
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
        <div key={rec.id} className="bg-[#f5f2fd] rounded-2xl px-4 py-3 flex items-center gap-3" style={{ border: '1.5px solid #e3ddf8' }}>
          <AlertCircle className="w-4 h-4 text-[#6D4AE0] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-800">{reasonLabel(rec.reasonCode)}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Recommended plan: <span className="font-semibold">{rec.recommendedPlan}</span>
            </p>
          </div>
          <a href="/wallet" className="shrink-0 text-xs font-semibold text-[#6D4AE0] hover:underline px-2 py-1 rounded-2xl">
            Upgrade
          </a>
          <button onClick={() => dismissMutation.mutate(rec.id)} aria-label="Dismiss" className="shrink-0 text-gray-500 hover:text-gray-600 p-1 rounded-2xl">
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

  if (isLoading) return (
    <div className="bg-white rounded-2xl p-4" style={{ border: '1.5px solid #e3ddf8' }}>
      <Loader2 className="w-5 h-5 animate-spin text-[#6D4AE0]" />
    </div>
  );
  if (offers.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <Gift className="w-4 h-4 text-[#6D4AE0]" />
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
                <p className="text-xs text-gray-500">Applied automatically on recharge &ge; ${(offer.minRechargeMinor / 100).toFixed(2)}</p>
              )}
              {offer.validTo && (
                <p className="text-xs text-gray-500">Expires {new Date(offer.validTo).toLocaleDateString()}</p>
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
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-2xl font-bold text-white text-xs disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
                >
                  {redeemMutation.isPending && redeemMutation.variables === offer.id && <Loader2 className="w-3 h-3 animate-spin" />}
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

  const { data: codeData, isLoading: codeLoading } = useQuery<{ code: string }>({
    queryKey: ['referral-code'],
    queryFn: () => api.referral.code().then((r) => r.data),
  });

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

  const shareUrl = codeData ? `${typeof window !== 'undefined' ? window.location.origin : ''}/register?ref=${codeData.code}` : '';

  async function copyCode(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      if (inputRef.current) inputRef.current.select();
    }
  }

  // Share URLs
  const shareMsg = encodeURIComponent(`Join me on Blueforce — the best AI platform for YouTube creators! Use my referral link:`);
  const twitterUrl = codeData ? `https://twitter.com/intent/tweet?text=${shareMsg}&url=${encodeURIComponent(shareUrl)}` : '#';
  const linkedInUrl = codeData ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}` : '#';
  const whatsAppUrl = codeData ? `https://wa.me/?text=${shareMsg}%20${encodeURIComponent(shareUrl)}` : '#';

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-4 space-y-4" style={{ border: '1.5px solid #e3ddf8' }}>
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[#6D4AE0]" />
          <span className="text-sm font-semibold text-gray-800">Referral Center</span>
        </div>

        {codeLoading && <Loader2 className="w-5 h-5 animate-spin text-[#6D4AE0]" />}

        {codeData && (
          <>
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Your referral code</p>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold tracking-widest text-[#6D4AE0] font-mono">{codeData.code}</span>
                <button
                  onClick={() => void copyCode(codeData.code)}
                  aria-label="Copy referral code"
                  className="p-1.5 rounded-2xl text-gray-500 hover:text-[#6D4AE0] transition-colors"
                  style={{ border: '1.5px solid #e3ddf8' }}
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
                  className="flex-1 text-xs rounded-2xl px-3 py-2 bg-gray-50 text-gray-700 focus:outline-none"
                  style={{ border: '1.5px solid #e3e0f0' }}
                />
                <button
                  onClick={() => void copyCode(shareUrl)}
                  aria-label="Copy share link"
                  className="px-3 py-2 rounded-2xl text-gray-500 hover:text-[#6D4AE0] transition-colors text-xs font-semibold"
                  style={{ border: '1.5px solid #e3ddf8' }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Share via:</span>
              <a href={twitterUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-black text-white hover:bg-gray-800 transition-colors">
                <Share2 className="w-3 h-3" /> X / Twitter
              </a>
              <a href={linkedInUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-blue-700 text-white hover:bg-blue-800 transition-colors">
                <ExternalLink className="w-3 h-3" /> LinkedIn
              </a>
              <a href={whatsAppUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-green-600 text-white hover:bg-green-700 transition-colors">
                <Share2 className="w-3 h-3" /> WhatsApp
              </a>
            </div>
          </>
        )}

        {earningsLoading && <Loader2 className="w-4 h-4 animate-spin text-[#6D4AE0]" />}
        {earnings && (
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col bg-gray-50 rounded-2xl px-3 py-2 min-w-[80px]">
              <span className="text-xs text-gray-500">Total earned</span>
              <span className="text-lg font-bold text-gray-800">{fmtCredits(earnings.totalCredits)}</span>
              <span className="text-[10px] text-gray-500">credits</span>
            </div>
            <div className="flex flex-col bg-[#ecfdf5] rounded-2xl px-3 py-2 min-w-[80px]">
              <span className="text-xs text-gray-500">Qualified</span>
              <span className="text-lg font-bold text-[#065f46]">{earnings.qualifiedCount}</span>
            </div>
            <div className="flex flex-col bg-yellow-50 rounded-2xl px-3 py-2 min-w-[80px]">
              <span className="text-xs text-gray-500">Pending</span>
              <span className="text-lg font-bold text-yellow-700">{earnings.pendingCount}</span>
            </div>
            {earnings.flaggedCount > 0 && (
              <div className="flex flex-col bg-red-50 rounded-2xl px-3 py-2 min-w-[80px]">
                <span className="text-xs text-gray-500">Under review</span>
                <span className="text-lg font-bold text-red-600">{earnings.flaggedCount}</span>
              </div>
            )}
          </div>
        )}

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

      <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
        <p className="text-sm font-semibold text-gray-800">Have a referral code?</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={redeemInput}
            onChange={(e) => { setRedeemInput(e.target.value); setRedeemError(''); setRedeemSuccess(false); }}
            placeholder="Enter code"
            aria-label="Referral code input"
            className="flex-1 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
            style={{ border: '1.5px solid #e3e0f0' }}
          />
          <button
            onClick={() => { if (redeemInput.trim()) redeemMutation.mutate(redeemInput.trim()); }}
            disabled={!redeemInput.trim() || redeemMutation.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl font-bold text-white text-sm disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
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

      {!lbLoading && leaderboard.length > 0 && (
        <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-gray-800">Referral Leaderboard</span>
            <span className="text-xs text-gray-400">(top 10)</span>
          </div>
          <div className="divide-y divide-gray-50">
            {leaderboard.slice(0, 10).map((entry) => (
              <div key={entry.rank} className={`flex items-center gap-3 px-4 py-2.5 ${entry.userLabel.includes('(you)') ? 'bg-[#f5f2fd]' : ''}`}>
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

// ── Scorecard Tab ─────────────────────────────────────────────────────────────

function ScorecardTab() {
  const { data: pubSummary, isLoading: pubLoading } = useQuery<PublishTrackingSummary>({
    queryKey: ['publishing-summary'],
    queryFn: () => api.publishing.summary().then((r) => r.data),
  });

  const statItems = [
    { label: 'Published (all time)', value: pubSummary?.published ?? '—', color: 'text-green-700', bg: 'bg-green-50' },
    { label: 'This month', value: pubSummary?.publishedThisMonth ?? '—', color: 'text-blue-700', bg: 'bg-blue-50' },
    { label: 'Scheduled', value: pubSummary?.scheduled ?? '—', color: 'text-violet-700', bg: 'bg-violet-50' },
    { label: 'Upcoming 7 days', value: pubSummary?.upcoming7d ?? '—', color: 'text-indigo-700', bg: 'bg-indigo-50' },
  ];

  return (
    <div className="space-y-6">
      <TrialStatusCard />
      <UpgradeNudges />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statItems.map((s) => (
          <div key={s.label} className={`${s.bg} rounded-2xl p-4`}>
            {pubLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            ) : (
              <p className={`text-2xl font-bold ${s.color}`}>{String(s.value)}</p>
            )}
            <p className="text-xs text-gray-600 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {pubSummary && pubSummary.failed > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">
            <span className="font-semibold">{pubSummary.failed} failed</span> publishes — <Link href="/publishing" className="underline">review in Publishing</Link>
          </p>
        </div>
      )}

      <OfferCenter />

      <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}>
        <div className="flex items-center gap-3 mb-3">
          <Zap className="w-5 h-5" />
          <span className="font-semibold text-lg">Unlock More Power</span>
        </div>
        <p className="text-sm text-white/80 mb-4">
          Upgrade to Pro for advanced analytics, unlimited AI generations, priority rendering, and multi-channel management.
        </p>
        <Link href="/wallet" className="inline-flex items-center gap-2 bg-white text-[#6D4AE0] font-semibold px-4 py-2 rounded-2xl text-sm hover:bg-[#f5f2fd] transition-colors">
          <TrendingUp className="w-4 h-4" /> View Plans
        </Link>
      </div>
    </div>
  );
}

// ── Credits Tab ───────────────────────────────────────────────────────────────

interface WalletBalance {
  balance: number;
  tier?: string;
}

function CreditsTab() {
  const { data: balance, isLoading: balLoading, isError: balError } = useQuery<WalletBalance>({
    queryKey: ['wallet-balance'],
    queryFn: () => api.wallet.balance().then((r) => r.data as WalletBalance),
    retry: 1,
  });

  const { data: usage, isLoading: usageLoading, isError: usageError } = useQuery<UsageSummary>({
    queryKey: ['wallet-usage', 30],
    queryFn: () => api.wallet.usageSummary(30).then((r) => r.data),
    retry: 1,
  });

  const topActions = usage?.byAction?.slice().sort((a, b) => b.credits - a.credits).slice(0, 6) ?? [];
  const total = topActions.reduce((s, a) => s + a.credits, 0) || 1;

  const segColors = [
    'bg-violet-500', 'bg-blue-500', 'bg-cyan-500',
    'bg-green-500', 'bg-amber-500', 'bg-pink-500',
  ];

  const actionLabels: Record<string, string> = {
    SCRIPT: 'Script Gen', RESEARCH: 'Research', FACT_CHECK: 'Fact Check',
    COMPLIANCE: 'Compliance', METADATA: 'Metadata', SEO_OPTIMIZATION: 'SEO',
    VOICE_GENERATE: 'Voice', IMAGE_GENERATE: 'Image', MUSIC_GENERATE: 'Music',
    RENDER: 'Render', THUMBNAIL: 'Thumbnail', CALENDAR_PROPOSAL: 'Calendar AI',
    FULL_PRODUCTION: 'Full Prod',
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #4f35a8 100%)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Coins className="w-5 h-5" />
          <span className="text-sm font-medium text-white/80">Current Balance</span>
        </div>
        {balLoading ? (
          <Loader2 className="w-5 h-5 animate-spin mt-2" />
        ) : balError ? (
          <p className="text-sm text-white/60 mt-2">Unable to load balance — check your connection</p>
        ) : (
          <>
            <p className="text-4xl font-bold">{balance ? fmtCredits(balance.balance) : '—'}</p>
            <p className="text-sm text-white/70 mt-1">credits{balance?.tier ? ` · ${balance.tier} plan` : ''}</p>
          </>
        )}
        <Link href="/wallet" className="inline-flex items-center gap-2 mt-4 bg-white/20 hover:bg-white/30 text-white text-sm font-medium px-4 py-2 rounded-2xl transition-colors">
          <Zap className="w-3.5 h-3.5" /> Add Credits
        </Link>
      </div>

      <div className="bg-white rounded-2xl p-5 space-y-4" style={{ border: '1.5px solid #e3ddf8' }}>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-800">Usage by Action (last 30 days)</span>
          {usage && <span className="text-xs text-gray-400 ml-auto">{fmtCredits(usage.totalSpent)} total spent</span>}
        </div>

        {usageLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : usageError ? (
          <p className="text-sm text-amber-600 py-4 text-center">Could not load usage data. The server may be unavailable.</p>
        ) : topActions.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No usage data yet</p>
        ) : (
          <>
            {/* Stacked bar */}
            <div className="flex h-5 rounded-full overflow-hidden gap-0.5">
              {topActions.map((a, i) => (
                <div
                  key={a.action}
                  className={`${segColors[i % segColors.length]} transition-all`}
                  style={{ width: `${(a.credits / total) * 100}%` }}
                  title={`${a.action}: ${fmtCredits(a.credits)}`}
                />
              ))}
            </div>

            <div className="space-y-2">
              {topActions.map((a, i) => (
                <div key={a.action} className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${segColors[i % segColors.length]}`} />
                  <span className="text-xs text-gray-700 flex-1">{actionLabels[a.action] ?? a.action.replace(/_/g, ' ')}</span>
                  <span className="text-xs font-medium text-gray-800">{fmtCredits(a.credits)}</span>
                  <span className="text-xs text-gray-400 w-10 text-right">{Math.round((a.credits / total) * 100)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
        <p className="text-sm font-semibold text-amber-800 mb-1">Credit-saving tips</p>
        <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
          <li>Use dry-run mode on the AI Calendar before generating full proposals</li>
          <li>Batch your research jobs — one deep research costs less than 3 shallow ones</li>
          <li>Enable auto-approve for low-risk compliance checks (STARTER+)</li>
        </ul>
      </div>
    </div>
  );
}

// ── Goals Tab ─────────────────────────────────────────────────────────────────

interface ContentGoals {
  weeklyVideos: number;
  monthlyShortsTarget: number;
}

const GOALS_KEY = 'cf_content_goals';

function GoalsTab() {
  const [goals, setGoals] = useState<ContentGoals>({ weeklyVideos: 2, monthlyShortsTarget: 4 });
  const [saved, setSaved] = useState(false);
  const [tip, setTip] = useState('');
  const [tipLoading, setTipLoading] = useState(false);

  const { data: pubSummary } = useQuery<PublishTrackingSummary>({
    queryKey: ['publishing-summary'],
    queryFn: () => api.publishing.summary().then((r) => r.data),
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(GOALS_KEY);
      if (raw) setGoals(JSON.parse(raw) as ContentGoals);
    } catch { /* ignore */ }
  }, []);

  function saveGoals() {
    localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function loadTip() {
    setTipLoading(true);
    setTip('');
    try {
      const res = await apiClient.post('/content/research', {
        topic: 'content creation strategy for YouTube',
        niche: 'general',
        language: 'en',
      });
      const data = res.data as { summary?: string; keyFacts?: string[] };
      setTip(data.summary ?? (data.keyFacts?.[0] ?? 'Keep consistent! Posting regularly is the #1 growth driver.'));
    } catch {
      setTip('Keep consistent! Posting at least 2x per week is the #1 growth driver for new channels.');
    } finally {
      setTipLoading(false);
    }
  }

  const publishedThisMonth = pubSummary?.publishedThisMonth ?? 0;
  const monthlyVideoTarget = goals.weeklyVideos * 4;
  const videoProgress = Math.min(100, Math.round((publishedThisMonth / Math.max(monthlyVideoTarget, 1)) * 100));

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl p-5 space-y-5" style={{ border: '1.5px solid #e3ddf8' }}>
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[#6D4AE0]" />
          <span className="text-sm font-semibold text-gray-800">Content Goals</span>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 block mb-2">Weekly video target</label>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <button
                  key={n}
                  onClick={() => setGoals((g) => ({ ...g, weeklyVideos: n }))}
                  className={`w-9 h-9 rounded-2xl text-sm font-semibold border transition-colors ${goals.weeklyVideos === n ? 'text-white' : 'bg-gray-50 text-gray-700 hover:border-[#6D4AE0]/40'}`}
                  style={goals.weeklyVideos === n ? { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', border: 'none' } : { border: '1.5px solid #e3ddf8' }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 block mb-2">Monthly Shorts target</label>
            <div className="flex gap-2 flex-wrap">
              {[0, 2, 4, 8, 12, 16, 20].map((n) => (
                <button
                  key={n}
                  onClick={() => setGoals((g) => ({ ...g, monthlyShortsTarget: n }))}
                  className={`px-3 h-9 rounded-2xl text-sm font-semibold border transition-colors ${goals.monthlyShortsTarget === n ? 'text-white' : 'bg-gray-50 text-gray-700 hover:border-[#6D4AE0]/40'}`}
                  style={goals.monthlyShortsTarget === n ? { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', border: 'none' } : { border: '1.5px solid #e3ddf8' }}
                >
                  {n === 0 ? 'None' : n}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={saveGoals}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-bold text-white text-sm"
            style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
          >
            {saved ? <CheckCircle2 className="w-4 h-4" /> : <Target className="w-4 h-4" />}
            {saved ? 'Saved!' : 'Save Goals'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 space-y-4" style={{ border: '1.5px solid #e3ddf8' }}>
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-semibold text-gray-800">This Month</span>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-600">Videos published</span>
              <span className="font-medium text-gray-800">{publishedThisMonth} / {monthlyVideoTarget} target</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${videoProgress >= 100 ? 'bg-green-500' : videoProgress >= 50 ? 'bg-[#6D4AE0]' : 'bg-amber-400'}`}
                style={{ width: `${videoProgress}%` }}
              />
            </div>
            {videoProgress >= 100 && (
              <p className="text-xs text-green-600 font-medium mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Goal reached!
              </p>
            )}
          </div>

          {goals.monthlyShortsTarget > 0 && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600">Shorts</span>
                <span className="font-medium text-gray-800">0 / {goals.monthlyShortsTarget} target</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-pink-400" style={{ width: '0%' }} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-gray-800">AI Strategy Tip</span>
          </div>
          <button
            onClick={() => void loadTip()}
            disabled={tipLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-2xl text-xs hover:bg-amber-100 disabled:opacity-50"
          >
            {tipLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Get Tip
          </button>
        </div>
        {tip ? (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <p className="text-sm text-amber-800">{tip}</p>
          </div>
        ) : (
          <p className="text-xs text-gray-400">Click "Get Tip" for an AI-powered content strategy suggestion.</p>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'scorecard' | 'referrals' | 'credits' | 'goals';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'scorecard', label: 'Scorecard', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'referrals', label: 'Referrals', icon: <Gift className="w-4 h-4" /> },
  { id: 'credits', label: 'Credits', icon: <Coins className="w-4 h-4" /> },
  { id: 'goals', label: 'Goals', icon: <Target className="w-4 h-4" /> },
];

export default function GrowthPage() {
  const [tab, setTab] = useState<Tab>('scorecard');

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-7 h-7 text-[#6D4AE0]" />
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Growth</h1>
            <p className="text-sm text-gray-400 mt-0.5">Track performance, referrals, credits, and content goals</p>
          </div>
        </div>

        <div className="flex gap-1 bg-[#f0edf9] p-1 rounded-2xl w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium transition-all ${tab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'scorecard' && <ScorecardTab />}
        {tab === 'referrals' && <ReferralCenter />}
        {tab === 'credits' && <CreditsTab />}
        {tab === 'goals' && <GoalsTab />}
      </div>
    </div>
  );
}
