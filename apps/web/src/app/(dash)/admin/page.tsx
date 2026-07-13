'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart2,
  Cpu,
  DollarSign,
  PiggyBank,
  RefreshCw,
  ShieldAlert,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react';
import { StatCard, PastelBars } from '@/components/stat-card';
import { api, type AdminProvider, type EnterpriseMetrics, type ForecastRow } from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Minor units (cents) → "$1,234". */
function money(minor: number): string {
  return `$${(minor / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** USD float → "$12.34". */
function usd(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

const MONTH_LABELS = (count: number): string[] => {
  // Buckets are 30-day windows oldest-first; label them relative to now.
  return Array.from({ length: count }, (_, i) => {
    const monthsAgo = count - 1 - i;
    return monthsAgo === 0 ? 'now' : `-${monthsAgo}mo`;
  });
};

function ProviderStatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700',
    DEGRADED: 'bg-amber-100 text-amber-700',
    DISABLED: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}

const FORECAST_LABELS: Record<string, string> = {
  revenue: 'Revenue (30d)',
  cost: 'AI cost (30d)',
  subscription: 'Subscriptions (30d)',
};

/**
 * Forecast units differ per metric (BI fetchMetricBuckets): revenue is in
 * minor units, cost is a USD float, subscription is a count.
 */
function formatForecastValue(metric: string, v: number): string {
  if (metric === 'revenue') return money(v);
  if (metric === 'cost') return usd(v);
  return Math.round(v).toLocaleString();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<EnterpriseMetrics | null>(null);
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Metrics gate the page (admin:revenue); providers need admin:providers
      // and may 403 independently for some roles — degrade to an empty list.
      const [m, f] = await Promise.all([api.admin.enterpriseMetrics(), api.admin.forecasts()]);
      setMetrics(m.data);
      setForecasts(f.data);
      try {
        const p = await api.admin.providers();
        setProviders(p.data);
      } catch {
        setProviders([]);
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 403) setForbidden(true);
      else setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGenerateForecasts() {
    setGenerating(true);
    try {
      await api.admin.generateForecasts();
      const f = await api.admin.forecasts();
      setForecasts(f.data);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  if (forbidden) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full text-center">
        <ShieldAlert className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-sm font-semibold text-gray-600">Admin access required</p>
        <p className="text-xs text-gray-500 mt-1">This dashboard is available to platform owners and super admins.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Revenue, AI economics, forecasts and provider health</p>
        </div>
        <button
          type="button"
          onClick={() => { void load(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {loading && !metrics ? (
        <p className="text-sm text-gray-500 py-16 text-center">Loading enterprise metrics…</p>
      ) : metrics ? (
        <>
          {/* ── North star (docs4/01: published videos / active channel) ──── */}
          <div className="grid grid-cols-1">
            <StatCard
              tone="lilac"
              icon={<Star className="w-5 h-5" />}
              label="North star — published videos per active channel (30d)"
              value={(metrics.northStar?.perActiveChannel ?? 0).toFixed(1)}
              sub={`${metrics.northStar?.publishedVideos30d ?? 0} published · ${metrics.northStar?.activeChannels30d ?? 0} active channels`}
              subClassName="text-gray-600"
            />
          </div>

          {/* ── KPI cards ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard tone="lilac" icon={<DollarSign className="w-5 h-5" />} label="MRR" value={money(metrics.mrr)} sub={`ARR ${money(metrics.arr)}`} subClassName="text-gray-600" />
            <StatCard tone="pink" icon={<Users className="w-5 h-5" />} label="ARPU (30d)" value={money(metrics.arpu)} sub={`LTV ${money(metrics.ltv)}`} subClassName="text-gray-600" />
            <StatCard tone="cream" icon={<TrendingUp className="w-5 h-5" />} label="Churn (30d)" value={pct(metrics.churn)} sub="cancelled / active" subClassName="text-gray-600" />
            <StatCard tone="periwinkle" icon={<PiggyBank className="w-5 h-5" />} label="Cache savings (30d)" value={usd(metrics.cacheSavingsUsd)} sub={`AI cost ${usd(metrics.aiCostUsd)}`} subClassName="text-gray-600" />
          </div>

          {/* ── Revenue + models ──────────────────────────────────────────── */}
          <div className="grid lg:grid-cols-2 gap-4">
            <section className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                <BarChart2 className="w-4 h-4 text-[#9d6ff0]" /> Revenue — last 6 periods
              </h2>
              <PastelBars
                data={metrics.revenueByMonth.map((v, i) => ({
                  label: MONTH_LABELS(metrics.revenueByMonth.length)[i],
                  value: v / 100,
                }))}
                formatValue={(v) => `$${Math.round(v).toLocaleString()}`}
              />
            </section>

            <section className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                <Cpu className="w-4 h-4 text-[#9d6ff0]" /> Most-used AI models (30d, by cost)
              </h2>
              {metrics.topModels.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">No AI usage yet</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {metrics.topModels.map((m) => (
                    <li key={m.model} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.model}</p>
                        <p className="text-[11px] text-gray-500 tabular-nums">
                          {((m.tokensIn + m.tokensOut) / 1000).toFixed(1)}k tokens
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-gray-700 tabular-nums">{usd(m.costUsd)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ── Forecasts ─────────────────────────────────────────────────── */}
          <section className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <TrendingUp className="w-4 h-4 text-[#9d6ff0]" /> Forecasts
              </h2>
              <button
                type="button"
                disabled={generating}
                onClick={() => { void handleGenerateForecasts(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f0eafc] hover:bg-[#e5dbf9] text-xs font-semibold text-[#7c4fd8] transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${generating ? 'animate-spin' : ''}`} />
                {generating ? 'Generating…' : 'Generate now'}
              </button>
            </div>
            {forecasts.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">
                No forecasts yet — they generate daily, or trigger one now.
              </p>
            ) : (
              <div className="grid sm:grid-cols-3 gap-3">
                {forecasts.map((f) => (
                  <div key={f.id} className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-500">{FORECAST_LABELS[f.metric] ?? f.metric}</p>
                    <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                      {formatForecastValue(f.metric, f.predictedValue)}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1 tabular-nums">
                      {formatForecastValue(f.metric, f.confidenceLow)} – {formatForecastValue(f.metric, f.confidenceHigh)}
                      {' · '}{f.method.replace('_', ' ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Provider health ───────────────────────────────────────────── */}
          <section className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
              <Activity className="w-4 h-4 text-[#9d6ff0]" /> AI providers
            </h2>
            {providers.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">Provider registry unavailable for your role</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-4 font-semibold">Provider</th>
                      <th className="py-2 pr-4 font-semibold">Status</th>
                      <th className="py-2 pr-4 font-semibold">Health</th>
                      <th className="py-2 pr-4 font-semibold">Failure rate</th>
                      <th className="py-2 pr-4 font-semibold">Quality</th>
                      <th className="py-2 font-semibold">Cost ($/1M in · out)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {providers.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 pr-4 font-medium text-gray-800">{p.name}</td>
                        <td className="py-2.5 pr-4"><ProviderStatusChip status={p.status} /></td>
                        <td className="py-2.5 pr-4 tabular-nums text-gray-600">{p.avgHealthScore.toFixed(0)}</td>
                        <td className="py-2.5 pr-4 tabular-nums text-gray-600">{pct(p.failureRate)}</td>
                        <td className="py-2.5 pr-4 tabular-nums text-gray-600">{p.qualityScore.toFixed(2)}</td>
                        <td className="py-2.5 tabular-nums text-gray-600">
                          {p.costRates[0]
                            ? `$${p.costRates[0].inputCost} · $${p.costRates[0].outputCost}`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
