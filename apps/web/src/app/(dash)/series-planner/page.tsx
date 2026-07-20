'use client';
import { useState } from 'react';
import { ListOrdered, Loader2, ChevronDown, ChevronUp, Lightbulb, Clock, DollarSign, Search, Sparkles } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface SeriesEpisode {
  episodeNumber: number;
  title: string;
  hook: string;
  keyPoints: string[];
  estimatedDurationMins: number;
  format: string;
  researchAngles: string[];
  thumbnailConcept: string;
}

interface SeriesPlan {
  seriesTitle: string;
  seriesHook: string;
  targetAudience: string;
  estimatedTotalEpisodes: number;
  episodes: SeriesEpisode[];
  seriesArc: string;
  monetizationTips: string[];
  seoStrategy: string;
}

const FORMAT_COLORS: Record<string, string> = {
  tutorial: 'bg-blue-100 text-blue-700',
  story: 'bg-purple-100 text-purple-700',
  review: 'bg-amber-100 text-amber-700',
  interview: 'bg-green-100 text-green-700',
  documentary: 'bg-indigo-100 text-indigo-700',
  listicle: 'bg-pink-100 text-pink-700',
};

const NICHES = [
  'Tech & Software', 'Finance & Investing', 'Health & Fitness', 'Business & Entrepreneurship',
  'Gaming', 'Education', 'Lifestyle', 'Food & Cooking', 'Travel', 'Science', 'DIY & Crafts',
  'Beauty & Fashion', 'Sports', 'Entertainment', 'News & Politics',
];

export default function SeriesPlannerPage() {
  const [topic, setTopic] = useState('');
  const [niche, setNiche] = useState('');
  const [episodeCount, setEpisodeCount] = useState(6);
  const [targetAudience, setTargetAudience] = useState('');
  const [plan, setPlan] = useState<SeriesPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedEp, setExpandedEp] = useState<number | null>(1);

  async function generate() {
    if (!topic.trim() || !niche) return;
    setLoading(true);
    setError('');
    setPlan(null);
    try {
      const res = await apiClient.post('/content/series-plan', {
        topic: topic.trim(),
        niche,
        episodeCount,
        targetAudience: targetAudience.trim() || undefined,
      });
      setPlan(res.data as SeriesPlan);
      setExpandedEp(1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate series plan');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}>
            <ListOrdered className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Series Planner</h1>
            <p className="text-sm text-gray-400 mt-0.5">AI-designed multi-episode series with narrative arc and monetization strategy</p>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl p-6" style={{ border: '1.5px solid #e3ddf8' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Series Topic <span className="text-red-400">*</span></label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Mastering Personal Finance from Zero"
                className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                style={{ border: '1.5px solid #e3e0f0' }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Niche <span className="text-red-400">*</span></label>
              <select
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                style={{ border: '1.5px solid #e3e0f0' }}
              >
                <option value="">Select niche…</option>
                {NICHES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Episodes: <span className="font-bold" style={{ color: '#6D4AE0' }}>{episodeCount}</span></label>
              <input
                type="range"
                min={3}
                max={12}
                value={episodeCount}
                onChange={(e) => setEpisodeCount(Number(e.target.value))}
                className="w-full mt-2 accent-[#6D4AE0]"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1"><span>3</span><span>12</span></div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Target Audience <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                placeholder="e.g. 25–40 year olds new to investing"
                className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                style={{ border: '1.5px solid #e3e0f0' }}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

          <button
            onClick={() => void generate()}
            disabled={loading || !topic.trim() || !niche}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-white disabled:opacity-50 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? 'Planning series…' : 'Generate Series Plan'}
          </button>
        </div>

        {/* Results */}
        {plan && (
          <div className="space-y-5">
            {/* Series overview */}
            <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #f5f2fd, #ede8fc)', border: '1.5px solid #e3ddf8' }}>
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{plan.seriesTitle}</h2>
                  <p className="text-sm mt-1 font-medium italic" style={{ color: '#6D4AE0' }}>&ldquo;{plan.seriesHook}&rdquo;</p>
                  <p className="text-xs text-gray-500 mt-1">For: {plan.targetAudience}</p>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.7)', color: '#6D4AE0', border: '1.5px solid #e3ddf8' }}>
                  {plan.estimatedTotalEpisodes} episodes
                </span>
              </div>
              {plan.seriesArc && (
                <div className="mt-4 pt-4" style={{ borderTop: '1.5px solid #e3ddf8' }}>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">Narrative Arc</p>
                  <p className="text-sm text-gray-700">{plan.seriesArc}</p>
                </div>
              )}
            </div>

            {/* Episodes */}
            <div>
              <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3">Episodes</h3>
              <div className="space-y-2">
                {plan.episodes.map((ep) => {
                  const isOpen = expandedEp === ep.episodeNumber;
                  return (
                    <div key={ep.episodeNumber} className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
                      <button
                        type="button"
                        onClick={() => setExpandedEp(isOpen ? null : ep.episodeNumber)}
                        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
                      >
                        <span className="w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>
                          {ep.episodeNumber}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${FORMAT_COLORS[ep.format] ?? 'bg-gray-100 text-gray-600'}`}>
                              {ep.format}
                            </span>
                            <span className="text-[11px] text-gray-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />{ep.estimatedDurationMins} min
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-gray-900 mt-0.5 truncate">{ep.title}</p>
                        </div>
                        {isOpen ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                      </button>

                      {isOpen && (
                        <div className="border-t border-gray-100 p-4 space-y-3">
                          <p className="text-sm text-gray-700 italic">&ldquo;{ep.hook}&rdquo;</p>

                          {ep.keyPoints.length > 0 && (
                            <div>
                              <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1.5">Key Points</p>
                              <ul className="space-y-1">
                                {ep.keyPoints.map((pt, i) => (
                                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                                    <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#6D4AE0' }} />
                                    {pt}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {ep.researchAngles && ep.researchAngles.length > 0 && (
                            <div>
                              <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1.5 flex items-center gap-1">
                                <Search className="w-3 h-3" /> Research Angles
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {ep.researchAngles.map((a, i) => (
                                  <span key={i} className="px-2.5 py-1 bg-gray-100 rounded-full text-xs text-gray-600">{a}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          {ep.thumbnailConcept && (
                            <div className="rounded-2xl p-3" style={{ background: '#fff7ed', border: '1.5px solid #fed7aa' }}>
                              <p className="text-[10px] font-extrabold uppercase tracking-widest mb-0.5" style={{ color: '#c2410c' }}>Thumbnail Concept</p>
                              <p className="text-sm" style={{ color: '#c2410c' }}>{ep.thumbnailConcept}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Monetization + SEO */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {plan.monetizationTips && plan.monetizationTips.length > 0 && (
                <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-green-500" /> Monetization Tips
                  </p>
                  <ul className="space-y-2">
                    {plan.monetizationTips.map((tip, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.seoStrategy && (
                <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5 text-blue-500" /> SEO Strategy
                  </p>
                  <p className="text-sm text-gray-700 leading-relaxed">{plan.seoStrategy}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
