'use client';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, TrendingDown, PlusCircle, Loader2, AlertCircle, CheckCircle, AlertTriangle, CalendarClock, Lightbulb, ShoppingBag } from 'lucide-react';
import { api, type BudgetState, type CreditForecast, type CreditLotRow, type CreditPackRow, type CreditRecommendation, type UsageSummary, type WalletTransaction } from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCredits(n: number) {
  return n.toLocaleString();
}

function entryBadgeStyle(entryType: string): React.CSSProperties {
  if (entryType === 'USAGE_DEBIT' || entryType === 'EXPIRY') return { background: '#fef2f2', color: '#b91c1c' };
  if (entryType === 'PURCHASE') return { background: '#ecfdf5', color: '#065f46' };
  if (entryType === 'TRIAL' || entryType === 'BONUS' || entryType === 'REFERRAL' || entryType === 'PROMO') return { background: '#f5f2fd', color: '#6D4AE0' };
  if (entryType === 'REFUND') return { background: '#eff6ff', color: '#1d4ed8' };
  return { background: '#f3f4f6', color: '#4b5563' };
}

function statusColor(status: BudgetState['status']): string {
  switch (status) {
    case 'OK': return 'bg-green-500';
    case 'ALERT': return 'bg-amber-500';
    case 'EXCEEDED': return 'bg-red-500';
    default: return 'bg-gray-300';
  }
}

// ── Budget card ───────────────────────────────────────────────────────────────

