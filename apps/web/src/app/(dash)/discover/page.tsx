'use client';
import { useState } from 'react';
import { Search, TrendingUp, Loader2, Lightbulb, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

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

export default function DiscoverPage() {
  const [niche, setNiche] = useState('');
  const [result, setResult] = useState<TrendsResult | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState('');

  async function analyze() {
    if (!niche.trim()) return;
    setIsPending(true);
    setError('');

    try {
      const res = await api.trends.analyze(niche.trim());
      const data = res.data as TrendsResult;
      setResult({ trending: data.trending ?? [], recommendations: data.recommendations ?? [], analysisDate: data.analysisDate ?? '' });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
      const serverMsg = axiosErr?.response?.data?.message;
      setError(serverMsg ?? axiosErr?.message ?? 'Failed to analyze trends. Please try again.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Discover Trends</h1>
        <p className="text-gray-500 mt-1">Find trending YouTube topics in your niche</p>
      </div>

      <div className="flex gap-3 mb-8">
        <input
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void analyze(); }}
          placeholder="Enter your niche — e.g. Tech, Finance, Cooking, Fitness, Gaming…"
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={() => void analyze()}
          disabled={isPending || !niche.trim()}
          className="px-5 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2"
        >
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Analyze
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-6">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
          <button
            onClick={() => void analyze()}
            disabled={isPending}
            className="shrink-0 text-xs px-3 py-1 bg-red-100 hover:bg-red-200 rounded-md font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <p className="text-xs text-gray-400">Analysis date: {result.analysisDate}</p>

          <div className="space-y-4">
            {result.trending.map((t, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-brand-600 shrink-0" />
                    <h3 className="font-semibold text-gray-900">{t.topic}</h3>
                  </div>
                  <span className={`shrink-0 ml-3 px-3 py-1 rounded-full text-xs font-semibold ${
                    t.score >= 80 ? 'bg-green-100 text-green-700' :
                    t.score >= 60 ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    Score: {t.score}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {t.relatedKeywords.map((kw, j) => (
                    <span key={j} className="px-2 py-1 bg-brand-50 text-brand-700 text-xs rounded-full">{kw}</span>
                  ))}
                </div>
                {t.peakTime && (
                  <p className="text-xs text-gray-400 mt-2">Peak engagement: {t.peakTime}</p>
                )}
              </div>
            ))}
          </div>

          {result.recommendations.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-5 h-5 text-amber-600" />
                <h3 className="font-semibold text-amber-900">Recommendations</h3>
              </div>
              <ul className="space-y-2">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                    <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-amber-500" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!result && !isPending && (
        <div className="text-center py-20 text-gray-400">
          <TrendingUp className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">Enter a niche and click <strong>Analyze</strong> to see trending topics</p>
          <p className="text-xs mt-2 opacity-70">Supported: Tech, Finance, Cooking, Fitness, Gaming, Travel, Education, Business, Beauty</p>
        </div>
      )}
    </div>
  );
}
