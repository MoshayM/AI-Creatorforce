'use client';
import { useState } from 'react';
import { BarChart2, TrendingUp, TrendingDown, Minus, Lightbulb, RefreshCw, ChevronRight, Gauge, Video, AlertTriangle, MousePointerClick } from 'lucide-react';
import { ResultActions } from '@/components/result-actions';
import { AiWorkingCard, formatDuration } from '@/components/ai-activity';
import { StatCard, PastelBars, PastelDonut } from '@/components/stat-card';

interface Insight {
  metric: string;
  finding: string;
  impact: 'positive' | 'negative' | 'neutral';
  suggestion: string;
}

interface Topic {
  topic: string;
  rationale: string;
  opportunityScore: number;
}

interface AnalyticsReport {
  channelId: string;
  period: string;
  summary: string;
  overallScore: number;
  insights: Insight[];
  topPerformers: Array<{ videoId: string; title: string; ctr: number; avgWatchTimeSecs: number }>;
  retentionIssues: Array<{ sectionRef?: string; dropOffPct: number; diagnosis: string }>;
}

interface GrowthReport {
  summary: string;
  nextTopics: Topic[];
  optimizationActions: Array<{ priority: 'high' | 'medium' | 'low'; area: string; action: string; expectedImpact: string }>;
}

interface TokenUsageSummary {
  sinceDays: number;
  totals: { calls: number; tokensIn: number; tokensOut: number; costUsd: number };
  byModel: Array<{ provider: string; model: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }>;
  copilot: { turns: number; cacheHits: number; cacheHitRate: number | null };
  byVideo: Array<{ importedVideoId: string; title: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }>;
}

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api';

async function callApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = localStorage.getItem('cf_token');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

function ImpactBadge({ impact }: { impact: 'positive' | 'negative' | 'neutral' }) {
  if (impact === 'positive') return <span className="flex items-center gap-1 text-green-600 text-xs"><TrendingUp className="w-3 h-3" /> Positive</span>;
  if (impact === 'negative') return <span className="flex items-center gap-1 text-red-500 text-xs"><TrendingDown className="w-3 h-3" /> Negative</span>;
  return <span className="flex items-center gap-1 text-gray-500 text-xs"><Minus className="w-3 h-3" /> Neutral</span>;
}

