'use client';
import { useState } from 'react';
import { Search, TrendingUp, Loader2, Lightbulb, AlertCircle, Tag, Users, Clock, Copy, Check, Zap } from 'lucide-react';
import { api, apiClient } from '@/lib/api';
import { ResultActions } from '@/components/result-actions';
import { AiWorkingCard, formatDuration } from '@/components/ai-activity';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrendItem {
  topic: string;
  score: number;
  relatedKeywords: string[];
  peakTime?: string | null;
}

interface TrendsResult {
  trending: TrendItem[];
  recommendations: string[];
  analysisDate: string;
}

interface KeywordResult {
  searchKeywords: string[];
  tags: string[];
  optimizedTitle?: string;
  optimizedDescription?: string;
}

interface InterestCluster {
  cluster: string;
  size?: string;
  engagement?: string;
}

interface AudienceResult {
  primaryDemographic?: string;
  interestClusters?: InterestCluster[];
  contentPreferences?: string[];
  bestPostingTimes?: string[];
  growthTips?: string[];
}

type HubTab = 'trends' | 'keywords' | 'audience' | 'gaps';

// ── Helpers ───────────────────────────────────────────────────────────────────

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-red-600 bg-red-50 rounded-2xl px-4 py-3 mb-6" style={{ border: '1.5px solid #fecaca' }}>
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span className="text-sm">{message}</span>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 text-xs px-3 py-1 bg-red-100 hover:bg-red-200 rounded-2xl font-semibold transition-colors">
          Retry
        </button>
      )}
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-amber-400' : 'bg-red-400';
  const label = score >= 70 ? 'text-green-700 bg-green-100' : score >= 40 ? 'text-amber-700 bg-amber-100' : 'text-red-700 bg-red-100';
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${label}`}>{score}</span>
    </div>
  );
}

function CopyChip({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  return (
    <button
      onClick={onCopy}
      className="group flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm transition-colors hover:opacity-80"
      style={{ background: '#f5f2fd', color: '#6D4AE0' }}
    >
      <span>{text}</span>
      {copied
        ? <Check className="w-3 h-3 text-green-600" />
        : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
    </button>
  );
}

function NicheInput({
  value,
  onChange,
  onSubmit,
  loading,
  placeholder,
  buttonLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  placeholder: string;
  buttonLabel: string;
}) {
  return (
    <div className="flex gap-3 mb-8">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
        placeholder={placeholder}
        className="flex-1 bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
        style={{ border: '1.5px solid #e3e0f0' }}
      />
      <button
        onClick={onSubmit}
        disabled={loading || !value.trim()}
        className="px-5 py-2 rounded-2xl font-bold text-white hover:opacity-90 active:scale-[0.98] disabled:opacity-50 flex items-center gap-2 transition-all"
        style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        {buttonLabel}
      </button>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function TrendsTab() {
  const [niche, setNiche] = useState('');
  const [result, setResult] = useState<TrendsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [durationMs, setDurationMs] = useState<number | null>(null);

  async function analyze() {
    if (!niche.trim()) return;
    setLoading(true);
    setError('');
    const t0 = Date.now();
    try {
      const res = await api.trends.analyze(niche.trim());
      const data = res.data as TrendsResult;
      setResult({ trending: data.trending ?? [], recommendations: data.recommendations ?? [], analysisDate: data.analysisDate ?? '' });
      setDurationMs(Date.now() - t0);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to analyze trends. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <NicheInput value={niche} onChange={setNiche} onSubmit={analyze} loading={loading}
        placeholder="Enter your niche — e.g. Tech, Finance, Cooking, Fitness, Gaming…"
        buttonLabel="Analyze" />
      {error && <ErrorBox message={error} onRetry={analyze} />}
      {loading && (
        <AiWorkingCard title={`Analyzing "${niche.trim()}" trends`}
          steps={['Scanning YouTube trend signals', 'Scoring topics for virality and competition', 'Compiling recommendations']} />
      )}
      {result && !loading && (
        <div className="space-y-6 fade-in">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Analysis date: {result.analysisDate}
              {durationMs != null && ` · analyzed in ${formatDuration(durationMs)}`}
            </p>
            <ResultActions data={result} filename={`trends-${niche.trim().toLowerCase() || 'analysis'}`} />
          </div>
          <div className="space-y-4">
            {result.trending.map((t, i) => (
              <div key={i} className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 shrink-0" style={{ color: '#6D4AE0' }} />
                    <h3 className="font-semibold text-gray-900">{t.topic}</h3>
                  </div>
                  {t.peakTime && (
                    <span className="flex items-center gap-1 text-xs text-gray-500 shrink-0 ml-3">
                      <Clock className="w-3 h-3" /> {t.peakTime}
                    </span>
                  )}
                </div>
                <ScoreBar score={t.score} />
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {t.relatedKeywords.map((kw, j) => (
                    <span key={j} className="px-2 py-0.5 text-xs rounded-full font-medium" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>{kw}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {result.recommendations.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: '#fff7ed', border: '1.5px solid #fed7aa' }}>
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-5 h-5 text-amber-600" />
                <h3 className="font-semibold text-amber-900">Recommendations</h3>
              </div>
              <ul className="space-y-2">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                    <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {!result && !loading && (
        <div className="text-center py-20 text-gray-400">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
            <TrendingUp className="w-8 h-8" style={{ color: '#6D4AE0' }} />
          </div>
          <p className="text-sm">Enter a niche and click <strong className="text-gray-600">Analyze</strong> to see trending topics</p>
          <p className="text-xs mt-2 opacity-70">Supported: Tech, Finance, Cooking, Fitness, Gaming, Travel, Education, Business, Beauty</p>
        </div>
      )}
    </div>
  );
}

function KeywordsTab() {
  const [kw, setKw] = useState('');
  const [result, setResult] = useState<KeywordResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<Set<string>>(new Set());

  async function research() {
    if (!kw.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post('/seo/optimize', { title: kw.trim(), description: `keyword research for: ${kw.trim()}`, niche: kw.trim() });
      const data = res.data as KeywordResult;
      setResult({ searchKeywords: data.searchKeywords ?? [], tags: data.tags ?? [] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to research keywords.');
    } finally {
      setLoading(false);
    }
  }

  function copyChip(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(prev => { const s = new Set(prev); s.add(text); return s; });
      setTimeout(() => setCopied(prev => { const s = new Set(prev); s.delete(text); return s; }), 1500);
    });
  }

  function copyAll() {
    if (!result) return;
    const all = [...result.searchKeywords, ...result.tags].join(', ');
    void navigator.clipboard.writeText(all);
  }

  return (
    <div>
      <NicheInput value={kw} onChange={setKw} onSubmit={research} loading={loading}
        placeholder="Enter niche or topic — e.g. AI tools for creators, vegan cooking…"
        buttonLabel="Research Keywords" />
      {error && <ErrorBox message={error} onRetry={research} />}
      {loading && (
        <AiWorkingCard title={`Researching keywords for "${kw.trim()}"`}
          steps={['Analyzing YouTube search patterns', 'Finding high-volume keywords', 'Extracting tag suggestions']} />
      )}
      {result && !loading && (
        <div className="space-y-6 fade-in">
          {result.searchKeywords.length > 0 && (
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Search className="w-4 h-4" style={{ color: '#6D4AE0' }} /> Search Keywords
                </h3>
                <button
                  onClick={copyAll}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 px-2 py-1 rounded-2xl font-semibold transition-colors"
                  style={{ border: '1.5px solid #e3ddf8' }}
                >
                  <Copy className="w-3 h-3" /> Copy All
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.searchKeywords.map((k, i) => (
                  <CopyChip key={i} text={k} copied={copied.has(k)} onCopy={() => copyChip(k)} />
                ))}
              </div>
            </div>
          )}
          {result.tags.length > 0 && (
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
                <Tag className="w-4 h-4 text-teal-600" /> Suggested Tags
              </h3>
              <div className="flex flex-wrap gap-2">
                {result.tags.map((t, i) => (
                  <CopyChip key={i} text={t} copied={copied.has(t)} onCopy={() => copyChip(t)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!result && !loading && (
        <div className="text-center py-20 text-gray-400">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
            <Tag className="w-8 h-8" style={{ color: '#6D4AE0' }} />
          </div>
          <p className="text-sm">Enter a topic to find YouTube search keywords and tags</p>
        </div>
      )}
    </div>
  );
}

function AudienceTab() {
  const [niche, setNiche] = useState('');
  const [result, setResult] = useState<AudienceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function analyze() {
    if (!niche.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.post('/audience/analyze', { niche: niche.trim(), recentTopics: [] });
      setResult(res.data as AudienceResult);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to analyze audience.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <NicheInput value={niche} onChange={setNiche} onSubmit={analyze} loading={loading}
        placeholder="Enter your content niche — e.g. Personal Finance, Gaming, Cooking…"
        buttonLabel="Analyze Audience" />
      {error && <ErrorBox message={error} onRetry={analyze} />}
      {loading && (
        <AiWorkingCard title={`Analyzing audience for "${niche.trim()}"`}
          steps={['Profiling target demographics', 'Mapping interest clusters', 'Identifying content preferences']} />
      )}
      {result && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 fade-in">
          {result.primaryDemographic && (
            <div className="bg-white rounded-2xl p-5 col-span-full" style={{ border: '1.5px solid #e3ddf8' }}>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-2">
                <Users className="w-4 h-4" style={{ color: '#6D4AE0' }} /> Primary Demographic
              </h3>
              <p className="text-sm text-gray-700">{result.primaryDemographic}</p>
            </div>
          )}
          {result.interestClusters && result.interestClusters.length > 0 && (
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h3 className="font-semibold text-gray-900 mb-3">Interest Clusters</h3>
              <div className="space-y-2">
                {result.interestClusters.map((c, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-1.5 hover:bg-[#faf9ff]" style={{ borderBottom: '1px solid #f0edf9' }}>
                    <span className="text-sm text-gray-800">{c.cluster}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {c.size && <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">{c.size}</span>}
                      {c.engagement && <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#ecfdf5', color: '#065f46' }}>{c.engagement}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.contentPreferences && result.contentPreferences.length > 0 && (
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h3 className="font-semibold text-gray-900 mb-3">Content Preferences</h3>
              <div className="flex flex-wrap gap-2">
                {result.contentPreferences.map((p, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-full text-sm font-medium" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>{p}</span>
                ))}
              </div>
            </div>
          )}
          {result.bestPostingTimes && result.bestPostingTimes.length > 0 && (
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-teal-600" /> Best Posting Times
              </h3>
              <div className="flex flex-wrap gap-2">
                {result.bestPostingTimes.map((t, i) => (
                  <span key={i} className="px-2.5 py-1 bg-teal-50 text-teal-700 rounded-full text-sm">{t}</span>
                ))}
              </div>
            </div>
          )}
          {result.growthTips && result.growthTips.length > 0 && (
            <div className="rounded-2xl p-5 col-span-full" style={{ background: '#fff7ed', border: '1.5px solid #fed7aa' }}>
              <h3 className="font-semibold text-amber-900 flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-amber-600" /> Growth Tips
              </h3>
              <ul className="space-y-1.5">
                {result.growthTips.map((tip, i) => (
                  <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {!result && !loading && (
        <div className="text-center py-20 text-gray-400">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
            <Users className="w-8 h-8" style={{ color: '#6D4AE0' }} />
          </div>
          <p className="text-sm">Enter a niche to understand your target audience</p>
        </div>
      )}
    </div>
  );
}

function ContentGapsTab() {
  const [niche, setNiche] = useState('');
  const [result, setResult] = useState<TrendsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function findGaps() {
    if (!niche.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.trends.analyze(`underserved content gaps for: ${niche.trim()}`);
      const data = res.data as TrendsResult;
      setResult({ trending: data.trending ?? [], recommendations: data.recommendations ?? [], analysisDate: data.analysisDate ?? '' });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to find content gaps.');
    } finally {
      setLoading(false);
    }
  }

  const emerging = result?.trending.filter(t => t.score < 50) ?? [];

  return (
    <div>
      <NicheInput value={niche} onChange={setNiche} onSubmit={findGaps} loading={loading}
        placeholder="Enter your niche — e.g. Tech, Personal Finance, Fitness…"
        buttonLabel="Find Content Gaps" />
      {error && <ErrorBox message={error} onRetry={findGaps} />}
      {loading && (
        <AiWorkingCard title={`Finding content gaps for "${niche.trim()}"`}
          steps={['Mapping existing content landscape', 'Identifying underserved topics', 'Scoring opportunity gaps']} />
      )}
      {result && !loading && (
        <div className="space-y-6 fade-in">
          {result.recommendations.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4" style={{ color: '#6D4AE0' }} /> Gap Opportunities
              </h3>
              <div className="space-y-3">
                {result.recommendations.map((r, i) => (
                  <div key={i} className="bg-white rounded-2xl px-5 py-3.5 flex items-start gap-3" style={{ border: '1.5px solid #e3ddf8' }}>
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>{i + 1}</span>
                    <p className="text-sm text-gray-800">{r}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {emerging.length > 0 && (
            <div>
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-amber-500" /> Emerging Topics Worth Covering Early
              </h3>
              <div className="space-y-3">
                {emerging.map((t, i) => (
                  <div key={i} className="bg-white rounded-2xl p-4" style={{ border: '1.5px solid #e3ddf8' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-800 text-sm">{t.topic}</span>
                    </div>
                    <ScoreBar score={t.score} />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {t.relatedKeywords.slice(0, 4).map((kw, j) => (
                        <span key={j} className="px-2 py-0.5 text-xs rounded-full" style={{ background: '#f3f4f6', color: '#4b5563' }}>{kw}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.recommendations.length === 0 && emerging.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-10">No gaps identified. Try a more specific niche.</p>
          )}
        </div>
      )}
      {!result && !loading && (
        <div className="text-center py-20 text-gray-400">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
            <Zap className="w-8 h-8" style={{ color: '#6D4AE0' }} />
          </div>
          <p className="text-sm">Enter a niche to find under-served topics you can dominate</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS: { id: HubTab; label: string }[] = [
  { id: 'trends', label: 'Trending' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'audience', label: 'Audience' },
  { id: 'gaps', label: 'Content Gaps' },
];

export default function DiscoverPage() {
  const [hubTab, setHubTab] = useState<HubTab>('trends');

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl px-7 py-6 text-white no-print" style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}>
          <div className="absolute -right-6 -top-8 w-36 h-36 bg-white/10 rounded-full" aria-hidden />
          <div className="absolute right-16 -bottom-10 w-24 h-24 bg-white/10 rounded-full" aria-hidden />
          <p className="text-xs text-white/80">{new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <h1 className="text-2xl font-extrabold mt-1.5 leading-tight">Content Intelligence Hub</h1>
          <p className="text-sm text-white/85 mt-1">Trends, keywords, audience insights, and content gaps — all in one place</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setHubTab(t.id)}
              className="flex-shrink-0 py-1.5 px-4 text-sm font-semibold rounded-2xl transition-all whitespace-nowrap"
              style={hubTab === t.id
                ? { background: '#f5f2fd', border: '2px solid #6D4AE0', color: '#6D4AE0' }
                : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {hubTab === 'trends' && <TrendsTab />}
          {hubTab === 'keywords' && <KeywordsTab />}
          {hubTab === 'audience' && <AudienceTab />}
          {hubTab === 'gaps' && <ContentGapsTab />}
        </div>
      </div>
    </div>
  );
}