function BudgetCard() {
  const qc = useQueryClient();
  const { data: budget, isLoading } = useQuery<BudgetState>({
    queryKey: ['wallet-budget'],
    queryFn: () => api.wallet.budget.get().then((r) => r.data),
  });

  const [editing, setEditing] = useState(false);
  const [limitDraft, setLimitDraft] = useState('');
  const [thresholdDraft, setThresholdDraft] = useState('80');
  const [hardCapDraft, setHardCapDraft] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.wallet.budget.set({
        monthlyLimit: parseInt(limitDraft, 10) || 0,
        alertThreshold: parseInt(thresholdDraft, 10) || 80,
        hardCap: hardCapDraft,
      }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['wallet-budget'] });
    },
  });

  function startEdit() {
    if (budget) {
      setLimitDraft(String(budget.monthlyLimit));
      setThresholdDraft(String(budget.alertThreshold));
      setHardCapDraft(budget.hardCap);
    }
    setEditing(true);
  }

  if (isLoading) return (
    <div className="bg-white rounded-2xl p-4" style={{ border: '1.5px solid #e3ddf8' }}>
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} />
    </div>
  );

  const pct = budget && budget.monthlyLimit > 0 ? Math.min(100, Math.round((budget.spent / budget.monthlyLimit) * 100)) : 0;

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4" style={{ color: '#6D4AE0' }} />
          <span className="text-sm font-semibold text-gray-800">Monthly Budget</span>
          {budget && budget.status !== 'NONE' && (
            <span className="text-xs font-bold rounded-full px-2.5 py-0.5" style={
              budget.status === 'OK' ? { background: '#ecfdf5', color: '#065f46' } :
              budget.status === 'ALERT' ? { background: '#fff7ed', color: '#c2410c' } :
              { background: '#fef2f2', color: '#b91c1c' }
            }>
              {budget.status}
            </span>
          )}
        </div>
        <button
          onClick={editing ? () => setEditing(false) : startEdit}
          className="text-xs font-bold hover:underline"
          style={{ color: '#6D4AE0' }}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {!editing && budget?.status === 'NONE' && (
        <p className="text-sm text-gray-500 italic">No budget set. Set a monthly limit to track and cap spend.</p>
      )}

      {!editing && budget && budget.status !== 'NONE' && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>{fmtCredits(budget.spent)} spent</span>
            <span>{fmtCredits(budget.monthlyLimit)} limit</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${statusColor(budget.status)}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>{pct}% used</span>
            <span>{fmtCredits(budget.remaining)} remaining</span>
          </div>
          <div className="flex gap-3 text-xs text-gray-500 pt-1">
            <span>Alert at {budget.alertThreshold}%</span>
            {budget.hardCap && (
              <span className="text-red-600 font-medium">Hard cap on</span>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          <div>
            <label htmlFor="wallet-monthly-limit" className="block text-xs text-gray-600 mb-1">Monthly limit (credits, 0 = no limit)</label>
            <input
              id="wallet-monthly-limit"
              type="number"
              min={0}
              value={limitDraft}
              onChange={(e) => setLimitDraft(e.target.value)}
              className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
              style={{ border: '1.5px solid #e3e0f0' }}
              placeholder="e.g. 10000"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Alert threshold ({thresholdDraft}%)</label>
            <input
              type="range"
              min={1}
              max={100}
              value={thresholdDraft}
              onChange={(e) => setThresholdDraft(e.target.value)}
              className="w-full"
              style={{ accentColor: '#6D4AE0' }}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hardCapDraft}
              onChange={(e) => setHardCapDraft(e.target.checked)}
              className="rounded"
              style={{ accentColor: '#6D4AE0' }}
            />
            <span className="text-sm text-gray-700">Hard cap — block new AI actions when exceeded</span>
          </label>
          {hardCapDraft && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Enabling hard cap will prevent all AI usage once the monthly limit is reached.
            </p>
          )}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-2xl font-bold text-white text-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
            style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Save budget
          </button>
          {saveMutation.isError && (
            <p className="text-xs text-red-500">{getErrorMessage(saveMutation.error) || 'Save failed'}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Forecast card (docs4/10 Phase 2) ────────────────────────────────────────

function ForecastCard() {
  const { data: forecast, isLoading } = useQuery<CreditForecast>({
    queryKey: ['wallet-forecast'],
    queryFn: () => api.wallet.forecast().then((r) => r.data),
  });

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="flex items-center gap-2">
        <CalendarClock className="w-4 h-4" style={{ color: '#6D4AE0' }} />
        <span className="text-sm font-semibold text-gray-800">Forecast</span>
        <span className="text-xs text-gray-500">last {forecast?.windowDays ?? 30} days average</span>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} />}

      {forecast && forecast.dailyBurn === 0 && (
        <p className="text-sm text-gray-500 italic">No usage in the window yet — nothing to project.</p>
      )}

      {forecast && forecast.dailyBurn > 0 && (
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl p-3" style={{ background: '#faf9ff', border: '1.5px solid #e3ddf8' }}>
            <p className="text-xs text-gray-500">Daily burn</p>
            <p className="text-lg font-bold text-gray-900">{forecast.dailyBurn.toLocaleString()}</p>
            <p className="text-[11px] text-gray-500">credits/day</p>
          </div>
          <div className="rounded-2xl p-3" style={{ background: '#faf9ff', border: '1.5px solid #e3ddf8' }}>
            <p className="text-xs text-gray-500">Balance lasts</p>
            <p className="text-lg font-bold text-gray-900">
              {forecast.daysToEmpty !== null ? `~${Math.round(forecast.daysToEmpty)}d` : '—'}
            </p>
            <p className="text-[11px] text-gray-500">{forecast.emptyOn ? `empty ${forecast.emptyOn}` : 'no burn'}</p>
          </div>
          <div className="rounded-2xl p-3" style={{ background: '#faf9ff', border: '1.5px solid #e3ddf8' }}>
            <p className="text-xs text-gray-500">Month-end spend</p>
            <p className="text-lg font-bold text-gray-900">{forecast.projectedMonthEndSpend.toLocaleString()}</p>
            <p className="text-[11px] text-gray-500">projected credits</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recommendations card (docs4/10 Phase 2) ─────────────────────────────────

function RecommendationsCard() {
  const { data: recs = [], isLoading } = useQuery<CreditRecommendation[]>({
    queryKey: ['wallet-recommendations'],
    queryFn: () => api.wallet.recommendations().then((r) => r.data),
  });

  if (!isLoading && recs.length === 0) return null; // nothing to say — stay quiet

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4" style={{ color: '#6D4AE0' }} />
        <span className="text-sm font-semibold text-gray-800">Optimization Tips</span>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} />}

      <ul className="space-y-2">
        {recs.map((rec) => (
          <li
            key={rec.type}
            className="flex items-start gap-2 text-sm rounded-2xl px-3 py-2"
            style={rec.severity === 'warning'
              ? { background: '#fff7ed', border: '1.5px solid #fed7aa', color: '#c2410c' }
              : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }}
          >
            {rec.severity === 'warning'
              ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              : <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-gray-500" />}
            <span>{rec.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Usage summary card ─────────────────────────────────────────────────────────

function UsageSummaryCard() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery<UsageSummary>({
    queryKey: ['wallet-usage-summary', days],
    queryFn: () => api.wallet.usageSummary(days).then((r) => r.data),
  });

  const max = data?.byAction[0]?.credits ?? 1;

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4" style={{ color: '#6D4AE0' }} />
          <span className="text-sm font-semibold text-gray-800">Usage by Action</span>
        </div>
        <select
          aria-label="Usage window"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-white rounded-2xl px-4 py-2 text-xs text-gray-600 outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
          style={{ border: '1.5px solid #e3e0f0' }}
        >
          {[7, 14, 30, 60, 90].map((d) => (
            <option key={d} value={d}>Last {d} days</option>
          ))}
        </select>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} />}

      {data && (
        <>
          <p className="text-xs text-gray-500">
            Total: <span className="font-semibold text-gray-800">{fmtCredits(data.totalSpent)} credits</span> in the last {days} days
          </p>
          {data.byAction.length === 0 && (
            <p className="text-sm text-gray-500 italic">No usage in this period.</p>
          )}
          <div className="space-y-2">
            {data.byAction.map(({ action, credits }) => (
              <div key={action} className="space-y-0.5">
                <div className="flex justify-between text-xs text-gray-600">
                  <span className="capitalize">{action.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="font-medium">{fmtCredits(credits)}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.round((credits / max) * 100)}%`, background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Recent transactions ────────────────────────────────────────────────────────

function TransactionsCard() {
  const { data: txns = [], isLoading } = useQuery<WalletTransaction[]>({
    queryKey: ['wallet-transactions-full'],
    queryFn: () => api.wallet.transactions(50).then((r) => r.data as WalletTransaction[]),
  });

  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #f0edf9' }}>
        <span className="text-sm font-semibold text-gray-800">Recent Transactions</span>
        <span className="text-xs text-gray-500">(last 50)</span>
      </div>
      {isLoading && <div className="p-4"><Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} /></div>}
      {!isLoading && txns.length === 0 && (
        <p className="text-sm text-gray-500 italic p-4">No transactions yet.</p>
      )}
      <div>
        {txns.map((tx) => (
          <div key={tx.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#faf9ff]" style={{ borderBottom: '1px solid #f0edf9' }}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="text-[11px] font-bold rounded-full px-2.5 py-0.5 whitespace-nowrap"
                  style={entryBadgeStyle(tx.entryType)}
                >
                  {tx.entryType.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-gray-500 truncate">
                  {new Date(tx.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-sm font-semibold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {tx.amount >= 0 ? '+' : ''}{fmtCredits(tx.amount)}
              </p>
              <p className="text-[11px] text-gray-500">{fmtCredits(tx.balanceAfter)} after</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Balance card ──────────────────────────────────────────────────────────────

function BalanceCard() {
  const qc = useQueryClient();
  const { data: balance, isLoading } = useQuery<{
    balanceCredits: number;
    buckets: Record<string, number>;
    lifetimePurchased: number;
    lifetimeUsed: number;
  }>({
    queryKey: ['wallet-balance'],
    queryFn: () => api.wallet.balance().then((r) => r.data),
  });

  const [rechargeUsd, setRechargeUsd] = useState(10);
  const rechargeMutation = useMutation({
    mutationFn: (amountUsd: number) => api.wallet.recharge(amountUsd),
    onSuccess: (res) => {
      const data = res.data as { checkoutUrl: string | null };
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
      else void qc.invalidateQueries({ queryKey: ['wallet-balance'] });
    },
  });

  const BUCKET_LABELS: Record<string, string> = {
    purchasedCredits: 'Purchased',
    trialCredits: 'Trial',
    bonusCredits: 'Bonus',
    referralCredits: 'Referral',
    promotionalCredits: 'Promo',
  };

  const nonZeroBuckets = balance
    ? Object.entries(balance.buckets).filter(([, v]) => v > 0)
    : [];

  return (
    <div className="bg-white rounded-2xl p-4 space-y-4" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4" style={{ color: '#6D4AE0' }} />
        <span className="text-sm font-semibold text-gray-800">Balance</span>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} />}

      {balance && (
        <>
          <div>
            <p className="text-xs text-gray-500">Total credits</p>
            <p className="text-4xl font-bold text-gray-900">{fmtCredits(balance.balanceCredits)}</p>
          </div>

          {nonZeroBuckets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {nonZeroBuckets.map(([key, value]) => (
                <span key={key} className="text-xs rounded-full px-2.5 py-1" style={{ background: '#f5f2fd', color: '#6D4AE0', border: '1.5px solid #e3ddf8' }}>
                  {fmtCredits(value)} {BUCKET_LABELS[key] ?? key}
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-6 text-sm text-gray-500">
            <div>
              <p className="text-xs text-gray-500">All-time purchased</p>
              <p className="font-semibold text-gray-700">{fmtCredits(balance.lifetimePurchased)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">All-time used</p>
              <p className="font-semibold text-gray-700">{fmtCredits(balance.lifetimeUsed)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <select
              aria-label="Recharge amount"
              value={rechargeUsd}
              onChange={(e) => setRechargeUsd(Number(e.target.value))}
              className="bg-white rounded-2xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
              style={{ border: '1.5px solid #e3e0f0' }}
            >
              {[5, 10, 25, 50, 100].map((usd) => (
                <option key={usd} value={usd}>${usd}</option>
              ))}
            </select>
            <button
              onClick={() => rechargeMutation.mutate(rechargeUsd)}
              disabled={rechargeMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl font-bold text-white text-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
            >
              {rechargeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
              Add credits
            </button>
          </div>
          {rechargeMutation.isError && (
            <p className="text-xs text-red-500">{getErrorMessage(rechargeMutation.error) || 'Recharge failed'}</p>
          )}
        </>
      )}
    </div>
  );
}

function ExpiryTimelineCard() {
  const { data: lots = [], isLoading } = useQuery<CreditLotRow[]>({
    queryKey: ['wallet-lots'],
    queryFn: () => api.wallet.lots().then((r) => r.data),
  });

  const BUCKET_LABELS: Record<string, string> = {
    trialCredits: 'Trial',
    promotionalCredits: 'Promotional',
    bonusCredits: 'Bonus',
    referralCredits: 'Referral',
    purchasedCredits: 'Purchased',
  };

  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
  const urgencyStyle = (d: number): React.CSSProperties =>
    d <= 3 ? { background: '#fef2f2', color: '#b91c1c', border: '1.5px solid #fecaca' }
    : d <= 7 ? { background: '#fff7ed', color: '#c2410c', border: '1.5px solid #fed7aa' }
    : { background: '#f3f4f6', color: '#4b5563', border: '1.5px solid #e5e7eb' };

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="flex items-center gap-2">
        <CalendarClock className="w-4 h-4" style={{ color: '#6D4AE0' }} />
        <span className="text-sm font-semibold text-gray-800">Expiry Timeline</span>
      </div>
      {isLoading && <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} />}
      {!isLoading && lots.length === 0 && (
        <p className="text-sm text-gray-500">No active credit lots.</p>
      )}
      {lots.length > 0 && (
        <ul>
          {lots.map((lot) => (
            <li key={lot.id} className="flex items-center justify-between py-2 hover:bg-[#faf9ff]" style={{ borderBottom: '1px solid #f0edf9' }}>
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {fmtCredits(lot.remaining)} <span className="text-gray-500 font-normal">of {fmtCredits(lot.amount)}</span>{' '}
                  {(BUCKET_LABELS[lot.bucket] ?? lot.bucket).toLowerCase()} credits
                </p>
                <p className="text-[11px] text-gray-500">granted {new Date(lot.createdAt).toLocaleDateString()}</p>
              </div>
              {lot.expiresAt ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold" style={urgencyStyle(daysLeft(lot.expiresAt))}>
                  {daysLeft(lot.expiresAt) === 0 ? 'expires today' : `${daysLeft(lot.expiresAt)}d left`}
                  <span className="font-normal"> · {new Date(lot.expiresAt).toLocaleDateString()}</span>
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold" style={{ background: '#ecfdf5', color: '#065f46', border: '1.5px solid #a7f3d0' }}>never expires</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreditPacksCard() {
  const qc = useQueryClient();
  const { data: packs = [], isLoading } = useQuery<CreditPackRow[]>({
    queryKey: ['marketplace-packs'],
    queryFn: () => api.marketplace.packs().then((r) => r.data),
  });

  const buyMutation = useMutation({
    mutationFn: (packId: string) => api.wallet.rechargePack(packId),
    onSuccess: (res) => {
      const data = res.data as { checkoutUrl: string | null };
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
      else void qc.invalidateQueries({ queryKey: ['wallet-balance'] });
    },
  });

  const fmtPrice = (pack: CreditPackRow) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: pack.currency.toUpperCase() }).format(pack.priceMinor / 100);

  return (
    <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="flex items-center gap-2">
        <ShoppingBag className="w-4 h-4" style={{ color: '#6D4AE0' }} />
        <span className="text-sm font-semibold text-gray-800">Credit Packs</span>
      </div>
      {isLoading && <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} />}
      {!isLoading && packs.length === 0 && (
        <p className="text-sm text-gray-500">No credit packs available right now.</p>
      )}
      {packs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {packs.map((pack) => (
            <div key={pack.id} className="rounded-2xl p-3 flex flex-col gap-2" style={{ border: '1.5px solid #e3ddf8' }}>
              <div>
                <p className="text-sm font-semibold text-gray-800">{pack.name}</p>
                <p className="text-xs text-gray-500">{fmtCredits(pack.credits)} credits</p>
              </div>
              <div className="mt-auto flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">{fmtPrice(pack)}</span>
                <button
                  onClick={() => buyMutation.mutate(pack.id)}
                  disabled={buyMutation.isPending}
                  className="px-3 py-1.5 rounded-2xl font-bold text-white text-xs hover:opacity-90 active:scale-[0.98] disabled:opacity-50 flex items-center gap-1 transition-all"
                  style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
                >
                  {buyMutation.isPending && buyMutation.variables === pack.id
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <PlusCircle className="w-3 h-3" />}
                  Buy
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {buyMutation.isError && (
        <p className="text-xs text-red-500">{getErrorMessage(buyMutation.error) || 'Purchase failed'}</p>
      )}
    </div>
  );
}

// ── Subscription & plans (moved from Settings) ────────────────────────────────

const PLANS = [
  { id: 'STARTER', name: 'Starter', price: '$29/mo', features: ['5 videos/mo', '3 AI agents', 'Basic analytics'] },
  { id: 'PRO', name: 'Pro', price: '$79/mo', features: ['Unlimited videos', 'All 15 agents', 'Priority support', 'Analytics'] },
  { id: 'AGENCY', name: 'Agency', price: '$199/mo', features: ['Unlimited everything', 'Team seats', 'White-label', 'Dedicated support'] },
];

interface Subscription {
  plan: string;
  status: string;
  currentPeriodEnd: string;
}

function SubscriptionCard() {
  const { data: sub } = useQuery<Subscription>({
    queryKey: ['subscription'],
    queryFn: () => api.billing.getSubscription().then((r) => r.data as Subscription),
  });

  const upgradeMutation = useMutation({
    mutationFn: (plan: string) => api.billing.createCheckout(plan),
    onSuccess: (res) => {
      const data = res.data as { url: string };
      if (data.url) window.location.href = data.url;
    },
  });

  return (
    <div>
      {sub && (
        <div className="rounded-2xl p-4 mb-4" style={{ background: '#f5f2fd', border: '1.5px solid #e3ddf8' }}>
          <p className="font-semibold" style={{ color: '#6D4AE0' }}>Current plan: {sub.plan}</p>
          <p className="text-sm text-gray-600 mt-0.5">Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}</p>
        </div>
      )}
      <div className="grid grid-cols-3 gap-4">
        {PLANS.map((plan) => (
          <div key={plan.id} className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
            <h3 className="font-semibold text-gray-900">{plan.name}</h3>
            <p className="text-2xl font-bold my-2" style={{ color: '#6D4AE0' }}>{plan.price}</p>
            <ul className="space-y-1 mb-4">
              {plan.features.map((f) => (
                <li key={f} className="text-sm text-gray-600 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-green-500" /> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => upgradeMutation.mutate(plan.id)}
              disabled={upgradeMutation.isPending || sub?.plan === plan.id}
              className="w-full px-3 py-2 rounded-2xl font-bold text-white text-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
              style={sub?.plan === plan.id
                ? { background: '#f3f4f6', color: '#4b5563', border: '1.5px solid #e5e7eb' }
                : { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
            >
              {sub?.plan === plan.id ? 'Current' : 'Upgrade'}
            </button>
          </div>
        ))}
      </div>
      {upgradeMutation.isError && (
        <p className="text-xs text-red-500 mt-2">{getErrorMessage(upgradeMutation.error) || 'Checkout failed'}</p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WalletPage() {
  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
            <Wallet className="w-5 h-5" style={{ color: '#6D4AE0' }} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Billing &amp; Wallet</h1>
            <p className="text-sm text-gray-400 mt-0.5">Manage credits, subscriptions, and spending</p>
          </div>
        </div>

        {/* Balance */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Credit Balance</p>
          <BalanceCard />
        </section>

        {/* Subscription & plans (moved from Settings) */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Subscription &amp; Plans</p>
          <SubscriptionCard />
        </section>

        {/* Expiry timeline (Phase 6 §11) */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Credit Expiry</p>
          <ExpiryTimelineCard />
        </section>

        {/* Credit marketplace (Phase 6 §12) */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Buy Credits</p>
          <CreditPacksCard />
        </section>

        {/* Budget */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Monthly Budget</p>
          <BudgetCard />
        </section>

        {/* Forecast + optimization tips */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Forecast &amp; Tips</p>
          <div className="space-y-4">
            <ForecastCard />
            <RecommendationsCard />
          </div>
        </section>

        {/* Usage summary */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Usage Summary</p>
          <UsageSummaryCard />
        </section>

        {/* Transactions */}
        <section>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Transaction History</p>
          <TransactionsCard />
        </section>
      </div>
    </div>
  );
}
