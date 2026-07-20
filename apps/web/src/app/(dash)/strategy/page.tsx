'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Target, Loader2, ChevronDown, ChevronUp, TrendingUp, Clock, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, apiClient } from '@/lib/api';

interface Channel { id: string; title: string; youtubeChannelId?: string; }

interface GoalVideo {
  title: string;
  rationale: string;
  estimatedImpact: number;
  productionComplexity: 'low' | 'medium' | 'high';
  suggestedFormat: string;
}

interface WeekPlan {
  week: number;
  theme: string;
  videos: GoalVideo[];
  cumulativeGrowthEstimate?: string;
}

interface Milestone { week: number; milestone: string; metric: string; }

interface GoalPlan {
  goal: string;
  timeframeWeeks: number;
  summary: string;
  milestones: Milestone[];
  weeklyPlan: WeekPlan[];
  resources?: { hoursPerWeek: number; toolsNeeded: string[]; contentTypes: string[] };
  successMetrics: string[];
  risks?: string[];
}

const COMPLEXITY_BADGE: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

function WeekCard({ week }: { week: WeekPlan }) {
  const [open, setOpen] = useState(week.week <= 2);
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)', color: '#6D4AE0' }}>
            {week.week}
          </span>
          <div>
            <p className="font-semibold text-gray-900 text-sm">{week.theme}</p>
            <p className="text-xs text-gray-500">{week.videos.length} video{week.videos.length !== 1 ? 's' : ''}{week.cumulativeGrowthEstimate ? ` · ${week.cumulativeGrowthEstimate}` : ''}</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-3 border-t border-gray-100">
          {week.videos.map((v, i) => (
            <div key={i} className="pt-3">
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <p className="font-medium text-gray-900 text-sm leading-snug">{v.title}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${COMPLEXITY_BADGE[v.productionComplexity] ?? 'bg-gray-100 text-gray-600'}`}>
                    {v.productionComplexity}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>{v.suggestedFormat}</span>
                </div>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">{v.rationale}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full"
                    style={{ width: `${v.estimatedImpact}%`, background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
                  />
                </div>
                <span className="text-xs text-gray-500 flex-shrink-0">Impact: {v.estimatedImpact}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StrategyPage() {
  const [channelId, setChannelId] = useState('');
  const [goal, setGoal] = useState('');
  const [timeframe, setTimeframe] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<GoalPlan | null>(null);

  const { data: channelsData } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
    retry: false,
  });
  const channels: Channel[] = Array.isArray(channelsData) ? channelsData : [];

  const handleGenerate = async () => {
    if (!channelId || !goal.trim()) return;
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const res = await apiClient.post<GoalPlan>(`/autonomy/channels/${channelId}/goal-plan`, {
        goal: goal.trim(),
        timeframeWeeks: timeframe,
      });
      setPlan(res.data);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed to generate plan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 leading-tight flex items-center gap-2">
            <Target className="w-6 h-6" style={{ color: '#6D4AE0' }} /> Content Strategy Planner
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">AI decomposes your growth goal into a concrete weekly content plan</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Input panel */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl p-5 space-y-4" style={{ border: '1.5px solid #e3ddf8' }}>
              <h2 className="font-semibold text-gray-800 text-sm">Set Your Goal</h2>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Channel</label>
                <div className="relative">
                  <select
                    value={channelId}
                    onChange={(e) => setChannelId(e.target.value)}
                    className="w-full bg-white rounded-2xl px-4 py-3 pr-10 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 appearance-none"
                    style={{ border: '1.5px solid #e3e0f0' }}
                  >
                    <option value="">Select a channel…</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Your goal</label>
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Grow to 50k subscribers and 500k monthly views in 3 months through tutorial content"
                  rows={4}
                  className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 resize-none"
                  style={{ border: '1.5px solid #e3e0f0' }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Timeframe</label>
                <div className="relative">
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(Number(e.target.value))}
                    className="w-full bg-white rounded-2xl px-4 py-3 pr-10 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 appearance-none"
                    style={{ border: '1.5px solid #e3e0f0' }}
                  >
                    <option value={4}>4 weeks (1 month)</option>
                    <option value={8}>8 weeks (2 months)</option>
                    <option value={12}>12 weeks (3 months)</option>
                    <option value={16}>16 weeks (4 months)</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !channelId || !goal.trim()}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl font-bold text-white disabled:opacity-50 transition-opacity"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
              {loading ? 'Decomposing goal…' : 'Generate Strategy Plan'}
            </button>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-2xl px-3 py-2">{error}</p>
            )}

            {plan?.resources && (
              <div className="bg-white rounded-2xl p-5 space-y-3" style={{ border: '1.5px solid #e3ddf8' }}>
                <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2"><Clock className="w-4 h-4" style={{ color: '#6D4AE0' }} /> Resources</h3>
                <p className="text-sm text-gray-600"><span className="font-medium">{plan.resources.hoursPerWeek}h/week</span> estimated</p>
                <div className="flex flex-wrap gap-1.5">
                  {plan.resources.contentTypes.map((ct, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full text-xs" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>{ct}</span>
                  ))}
                </div>
                {plan.resources.toolsNeeded.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Tools needed</p>
                    <ul className="space-y-0.5">
                      {plan.resources.toolsNeeded.map((t, i) => (
                        <li key={i} className="text-xs text-gray-600">· {t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Results */}
          <div className="lg:col-span-3">
            {!plan && !loading && (
              <div className="flex flex-col items-center justify-center h-full py-20 rounded-3xl" style={{ background: '#fff' }}>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
                  <Target className="w-8 h-8" style={{ color: '#6D4AE0' }} />
                </div>
                <p className="font-medium text-gray-500">Your strategy plan will appear here</p>
                <p className="text-sm mt-1 text-gray-400">Set a goal, choose a channel, and click Generate</p>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center h-full py-20 text-gray-500">
                <Loader2 className="w-10 h-10 animate-spin mb-4" style={{ color: '#6D4AE0' }} />
                <p className="font-medium">Decomposing your goal into weekly tasks…</p>
                <p className="text-sm mt-1 text-gray-400">This may take a moment</p>
              </div>
            )}

            {plan && (
              <div className="space-y-5">
                {/* Summary */}
                <div className="rounded-2xl p-5" style={{ background: '#f5f2fd', border: '1.5px solid #e3ddf8' }}>
                  <h3 className="font-semibold mb-2 flex items-center gap-2" style={{ color: '#6D4AE0' }}><TrendingUp className="w-4 h-4" /> Strategy Overview</h3>
                  <p className="text-sm leading-relaxed text-gray-700">{plan.summary}</p>
                </div>

                {/* Milestones */}
                {plan.milestones.length > 0 && (
                  <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                    <h3 className="font-semibold text-gray-900 mb-4 text-sm">Key Milestones</h3>
                    <div className="space-y-3">
                      {plan.milestones.map((m, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: '#ecfdf5', color: '#065f46' }}>
                            W{m.week}
                          </span>
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{m.milestone}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{m.metric}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Weekly plan */}
                <div>
                  <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Weekly Content Plan</h3>
                  <div className="space-y-3">
                    {plan.weeklyPlan.map((week, i) => (
                      <WeekCard key={i} week={week} />
                    ))}
                  </div>
                </div>

                {/* Success metrics + risks */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="rounded-2xl p-4" style={{ background: '#ecfdf5', border: '1.5px solid #a7f3d0' }}>
                    <h4 className="font-semibold mb-3 text-sm flex items-center gap-2" style={{ color: '#065f46' }}><CheckCircle2 className="w-4 h-4" /> Success Metrics</h4>
                    <ul className="space-y-1.5">
                      {plan.successMetrics.map((m, i) => (
                        <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: '#065f46' }}>
                          <span className="mt-0.5 text-green-400">•</span> {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {plan.risks && plan.risks.length > 0 && (
                    <div className="rounded-2xl p-4" style={{ background: '#fff7ed', border: '1.5px solid #fed7aa' }}>
                      <h4 className="font-semibold mb-3 text-sm flex items-center gap-2" style={{ color: '#c2410c' }}><AlertTriangle className="w-4 h-4" /> Risks</h4>
                      <ul className="space-y-1.5">
                        {plan.risks.map((r, i) => (
                          <li key={i} className="text-xs flex items-start gap-1.5" style={{ color: '#c2410c' }}>
                            <span className="mt-0.5">!</span> {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
