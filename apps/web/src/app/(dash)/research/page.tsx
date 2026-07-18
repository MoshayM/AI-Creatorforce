'use client';
import { useState } from 'react';
import { BookOpen, Loader2, AlertTriangle, Clock, Copy, Check } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { ResultActions } from '@/components/result-actions';
import { AiWorkingCard, formatDuration } from '@/components/ai-activity';

interface ContentAngle {
  angle: string;
  hook: string;
  targetAudience?: string;
}

interface ResearchResult {
  topic: string;
  summary: string;
  keyFacts: string[];
  contentAngles: ContentAngle[];
  expertPerspectives?: string[];
  relatedTopics: string[];
  statisticsAndData?: string[];
  controversialPoints?: string[];
  callToAction?: string;
  researchDate?: string;
}

const LANG_OPTIONS = [
  { label: 'English', value: 'en' },
  { label: 'Spanish', value: 'es' },
  { label: 'French', value: 'fr' },
  { label: 'German', value: 'de' },
  { label: 'Japanese', value: 'ja' },
];

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="ml-1 text-gray-400 hover:text-violet-600 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

export default function ResearchPage() {
  const [topic, setTopic] = useState('');
  const [niche, setNiche] = useState('');
  const [lang, setLang] = useState('en');
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  async function research() {
    if (!topic.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    const start = Date.now();
    try {
      const res = await apiClient.post('/content/research', {
        topic: topic.trim(),
        niche: niche.trim() || undefined,
        targetLang: lang !== 'en' ? lang : undefined,
      });
      const data = res.data as ResearchResult;
      setResult(data);
      setDurationMs(Date.now() - start);
      setHistory(prev => {
        const next = [topic.trim(), ...prev.filter(h => h !== topic.trim())].slice(0, 3);
        return next;
      });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        ?? (e as { message?: string })?.message
        ?? 'Research failed. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const resultText = result
    ? [
        `# Research: ${result.topic}`,
        '',
        `## Summary\n${result.summary}`,
        result.keyFacts?.length ? `\n## Key Facts\n${result.keyFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}` : '',
        result.contentAngles?.length ? `\n## Content Angles\n${result.contentAngles.map(a => `### ${a.angle}\n${a.hook}${a.targetAudience ? `\nAudience: ${a.targetAudience}` : ''}`).join('\n\n')}` : '',
        result.statisticsAndData?.length ? `\n## Statistics\n${result.statisticsAndData.map(s => `• ${s}`).join('\n')}` : '',
        result.expertPerspectives?.length ? `\n## Expert Perspectives\n${result.expertPerspectives.map(p => `> ${p}`).join('\n')}` : '',
        result.controversialPoints?.length ? `\n## Controversial Points\n${result.controversialPoints.map(p => `• ${p}`).join('\n')}` : '',
        result.relatedTopics?.length ? `\n## Related Topics\n${result.relatedTopics.join(', ')}` : '',
        result.callToAction ? `\n## Call to Action\n${result.callToAction}` : '',
      ].filter(Boolean).join('\n')
    : '';

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <BookOpen className="w-7 h-7 text-violet-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Research</h1>
          <p className="text-sm text-gray-500">AI-powered deep research for YouTube videos — facts, angles, hooks, and more</p>
        </div>
      </div>

      {/* Research form */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 space-y-4">
        {history.length > 0 && (
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mr-2">Recent</span>
            {history.map(h => (
              <button
                key={h}
                type="button"
                onClick={() => setTopic(h)}
                className="mr-2 mb-1 px-3 py-1 bg-violet-50 text-violet-700 rounded-full text-sm hover:bg-violet-100 transition-colors"
              >
                {h}
              </button>
            ))}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Topic <span className="text-red-500">*</span></label>
          <textarea
            rows={3}
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder="e.g. The impact of AI on creative jobs in 2025"
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 outline-none"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Niche / Category <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={niche}
              onChange={e => setNiche(e.target.value)}
              placeholder="e.g. Technology, AI"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-violet-300 focus:border-violet-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
            <select
              value={lang}
              onChange={e => setLang(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-violet-300 focus:border-violet-400 outline-none bg-white"
            >
              {LANG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}
        <button
          type="button"
          onClick={() => { void research(); }}
          disabled={loading || !topic.trim()}
          className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
          {loading ? 'Researching…' : 'Research with AI'}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <AiWorkingCard
          label="Researching topic…"
          detail="Gathering facts, angles, and expert perspectives (~15–30 seconds)"
        />
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-5">
          {durationMs !== null && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Clock className="w-3 h-3" />
              Completed in {formatDuration(durationMs)}
            </div>
          )}

          {/* Summary */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-semibold text-gray-900 mb-3 text-lg">{result.topic}</h2>
            <p className="text-gray-700 leading-relaxed">{result.summary}</p>
            {result.callToAction && (
              <p className="mt-3 text-sm text-violet-700 font-medium">📢 {result.callToAction}</p>
            )}
          </div>

          {/* Key Facts */}
          {(result.keyFacts ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Key Facts</h2>
              <ol className="space-y-2">
                {result.keyFacts.map((fact, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="shrink-0 w-5 h-5 bg-violet-100 text-violet-700 rounded-full text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                    <span className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700">{fact}</span>
                    <CopyChip text={fact} />
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Content Angles */}
          {(result.contentAngles ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Content Angles</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {result.contentAngles.map((a, i) => (
                  <div key={i} className="border-l-4 border-violet-400 bg-violet-50/40 rounded-r-xl pl-4 pr-3 py-3">
                    <p className="font-semibold text-gray-900 text-sm mb-1">{a.angle}</p>
                    <p className="text-gray-600 text-sm leading-relaxed">{a.hook}</p>
                    {a.targetAudience && (
                      <span className="mt-2 inline-block px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs">{a.targetAudience}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stats & Data */}
          {(result.statisticsAndData ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Statistics & Data</h2>
              <ul className="space-y-2">
                {result.statisticsAndData!.map((s, i) => (
                  <li key={i} className="px-3 py-2 bg-blue-50 border-l-2 border-blue-400 rounded-r-lg text-sm text-gray-700">{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Expert Perspectives */}
          {(result.expertPerspectives ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Expert Perspectives</h2>
              <ul className="space-y-2">
                {result.expertPerspectives!.map((p, i) => (
                  <li key={i} className="italic text-gray-600 text-sm border-l-2 border-gray-300 pl-3">"{p}"</li>
                ))}
              </ul>
            </div>
          )}

          {/* Controversial Points */}
          {(result.controversialPoints ?? []).length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h2 className="font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Controversial Points
              </h2>
              <ul className="space-y-1">
                {result.controversialPoints!.map((p, i) => (
                  <li key={i} className="text-sm text-amber-800">• {p}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Related Topics */}
          {(result.relatedTopics ?? []).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h2 className="font-semibold text-gray-900 mb-3">Related Topics</h2>
              <div className="flex flex-wrap gap-2">
                {result.relatedTopics.map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setTopic(t)}
                    className="px-3 py-1 bg-violet-50 text-violet-700 rounded-full text-sm hover:bg-violet-100 transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ResultActions content={resultText} filename={`research-${result.topic.slice(0, 30).replace(/\s+/g, '-').toLowerCase()}.md`} />
        </div>
      )}
    </div>
  );
}
