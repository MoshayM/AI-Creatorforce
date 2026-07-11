'use client';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, TrendingDown, PlusCircle, Loader2, AlertCircle, CheckCircle, AlertTriangle, CalendarClock, Lightbulb } from 'lucide-react';
import { api, type BudgetState, type CreditForecast, type CreditRecommendation, type UsageSummary, type WalletTransaction } from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtCredits(n: number) {
  return n.toLocaleString();
}

function entryBadgeStyle(entryType: string): string {
  if (entryType === 'USAGE_DEBIT' || entryType === 'EXPIRY') return 'bg-red-50 text-red-700 border-red-200';
  if (entryType === 'PURCHASE') return 'bg-green-50 text-green-700 border-green-200';
  if (entryType === 'TRIAL' || entryType === 'BONUS' || entryType === 'REFERRAL' || entryType === 'PROMO') return 'bg-purple-50 text-purple-700 border-purple-200';
  if (entryType === 'REFUND') return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-gray-100 text-gray-600 border-gray-200';
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

  if (isLoading) return <div className="bg-white border border-gray-200 rounded-xl p-4"><Loader2 className="w-5 h-5 animate-spin text-brand-600" /></div>;

  const pct = budget && budget.monthlyLimit > 0 ? Math.min(100, Math.round((budget.spent / budget.monthlyLimit) * 100)) : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-brand-600" />
          <span className="text-sm font-semibold text-gray-800">Monthly Budget</span>
          {budget && budget.status !== 'NONE' && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
              budget.status === 'OK' ? 'bg-green-50 text-green-700 border-green-200' :
              budget.status === 'ALERT' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-red-50 text-red-700 border-red-200'
            }`}>
              {budget.status}
            </span>
          )}
        </div>
        <button
          onClick={editing ? () => setEditing(false) : startEdit}
          className="text-xs text-brand-600 hover:underline"
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {!editing && budget?.status === 'NONE' && (
        <p className="text-sm text-gray-400 italic">No budget set. Set a monthly limit to track and cap spend.</p>
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
          <div className="flex justify-between text-xs text-gray-400">
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
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
              className="w-full accent-brand-600"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hardCapDraft}
              onChange={(e) => setHardCapDraft(e.target.checked)}
              className="rounded border-gray-300 text-brand-600"
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
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50"
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

// ── Forecast card (Updates/10 Phase 2) ────────────────────────────────────────

function ForecastCard() {
  const { data: forecast, isLoading } = useQuery<CreditForecast>({
    queryKey: ['wallet-forecast'],
    queryFn: () => api.wallet.forecast().then((r) => r.data),
  });

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-brand-600" />
        <span className="text-sm font-semibold text-gray-800">Forecast</span>
        <span className="text-xs text-gray-400">last {forecast?.windowDays ?? 30} days average</span>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-600" />}

      {forecast && forecast.dailyBurn === 0 && (
        <p className="text-sm text-gray-400 italic">No usage in the window yet — nothing to project.</p>
      )}

      {forecast && forecast.dailyBurn > 0 && (
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Daily burn</p>
            <p className="text-lg font-bold text-gray-900">{forecast.dailyBurn.toLocaleString()}</p>
            <p className="text-[11px] text-gray-400">credits/day</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Balance lasts</p>
            <p className="text-lg font-bold text-gray-900">
              {forecast.daysToEmpty !== null ? `~${Math.round(forecast.daysToEmpty)}d` : '—'}
            </p>
            <p className="text-[11px] text-gray-400">{forecast.emptyOn ? `empty ${forecast.emptyOn}` : 'no burn'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Month-end spend</p>
            <p className="text-lg font-bold text-gray-900">{forecast.projectedMonthEndSpend.toLocaleString()}</p>
            <p className="text-[11px] text-gray-400">projected credits</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recommendations card (Updates/10 Phase 2) ─────────────────────────────────

function RecommendationsCard() {
  const { data: recs = [], isLoading } = useQuery<CreditRecommendation[]>({
    queryKey: ['wallet-recommendations'],
    queryFn: () => api.wallet.recommendations().then((r) => r.data),
  });

  if (!isLoading && recs.length === 0) return null; // nothing to say — stay quiet

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-brand-600" />
        <span className="text-sm font-semibold text-gray-800">Optimization Tips</span>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-600" />}

      <ul className="space-y-2">
        {recs.map((rec) => (
          <li
            key={rec.type}
            className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 border ${
              rec.severity === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-gray-50 border-gray-200 text-gray-700'
            }`}
          >
            {rec.severity === 'warning'
              ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              : <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />}
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
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-brand-600" />
          <span className="text-sm font-semibold text-gray-800">Usage by Action</span>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600 bg-white"
        >
          {[7, 14, 30, 60, 90].map((d) => (
            <option key={d} value={d}>Last {d} days</option>
          ))}
        </select>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-600" />}

      {data && (
        <>
          <p className="text-xs text-gray-500">
            Total: <span className="font-semibold text-gray-800">{fmtCredits(data.totalSpent)} credits</span> in the last {days} days
          </p>
          {data.byAction.length === 0 && (
            <p className="text-sm text-gray-400 italic">No usage in this period.</p>
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
                    className="h-full bg-brand-500 rounded-full"
                    style={{ width: `${Math.round((credits / max) * 100)}%` }}
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
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-800">Recent Transactions</span>
        <span className="text-xs text-gray-400">(last 50)</span>
      </div>
      {isLoading && <div className="p-4"><Loader2 className="w-5 h-5 animate-spin text-brand-600" /></div>}
      {!isLoading && txns.length === 0 && (
        <p className="text-sm text-gray-400 italic p-4">No transactions yet.</p>
      )}
      <div className="divide-y divide-gray-50">
        {txns.map((tx) => (
          <div key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 whitespace-nowrap ${entryBadgeStyle(tx.entryType)}`}>
                  {tx.entryType.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-gray-400 truncate">
                  {new Date(tx.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-sm font-semibold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {tx.amount >= 0 ? '+' : ''}{fmtCredits(tx.amount)}
              </p>
              <p className="text-[11px] text-gray-400">{fmtCredits(tx.balanceAfter)} after</p>
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
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="w-4 h-4 text-brand-600" />
        <span className="text-sm font-semibold text-gray-800">Balance</span>
      </div>

      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-600" />}

      {balance && (
        <>
          <div>
            <p className="text-xs text-gray-500">Total credits</p>
            <p className="text-4xl font-bold text-gray-900">{fmtCredits(balance.balanceCredits)}</p>
          </div>

          {nonZeroBuckets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {nonZeroBuckets.map(([key, value]) => (
                <span key={key} className="text-xs bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1 text-gray-600">
                  {fmtCredits(value)} {BUCKET_LABELS[key] ?? key}
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-6 text-sm text-gray-500">
            <div>
              <p className="text-xs text-gray-400">All-time purchased</p>
              <p className="font-semibold text-gray-700">{fmtCredits(balance.lifetimePurchased)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">All-time used</p>
              <p className="font-semibold text-gray-700">{fmtCredits(balance.lifetimeUsed)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <select
              value={rechargeUsd}
              onChange={(e) => setRechargeUsd(Number(e.target.value))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white"
            >
              {[5, 10, 25, 50, 100].map((usd) => (
                <option key={usd} value={usd}>${usd}</option>
              ))}
            </select>
            <button
              onClick={() => rechargeMutation.mutate(rechargeUsd)}
              disabled={rechargeMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WalletPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-10">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Wallet className="w-6 h-6 text-brand-600" />
        Wallet
      </h1>

      {/* Balance */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Credit Balance</h2>
        <BalanceCard />
      </section>

      {/* Budget */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Budget</h2>
        <BudgetCard />
      </section>

      {/* Forecast + optimization tips */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Forecast &amp; Tips</h2>
        <div className="space-y-4">
          <ForecastCard />
          <RecommendationsCard />
        </div>
      </section>

      {/* Usage summary */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Usage Summary</h2>
        <UsageSummaryCard />
      </section>

      {/* Transactions */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Transaction History</h2>
        <TransactionsCard />
      </section>
    </div>
  );
}
