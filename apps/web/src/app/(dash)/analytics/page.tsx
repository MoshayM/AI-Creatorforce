'use client';
import { useEffect, useState } from 'react';
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
  const styles: Record<string, React.CSSProperties> = {
    high: { background: '#fef2f2', color: '#b91c1c' },
    medium: { background: '#fff7ed', color: '#c2410c' },
    low: { background: '#f3f4f6', color: '#4b5563' },
  };
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold" style={styles[priority]}>
      {priority}
    </span>
  );
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
  const [activeView, setActiveView] = useState<'scorecard' | 'analytics' | 'usage'>('scorecard');
  const [scorecard, setScorecard] = useState<{
    publishing: { scheduled: number; published: number; failed: number; totalVideos: number } | null;
    calendar: { total: number; proposed: number; approved: number; upcoming7d: number; approvalRate: number } | null;
  } | null>(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);

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

  async function loadScorecard(cid: string) {
    setScorecardLoading(true);
    try {
      const [publishing, calendar] = await Promise.all([
        callApi<{ scheduled: number; published: number; failed: number; totalVideos: number }>(`/publishing/videos/summary?channelId=${cid}`).catch(() => null),
        callApi<{ total: number; proposed: number; approved: number; upcoming7d: number; approvalRate: number }>(`/autonomy/channels/${cid}/calendar/stats`).catch(() => null),
      ]);
      setScorecard({ publishing: publishing ?? null, calendar: calendar ?? null });
    } finally {
      setScorecardLoading(false);
    }
  }

  useEffect(() => {
    if (channelId) { void loadScorecard(channelId); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

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
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 leading-tight flex items-center gap-2">
            <BarChart2 className="w-6 h-6" style={{ color: '#6D4AE0' }} />
            Analytics &amp; Growth
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">AI-powered channel diagnostics and next-video recommendations</p>
        </div>

        {/* AI Usage card */}
        {activeView === 'usage' && (
          <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
            <h2 className="font-bold text-gray-900 mb-3">AI Usage (30 days)</h2>
            {tokenUsage === 'unavailable' ? (
              <p className="text-sm text-gray-400">unavailable</p>
            ) : tokenUsage === null ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-0.5">Total cost</p>
                  <p className="text-lg font-bold text-gray-900">${tokenUsage.totals.costUsd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-0.5">Tokens in</p>
                  <p className="text-lg font-bold text-gray-900">{tokenUsage.totals.tokensIn.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-0.5">Tokens out</p>
                  <p className="text-lg font-bold text-gray-900">{tokenUsage.totals.tokensOut.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-0.5">Provider calls</p>
                  <p className="text-lg font-bold text-gray-900">{tokenUsage.totals.calls.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-0.5">Copilot cache-hit rate</p>
                  <p className="text-lg font-bold text-gray-900">
                    {tokenUsage.copilot.cacheHitRate != null
                      ? `${(tokenUsage.copilot.cacheHitRate * 100).toFixed(0)}%`
                      : '—'}
                  </p>
                </div>
              </div>
            )}
            {tokenUsage !== 'unavailable' && tokenUsage !== null && (tokenUsage.byVideo ?? []).length > 0 && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid #f0edf9' }}>
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-2">Cost by video</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="pb-1 text-[10px] font-extrabold uppercase tracking-widest text-gray-400">Video</th>
                      <th className="pb-1 text-[10px] font-extrabold uppercase tracking-widest text-gray-400 text-right">Calls</th>
                      <th className="pb-1 text-[10px] font-extrabold uppercase tracking-widest text-gray-400 text-right">Tokens</th>
                      <th className="pb-1 text-[10px] font-extrabold uppercase tracking-widest text-gray-400 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokenUsage.byVideo.map((v) => (
                      <tr key={v.importedVideoId} className="hover:bg-[#faf9ff]" style={{ borderBottom: '1px solid #f0edf9' }}>
                        <td className="py-1.5 text-gray-800 truncate max-w-[280px]" title={v.title}>{v.title}</td>
                        <td className="py-1.5 text-right text-gray-500">{v.calls}</td>
                        <td className="py-1.5 text-right text-gray-500">{(v.tokensIn + v.tokensOut).toLocaleString()}</td>
                        <td className="py-1.5 text-right font-bold text-gray-900">${v.costUsd.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Channel selector + run — only show run button on analytics tab */}
        <div className="bg-white rounded-2xl p-5 no-print" style={{ border: '1.5px solid #e3ddf8' }}>
          <label htmlFor="analytics-channel" className="block text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-2">Select Channel</label>
          <div className="flex gap-3">
            {channels.length > 0 ? (
              <select
                id="analytics-channel"
                value={channelId}
                onChange={e => setChannelId(e.target.value)}
                className="flex-1 bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                style={{ border: '1.5px solid #e3e0f0' }}
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
                className="flex-1 bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                style={{ border: '1.5px solid #e3e0f0' }}
              />
            )}
            {activeView === 'analytics' && (
              <button
                onClick={runAnalytics}
                disabled={!channelId || loadingAnalytics}
                className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold text-white hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
                style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
              >
                {loadingAnalytics ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart2 className="w-4 h-4" />}
                {loadingAnalytics ? 'Analyzing…' : 'Run Analytics'}
              </button>
            )}
          </div>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>

        {/* Tab bar */}
        <div className="flex gap-2">
          {(['scorecard', 'analytics', 'usage'] as const).map(v => (
            <button
              key={v}
              onClick={() => setActiveView(v)}
              className="flex-1 py-2.5 text-sm font-semibold rounded-2xl transition-all"
              style={
                activeView === v
                  ? { background: '#f5f2fd', border: '2px solid #6D4AE0', color: '#6D4AE0' }
                  : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }
              }
            >
              {v === 'scorecard' ? 'Scorecard' : v === 'analytics' ? 'AI Analysis' : 'AI Usage'}
            </button>
          ))}
        </div>

        {/* Scorecard tab */}
        {activeView === 'scorecard' && (
          <div className="space-y-5">
            {!channelId && (
              <div className="bg-white rounded-3xl p-12 text-center" style={{ border: '1.5px solid #e3ddf8' }}>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
                  <BarChart2 className="w-8 h-8" style={{ color: '#6D4AE0' }} />
                </div>
                <p className="text-base font-extrabold text-gray-900 mb-1">No channel selected</p>
                <p className="text-sm text-gray-400">Select a channel above to see its performance scorecard.</p>
              </div>
            )}
            {channelId && scorecardLoading && (
              <div className="bg-white rounded-2xl p-8 text-center" style={{ border: '1.5px solid #e3ddf8' }}>
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" style={{ color: '#6D4AE0' }} />
                <p className="text-sm text-gray-400">Loading scorecard…</p>
              </div>
            )}
            {channelId && !scorecardLoading && scorecard && (
              <>
                {/* Publishing KPIs */}
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Publishing</p>
                  <div className="grid grid-cols-3 gap-4">
                    <StatCard tone="lilac" icon={<Video className="w-5 h-5" />} label="Published" value={scorecard.publishing?.published ?? '—'} sub="videos uploaded" subClassName="text-gray-500" />
                    <StatCard tone="cream" icon={<Gauge className="w-5 h-5" />} label="Scheduled" value={scorecard.publishing?.scheduled ?? '—'} sub="queued for publish" subClassName="text-gray-500" />
                    <StatCard tone="pink" icon={<AlertTriangle className="w-5 h-5" />} label="Failed" value={scorecard.publishing?.failed ?? '—'} sub="publish errors" subClassName={scorecard.publishing?.failed ? 'text-red-500' : 'text-gray-500'} />
                  </div>
                </div>

                {/* Autonomy KPIs */}
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">AI Autonomy</p>
                  <div className="grid grid-cols-3 gap-4">
                    <StatCard tone="periwinkle" icon={<BarChart2 className="w-5 h-5" />} label="Proposals" value={scorecard.calendar?.total ?? '—'} sub="calendar entries" subClassName="text-gray-500" />
                    <StatCard tone="lilac" icon={<TrendingUp className="w-5 h-5" />} label="Approval Rate" value={scorecard.calendar ? `${Math.round(scorecard.calendar.approvalRate)}%` : '—'} sub="of proposals approved" subClassName={scorecard.calendar && scorecard.calendar.approvalRate >= 50 ? 'text-green-600' : 'text-amber-500'} />
                    <StatCard tone="cream" icon={<Gauge className="w-5 h-5" />} label="Upcoming (7d)" value={scorecard.calendar?.upcoming7d ?? '—'} sub="approved slots" subClassName="text-gray-500" />
                  </div>
                </div>

                {/* Performance Grade */}
                {scorecard.publishing && scorecard.calendar && (() => {
                  const pub = scorecard.publishing!;
                  const cal = scorecard.calendar!;
                  const failureRate = (pub.failed + pub.published) > 0 ? pub.failed / (pub.failed + pub.published) : 0;
                  const score = (cal.approvalRate * 0.4) + (Math.min(pub.published / 10, 1) * 40) + ((1 - failureRate) * 20);
                  const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
                  const gradeStyles: Record<string, React.CSSProperties> = {
                    A: { background: '#ecfdf5', color: '#065f46' },
                    B: { background: '#eff6ff', color: '#1d4ed8' },
                    C: { background: '#fff7ed', color: '#c2410c' },
                    D: { background: '#fef2f2', color: '#b91c1c' },
                  };
                  const gradeLabels = { A: 'Excellent', B: 'Good', C: 'Developing', D: 'Needs Work' };
                  return (
                    <div className="bg-white rounded-2xl p-5 flex items-center gap-6" style={{ border: '1.5px solid #e3ddf8' }}>
                      <div className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-black shrink-0" style={gradeStyles[grade]}>
                        {grade}
                      </div>
                      <div>
                        <p className="text-lg font-bold text-gray-900">Performance Grade: {gradeLabels[grade]}</p>
                        <p className="text-sm text-gray-400 mt-1">Composite score based on approval rate, publish volume, and failure rate.</p>
                        <div className="flex gap-4 mt-2 text-xs text-gray-400">
                          <span>Autonomy rate: {Math.round(cal.approvalRate)}%</span>
                          <span>Published: {pub.published}</span>
                          <span>Failure rate: {(failureRate * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {activeView === 'analytics' && loadingAnalytics && (
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
        {activeView === 'analytics' && analytics && !loadingAnalytics && (
          <div className="space-y-5 fade-in">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {analyticsDurationMs != null && `Report generated in ${formatDuration(analyticsDurationMs)}`}
                {growthDurationMs != null && ` · growth report in ${formatDuration(growthDurationMs)}`}
              </p>
              <ResultActions
                data={growth ? { analytics, growth } : analytics}
                filename={`analytics-${analytics.channelId}`}
              />
            </div>

            {/* Pastel KPI stat cards */}
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
                subClassName="text-gray-600"
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
                subClassName="text-gray-600"
              />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                <h2 className="font-bold text-gray-900 mb-1">Performance Overview</h2>
                <p className="text-xs text-gray-400 mb-3">Click-through rate per top video</p>
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
                  <p className="text-sm text-gray-400 py-8 text-center">No CTR data available for this channel yet</p>
                )}
              </div>
              <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                <h2 className="font-bold text-gray-900 mb-1">Insight Breakdown</h2>
                <p className="text-xs text-gray-400 mb-4">Impact of the findings across your channel</p>
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
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h2 className="font-bold text-gray-900 mb-2">Summary</h2>
              <p className="text-sm text-gray-600">{analytics.summary}</p>
            </div>

            {/* Insights */}
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h2 className="font-bold text-gray-900 mb-4">Key Insights</h2>
              <div className="space-y-3">
                {analytics.insights.map((insight, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-2xl" style={{ background: '#faf9ff' }}>
                    <div className={`w-9 h-9 rounded-2xl flex items-center justify-center text-white shrink-0 mt-0.5 ${
                      insight.impact === 'positive' ? 'bg-[#9fd8a5]' : insight.impact === 'negative' ? 'bg-[#f2a3c6]' : 'bg-[#c9d2e3]'
                    }`}>
                      {insight.impact === 'positive' ? <TrendingUp className="w-4 h-4" /> : insight.impact === 'negative' ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400">{insight.metric}</span>
                        <ImpactBadge impact={insight.impact} />
                      </div>
                      <p className="text-sm text-gray-800 mb-1">{insight.finding}</p>
                      <p className="text-xs flex items-center gap-1" style={{ color: '#6D4AE0' }}><ChevronRight className="w-3 h-3" />{insight.suggestion}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top performers */}
            {analytics.topPerformers.length > 0 && (
              <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                <h2 className="font-bold text-gray-900 mb-4">Top Performers</h2>
                <div className="space-y-2">
                  {analytics.topPerformers.map((v, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-2xl" style={{ background: '#faf9ff' }}>
                      <p className="text-sm font-medium text-gray-800 flex-1 truncate">{v.title}</p>
                      <div className="flex gap-4 text-xs text-gray-400 ml-4 shrink-0">
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
                className="no-print w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl font-bold text-white hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
                style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
              >
                {loadingGrowth ? <RefreshCw className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                {loadingGrowth ? 'Generating growth recommendations…' : 'Generate Growth Report & Next Topics'}
              </button>
            )}

            {/* Growth report */}
            {growth && !loadingGrowth && (
              <div className="space-y-4 fade-in">
                <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                  <h2 className="font-bold text-gray-900 mb-2 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" style={{ color: '#6D4AE0' }} /> Growth Summary
                  </h2>
                  <p className="text-sm text-gray-600">{growth.summary}</p>
                </div>

                <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                  <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" /> Next Video Ideas
                  </h2>
                  <div className="space-y-3">
                    {growth.nextTopics.map((t, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-2xl hover:bg-[#faf9ff] transition-colors" style={{ border: '1.5px solid #e3ddf8' }}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${t.opportunityScore >= 70 ? 'bg-green-100 text-green-700' : t.opportunityScore >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                          {t.opportunityScore}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{t.topic}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{t.rationale}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                  <h2 className="font-bold text-gray-900 mb-4">Optimization Actions</h2>
                  <div className="space-y-3">
                    {growth.optimizationActions.map((a, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-2xl" style={{ background: '#faf9ff' }}>
                        <PriorityBadge priority={a.priority} />
                        <div>
                          <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400">{a.area}</p>
                          <p className="text-sm text-gray-800">{a.action}</p>
                          <p className="text-xs mt-0.5" style={{ color: '#6D4AE0' }}>{a.expectedImpact}</p>
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
    </div>
  );
}