function PriorityBadge({ priority }: { priority: 'high' | 'medium' | 'low' }) {
  const colors = { high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-600' };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[priority]}`}>{priority}</span>;
}

export default function AnalyticsPage() {
  const [channelId, setChannelId] = useState('');
  const [analytics, setAnalytics] = useState<AnalyticsReport | null>(null);
  const [growth, setGrowth] = useState<GrowthReport | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingGrowth, setLoadingGrowth] = useState(false);
  const [error, setError] = useState('');
  const [channels, setChannels] = useState<Array<{ id: string; title: string }>>([]);
  const [analyticsDurationMs, setAnalyticsDurationMs] = useState<number | null>(null);
  const [growthDurationMs, setGrowthDurationMs] = useState<number | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSummary | null | 'unavailable'>(null);

  useState(() => {
    callApi<Array<{ id: string; title: string }>>('/channels')
      .then(setChannels)
      .catch(() => {});
    callApi<TokenUsageSummary>('/token-usage/summary')
      .then(setTokenUsage)
      .catch(() => setTokenUsage('unavailable'));
  });

  async function runAnalytics() {
    if (!channelId) return;
    setLoadingAnalytics(true);
    setError('');
    const startedAt = Date.now();
    try {
      const report = await callApi<AnalyticsReport>(`/analytics/${channelId}/report`, 'POST');
      setAnalytics(report);
      setAnalyticsDurationMs(Date.now() - startedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analytics failed');
    } finally {
      setLoadingAnalytics(false);
    }
  }

  async function runGrowth() {
    if (!analytics) return;
    setLoadingGrowth(true);
    setError('');
    const startedAt = Date.now();
    try {
      const report = await callApi<GrowthReport>('/growth/report', 'POST', {
        channelId: analytics.channelId,
        analyticsReport: analytics,
      });
      setGrowth(report);
      setGrowthDurationMs(Date.now() - startedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Growth report failed');
    } finally {
      setLoadingGrowth(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <BarChart2 className="w-7 h-7 text-brand-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics & Growth</h1>
          <p className="text-sm text-gray-500">AI-powered channel diagnostics and next-video recommendations</p>
        </div>
      </div>

      {/* AI Usage card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
        <h2 className="font-semibold text-gray-900 mb-3">AI Usage (30 days)</h2>
        {tokenUsage === 'unavailable' ? (
          <p className="text-sm text-gray-500">unavailable</p>
        ) : tokenUsage === null ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Total cost</p>
              <p className="text-lg font-semibold text-gray-900">${tokenUsage.totals.costUsd.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Tokens in</p>
              <p className="text-lg font-semibold text-gray-900">{tokenUsage.totals.tokensIn.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Tokens out</p>
              <p className="text-lg font-semibold text-gray-900">{tokenUsage.totals.tokensOut.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Provider calls</p>
              <p className="text-lg font-semibold text-gray-900">{tokenUsage.totals.calls.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Copilot cache-hit rate</p>
              <p className="text-lg font-semibold text-gray-900">
                {tokenUsage.copilot.cacheHitRate != null
                  ? `${(tokenUsage.copilot.cacheHitRate * 100).toFixed(0)}%`
                  : '—'}
              </p>
            </div>
          </div>
        )}
        {tokenUsage !== 'unavailable' && tokenUsage !== null && (tokenUsage.byVideo ?? []).length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Cost by video</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="pb-1 font-medium">Video</th>
                  <th className="pb-1 font-medium text-right">Calls</th>
                  <th className="pb-1 font-medium text-right">Tokens</th>
                  <th className="pb-1 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {tokenUsage.byVideo.map((v) => (
                  <tr key={v.importedVideoId} className="border-t border-gray-50">
                    <td className="py-1.5 text-gray-800 truncate max-w-[280px]" title={v.title}>{v.title}</td>
                    <td className="py-1.5 text-right text-gray-600">{v.calls}</td>
                    <td className="py-1.5 text-right text-gray-600">{(v.tokensIn + v.tokensOut).toLocaleString()}</td>
                    <td className="py-1.5 text-right font-medium text-gray-900">${v.costUsd.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Channel selector + run */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 no-print">
        <label htmlFor="analytics-channel" className="block text-sm font-medium text-gray-700 mb-2">Select Channel</label>
        <div className="flex gap-3">
          {channels.length > 0 ? (
            <select
              id="analytics-channel"
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Choose a channel…</option>
              {channels.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          ) : (
            <input
              id="analytics-channel"
              type="text"
              value={channelId}
              onChange={e => setChannelId(e.target.value)}
              placeholder="Channel ID (connect a channel in Settings)"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          )}
          <button
            onClick={runAnalytics}
            disabled={!channelId || loadingAnalytics}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {loadingAnalytics ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart2 className="w-4 h-4" />}
            {loadingAnalytics ? 'Analyzing…' : 'Run Analytics'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </div>

      {loadingAnalytics && (
        <AiWorkingCard
          title="Analyzing channel performance"
          steps={[
            'Fetching channel metrics',
            'Diagnosing CTR and retention patterns',
            'Writing insights and suggestions',
          ]}
        />
      )}

      {/* Analytics report */}
      {analytics && !loadingAnalytics && (
        <div className="space-y-6 fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {analyticsDurationMs != null && `Report generated in ${formatDuration(analyticsDurationMs)}`}
              {growthDurationMs != null && ` · growth report in ${formatDuration(growthDurationMs)}`}
            </p>
            <ResultActions
              data={growth ? { analytics, growth } : analytics}
              filename={`analytics-${analytics.channelId}`}
            />
          </div>

          {/* Pastel KPI stat cards (design ref: analyse.jpg) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              tone="lilac"
              icon={<Gauge className="w-5 h-5" />}
              label="Overall Score"
              value={<>{analytics.overallScore}<span className="text-base text-gray-500 font-medium">/100</span></>}
              sub={analytics.overallScore >= 70 ? 'Healthy channel' : analytics.overallScore >= 40 ? 'Room to grow' : 'Needs attention'}
              subClassName={analytics.overallScore >= 70 ? 'text-green-600' : analytics.overallScore >= 40 ? 'text-amber-500' : 'text-red-500'}
            />
            <StatCard
              tone="pink"
              icon={<Video className="w-5 h-5" />}
              label="Videos Analysed"
              value={analytics.topPerformers.length}
              sub={analytics.period}
              subClassName="text-gray-500"
            />
            <StatCard
              tone="cream"
              icon={<AlertTriangle className="w-5 h-5" />}
              label="Retention Issues"
              value={analytics.retentionIssues.length}
              sub="drop-off points detected"
              subClassName={analytics.retentionIssues.length > 0 ? 'text-amber-600' : 'text-green-600'}
            />
            <StatCard
              tone="periwinkle"
              icon={<MousePointerClick className="w-5 h-5" />}
              label="Avg CTR"
              value={(() => {
                const ctrs = analytics.topPerformers.map((v) => v.ctr).filter((c) => Number.isFinite(c));
                return ctrs.length ? `${((ctrs.reduce((s, c) => s + c, 0) / ctrs.length) * 100).toFixed(1)}%` : '—';
              })()}
              sub="across top performers"
              subClassName="text-gray-500"
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 mb-2">Performance Overview</h2>
              <p className="text-xs text-gray-500 mb-2">Click-through rate per top video</p>
              {analytics.topPerformers.some((v) => Number.isFinite(v.ctr) && v.ctr > 0) ? (
                <PastelBars
                  data={analytics.topPerformers.map((v, i) => ({
                    label: `V${i + 1}`,
                    value: Number.isFinite(v.ctr) ? v.ctr * 100 : 0,
                    title: `${v.title} — CTR ${Number.isFinite(v.ctr) ? (v.ctr * 100).toFixed(1) : '?'}%`,
                  }))}
                  formatValue={(v) => `${v.toFixed(1)}%`}
                />
              ) : (
                <p className="text-sm text-gray-500 py-8 text-center">No CTR data available for this channel yet</p>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 mb-2">Insight Breakdown</h2>
              <p className="text-xs text-gray-500 mb-4">Impact of the findings across your channel</p>
              <PastelDonut
                segments={[
                  { label: 'Positive', value: analytics.insights.filter((i) => i.impact === 'positive').length, color: '#9fd8a5' },
                  { label: 'Negative', value: analytics.insights.filter((i) => i.impact === 'negative').length, color: '#f2a3c6' },
                  { label: 'Neutral', value: analytics.insights.filter((i) => i.impact === 'neutral').length, color: '#c9d2e3' },
                ]}
              />
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-2">Summary</h2>
            <p className="text-sm text-gray-600">{analytics.summary}</p>
          </div>

          {/* Insights */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 mb-4">Key Insights</h2>
            <div className="space-y-3">
              {analytics.insights.map((insight, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-[#f7f4fd]">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 mt-0.5 ${
                    insight.impact === 'positive' ? 'bg-[#9fd8a5]' : insight.impact === 'negative' ? 'bg-[#f2a3c6]' : 'bg-[#c9d2e3]'
                  }`}>
                    {insight.impact === 'positive' ? <TrendingUp className="w-4 h-4" /> : insight.impact === 'negative' ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{insight.metric}</span>
                      <ImpactBadge impact={insight.impact} />
                    </div>
                    <p className="text-sm text-gray-800 mb-1">{insight.finding}</p>
                    <p className="text-xs text-brand-600 flex items-center gap-1"><ChevronRight className="w-3 h-3" />{insight.suggestion}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top performers */}
          {analytics.topPerformers.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="font-semibold text-gray-900 mb-4">Top Performers</h2>
              <div className="space-y-2">
                {analytics.topPerformers.map((v, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-[#f7f4fd]">
                    <p className="text-sm font-medium text-gray-800 flex-1 truncate">{v.title}</p>
                    <div className="flex gap-4 text-xs text-gray-500 ml-4 shrink-0">
                      <span>CTR {(v.ctr * 100).toFixed(1)}%</span>
                      <span>Avg {Math.round(v.avgWatchTimeSecs)}s</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Growth button */}
          {loadingGrowth && (
            <AiWorkingCard
              title="Generating growth report"
              steps={[
                'Reviewing your analytics report',
                'Ranking next-topic opportunities',
                'Prioritizing optimization actions',
              ]}
            />
          )}
          {!growth && !loadingGrowth && (
            <button
              onClick={runGrowth}
              disabled={loadingGrowth}
              className="no-print w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-brand-300 rounded-xl text-brand-600 font-medium hover:bg-brand-50 disabled:opacity-50"
            >
              {loadingGrowth ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              {loadingGrowth ? 'Generating growth recommendations…' : 'Generate Growth Report & Next Topics'}
            </button>
          )}

          {/* Growth report */}
          {growth && !loadingGrowth && (
            <div className="space-y-4 fade-in">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-brand-600" /> Growth Summary</h2>
                <p className="text-sm text-gray-600">{growth.summary}</p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500" /> Next Video Ideas</h2>
                <div className="space-y-3">
                  {growth.nextTopics.map((t, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:border-brand-200 transition-colors">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${t.opportunityScore >= 70 ? 'bg-green-100 text-green-700' : t.opportunityScore >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                        {t.opportunityScore}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{t.topic}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{t.rationale}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h2 className="font-semibold text-gray-900 mb-4">Optimization Actions</h2>
                <div className="space-y-3">
                  {growth.optimizationActions.map((a, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                      <PriorityBadge priority={a.priority} />
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">{a.area}</p>
                        <p className="text-sm text-gray-800">{a.action}</p>
                        <p className="text-xs text-brand-600 mt-0.5">{a.expectedImpact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
