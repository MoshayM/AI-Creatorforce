'use client';
import { useState } from 'react';
import { Award, Loader2, CheckCircle2, ArrowRight, ChevronDown, ChevronUp, Zap, Target } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface QualityDimension {
  name: string;
  score: number;
  feedback: string;
  tips?: string[];
}

interface ScriptQualityResult {
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
  dimensions: QualityDimension[];
  strengths: string[];
  improvements: string[];
  estimatedRetentionPct: number;
}

const GRADE_STYLES: Record<string, { bg: string; text: string; ring: string; label: string }> = {
  A: { bg: 'bg-green-500', text: 'text-white', ring: 'ring-green-200', label: 'Excellent' },
  B: { bg: 'bg-blue-500', text: 'text-white', ring: 'ring-blue-200', label: 'Good' },
  C: { bg: 'bg-yellow-500', text: 'text-white', ring: 'ring-yellow-200', label: 'Average' },
  D: { bg: 'bg-orange-500', text: 'text-white', ring: 'ring-orange-200', label: 'Below Average' },
  F: { bg: 'bg-red-500', text: 'text-white', ring: 'ring-red-200', label: 'Needs Work' },
};

function scoreColor(score: number) {
  if (score >= 80) return 'bg-green-500';
  if (score >= 65) return 'bg-blue-500';
  if (score >= 50) return 'bg-yellow-500';
  if (score >= 35) return 'bg-orange-500';
  return 'bg-red-500';
}

function DimensionCard({ dim }: { dim: QualityDimension }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-800">{dim.name}</span>
        <span className={`text-sm font-bold ${dim.score >= 70 ? 'text-green-600' : dim.score >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>{dim.score}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3">
        <div
          className={`h-1.5 rounded-full transition-all ${scoreColor(dim.score)}`}
          style={{ width: `${dim.score}%` }}
        />
      </div>
      <p className="text-xs text-gray-600">{dim.feedback}</p>
      {dim.tips && dim.tips.length > 0 && (
        <div>
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-2 text-xs text-brand-600 flex items-center gap-1 hover:text-brand-700"
          >
            {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {open ? 'Hide tips' : `${dim.tips.length} tip${dim.tips.length !== 1 ? 's' : ''}`}
          </button>
          {open && (
            <ul className="mt-2 space-y-1">
              {dim.tips.map((tip, i) => (
                <li key={i} className="text-xs text-gray-500 flex items-start gap-1.5">
                  <ArrowRight className="w-3 h-3 text-brand-400 mt-0.5 flex-shrink-0" />
                  {tip}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScoreScriptPage() {
  const [title, setTitle] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [niche, setNiche] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScriptQualityResult | null>(null);

  const wordCount = scriptText.trim().split(/\s+/).filter(Boolean).length;

  const handleScore = async () => {
    if (!scriptText.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiClient.post<ScriptQualityResult>('/content/score-script', {
        scriptText: scriptText.trim(),
        title: title.trim() || 'Untitled Video',
        niche: niche.trim() || undefined,
      });
      setResult(res.data);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Scoring failed');
    } finally {
      setLoading(false);
    }
  };

  const grade = result ? GRADE_STYLES[result.grade] ?? GRADE_STYLES['C'] : null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Award className="w-6 h-6 text-brand-600" /> Script Quality Scorer
        </h1>
        <p className="text-gray-500 mt-1">Get an AI-powered quality analysis of your script before production</p>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Input panel */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
            <h2 className="font-semibold text-gray-800 text-sm">Your Script</h2>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Video title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. 10 Productivity Hacks for 2025"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Niche <span className="text-gray-400">(optional)</span></label>
              <input
                type="text"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="e.g. Productivity, Finance, Tech"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Script
                {wordCount > 0 && <span className="text-gray-400 ml-2">{wordCount} words</span>}
              </label>
              <textarea
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                placeholder="Paste your full script here…"
                rows={14}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
              />
            </div>
          </div>

          <button
            onClick={handleScore}
            disabled={loading || !scriptText.trim()}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-brand-600 text-white rounded-xl font-semibold hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
            {loading ? 'Analyzing…' : 'Score Script'}
          </button>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Results */}
        <div className="lg:col-span-3">
          {!result && !loading && (
            <div className="flex flex-col items-center justify-center h-full py-20 text-gray-400">
              <Award className="w-12 h-12 mb-4 opacity-30" />
              <p className="font-medium text-gray-500">Your quality report will appear here</p>
              <p className="text-sm mt-1">Paste your script and click Score Script</p>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center h-full py-20 text-gray-500">
              <Loader2 className="w-10 h-10 animate-spin mb-4 text-brand-500" />
              <p className="font-medium">Analyzing across 6 dimensions…</p>
            </div>
          )}

          {result && grade && (
            <div className="space-y-5">
              {/* Grade card */}
              <div className="bg-white border border-gray-200 rounded-2xl p-6">
                <div className="flex items-center gap-6">
                  <div className={`w-20 h-20 rounded-2xl ${grade.bg} ring-4 ${grade.ring} flex flex-col items-center justify-center flex-shrink-0`}>
                    <span className={`text-3xl font-black ${grade.text}`}>{result.grade}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-3xl font-bold text-gray-900">{result.overallScore}</span>
                      <span className="text-gray-400 text-lg">/100</span>
                      <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${grade.bg} ${grade.text}`}>{grade.label}</span>
                    </div>
                    <p className="text-gray-600 text-sm leading-relaxed">{result.summary}</p>
                  </div>
                </div>

                {result.estimatedRetentionPct > 0 && (
                  <div className="mt-4 flex items-center gap-2 text-sm">
                    <Target className="w-4 h-4 text-brand-500" />
                    <span className="text-gray-600">Estimated retention:</span>
                    <span className="font-semibold text-gray-900">{result.estimatedRetentionPct}%</span>
                  </div>
                )}
              </div>

              {/* Dimensions */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Quality Dimensions</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {result.dimensions.map((dim, i) => (
                    <DimensionCard key={i} dim={dim} />
                  ))}
                </div>
              </div>

              {/* Strengths & improvements */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="bg-green-50 border border-green-100 rounded-2xl p-5">
                  <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Strengths
                  </h3>
                  <ul className="space-y-2">
                    {result.strengths.map((s, i) => (
                      <li key={i} className="text-sm text-green-800 flex items-start gap-2">
                        <span className="text-green-400 mt-0.5 flex-shrink-0">•</span> {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
                  <h3 className="font-semibold text-amber-900 mb-3 flex items-center gap-2">
                    <ArrowRight className="w-4 h-4" /> Improvements
                  </h3>
                  <ul className="space-y-2">
                    {result.improvements.map((imp, i) => (
                      <li key={i} className="text-sm text-amber-800 flex items-start gap-2">
                        <span className="text-amber-400 mt-0.5 flex-shrink-0">→</span> {imp}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
