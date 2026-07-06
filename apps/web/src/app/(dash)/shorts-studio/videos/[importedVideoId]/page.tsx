'use client';
import { useCallback, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Sparkles, ListTree, Trophy, Scissors, CheckCircle2, Clapperboard, Pencil, Upload, ShieldCheck, ExternalLink, XCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface Topic {
  id: string;
  startMs: number;
  endMs: number;
  category: string;
  title: string;
  summary: string;
  confidence: number;
  highlight: { id: string; finalScore: number } | null;
}

interface Clip {
  id: string;
  clipType: string;
  status: string;
  sourceStartMs: number;
  sourceEndMs: number;
  topicSegment: { title: string; highlight: { titleSuggestion: string; finalScore: number } | null };
  timeline: { id: string; durationMs: number; _count: { captions: number } } | null;
}

interface Highlight {
  id: string;
  finalScore: number;
  reason: string;
  titleSuggestion: string;
  keywords: string[];
  virality: number;
  emotion: number;
  retention: number;
  hookStrength: number;
  education: number;
  entertainment: number;
  confidence: number;
  trendPotential: number;
  shortSuitability: number;
  topicSegment: { id: string; startMs: number; endMs: number; category: string; title: string };
}

const DIMENSIONS: Array<{ key: keyof Highlight; label: string }> = [
  { key: 'virality', label: 'Virality' },
  { key: 'emotion', label: 'Emotion' },
  { key: 'retention', label: 'Retention' },
  { key: 'hookStrength', label: 'Hook' },
  { key: 'education', label: 'Education' },
  { key: 'entertainment', label: 'Entertainment' },
  { key: 'confidence', label: 'Confidence' },
  { key: 'trendPotential', label: 'Trend' },
  { key: 'shortSuitability', label: 'Short fit' },
];

const CLIP_TYPES = [
  { value: 'YOUTUBE_SHORTS', label: 'YouTube Shorts' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'INSTAGRAM_REELS', label: 'Instagram Reels' },
];

const CATEGORY_COLORS: Record<string, string> = {
  HOOK: 'bg-pink-100 text-pink-700',
  STORY: 'bg-amber-100 text-amber-700',
  TIP: 'bg-green-100 text-green-700',
  TUTORIAL_STEP: 'bg-blue-100 text-blue-700',
  FUNNY_MOMENT: 'bg-purple-100 text-purple-700',
  STATISTIC: 'bg-cyan-100 text-cyan-700',
  CALL_TO_ACTION: 'bg-red-100 text-red-700',
};

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function scoreColor(v: number): string {
  if (v >= 70) return 'text-green-600';
  if (v >= 40) return 'text-amber-600';
  return 'text-gray-400';
}

type FlowPhase =
  | { step: 'idle' }
  | { step: 'working'; label: string }
  | { step: 'awaiting-approval' }
  | { step: 'published'; url: string }
  | { step: 'error'; message: string };

/**
 * One-click publish: clip → captions → render → export → approval request,
 * then auto-publishes the moment the review is approved on /approvals.
 * Every backend stage self-skips when already satisfied, so re-clicking
 * resumes an interrupted flow instead of redoing work.
 */
function usePublishFlow(highlightId: string, qc: ReturnType<typeof useQueryClient>) {
  const [phase, setPhase] = useState<FlowPhase>({ step: 'idle' });
  const cancelled = useRef(false);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const waitJob = useCallback(async (jobId: string, label: string) => {
    setPhase({ step: 'working', label });
    for (;;) {
      if (cancelled.current) throw new Error('cancelled');
      const job = (await api.jobs.get(jobId)).data as { status: string; error?: string };
      if (job.status === 'COMPLETED') return;
      if (job.status === 'FAILED') throw new Error(job.error ?? `${label} failed`);
      await sleep(4000);
    }
  }, []);

  const run = useCallback(async () => {
    cancelled.current = false;
    try {
      setPhase({ step: 'working', label: 'Creating clip…' });
      const clips = (await api.shortsStudio.generateClips(highlightId, ['YOUTUBE_SHORTS'])).data as Array<{ id: string }>;
      const clipId = clips[0]!.id;
      void qc.invalidateQueries({ queryKey: ['shorts-clips'] });

      const captionJob = (await api.shortsStudio.generateCaptions(clipId)).data as { id: string };
      await waitJob(captionJob.id, 'Generating captions…');

      const renderJob = (await api.shortsStudio.render(clipId)).data as { id: string };
      await waitJob(renderJob.id, 'Rendering vertical video…');

      const exportJob = (await api.shortsStudio.exportClip(clipId)).data as { id: string };
      await waitJob(exportJob.id, 'Building export package…');

      await api.shortsStudio.requestPublish(clipId);
      setPhase({ step: 'awaiting-approval' });

      // Poll the approval; auto-publish once the human review lands
      for (;;) {
        if (cancelled.current) throw new Error('cancelled');
        const s = (await api.shortsStudio.publishStatus(clipId)).data as {
          approval: { status: string } | null;
          publishJob: { status: string; result?: { url?: string } } | null;
        };
        if (s.publishJob?.status === 'COMPLETED' && s.publishJob.result?.url) {
          setPhase({ step: 'published', url: s.publishJob.result.url });
          return;
        }
        if (s.approval?.status === 'REJECTED') throw new Error('Review was rejected on the Approvals page');
        if (s.approval?.status === 'APPROVED' && (!s.publishJob || s.publishJob.status === 'FAILED')) {
          const pub = (await api.shortsStudio.publish(clipId)).data as { id: string };
          await waitJob(pub.id, 'Publishing to YouTube…');
          const done = (await api.shortsStudio.publishStatus(clipId)).data as { publishJob: { result?: { url?: string } } | null };
          setPhase({ step: 'published', url: done.publishJob?.result?.url ?? '' });
          return;
        }
        setPhase({ step: 'awaiting-approval' });
        await sleep(8000);
      }
    } catch (err) {
      if ((err as Error).message !== 'cancelled') {
        const e = err as { response?: { data?: { message?: string } }; message?: string };
        setPhase({ step: 'error', message: e.response?.data?.message ?? e.message ?? 'Publish flow failed' });
      }
    }
  }, [highlightId, qc, waitJob]);

  return { phase, run };
}

function HighlightCard({ h }: { h: Highlight }) {
  const qc = useQueryClient();
  const [types, setTypes] = useState<string[]>(['YOUTUBE_SHORTS']);
  const [generated, setGenerated] = useState(false);
  const { phase, run } = usePublishFlow(h.id, qc);

  const generate = useMutation({
    mutationFn: () => api.shortsStudio.generateClips(h.id, types),
    onSuccess: () => {
      setGenerated(true);
      void qc.invalidateQueries({ queryKey: ['shorts-clips'] });
    },
  });

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-brand-700">{Math.round(h.finalScore)}</span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${CATEGORY_COLORS[h.topicSegment.category] ?? 'bg-gray-100 text-gray-600'}`}>
              {h.topicSegment.category.replace(/_/g, ' ')}
            </span>
            <span className="text-xs text-gray-400">{fmt(h.topicSegment.startMs)}–{fmt(h.topicSegment.endMs)}</span>
          </div>
          <p className="font-semibold text-gray-900 mt-1.5">{h.titleSuggestion}</p>
          <p className="text-sm text-gray-500 mt-1">{h.reason}</p>
          {h.keywords.length > 0 && (
            <p className="text-[11px] text-gray-400 mt-1.5 truncate">{h.keywords.map((k) => `#${k.replace(/\s+/g, '')}`).join(' ')}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-9 gap-2 mt-4">
        {DIMENSIONS.map(({ key, label }) => (
          <div key={key} className="text-center">
            <p className={`text-sm font-bold ${scoreColor(h[key] as number)}`}>{Math.round(h[key] as number)}</p>
            <p className="text-[10px] text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-50 flex-wrap">
        {CLIP_TYPES.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-1.5 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={types.includes(value)}
              onChange={(e) => setTypes((t) => (e.target.checked ? [...t, value] : t.filter((x) => x !== value)))}
              className="rounded border-gray-300"
            />
            {label}
          </label>
        ))}
        <button
          onClick={() => generate.mutate()}
          disabled={generate.isPending || types.length === 0 || generated}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 border border-brand-200 text-brand-700 rounded-lg text-xs hover:bg-brand-50 disabled:opacity-50"
        >
          {generate.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : generated ? <CheckCircle2 className="w-3.5 h-3.5" />
            : <Scissors className="w-3.5 h-3.5" />}
          {generated ? 'Clips created' : 'Generate clips'}
        </button>
        <button
          onClick={() => void run()}
          disabled={phase.step === 'working' || phase.step === 'awaiting-approval' || phase.step === 'published'}
          title="Clip → captions → render → export, then publishes automatically after your approval"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-700 disabled:opacity-50"
        >
          {phase.step === 'working' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Publish
        </button>
      </div>

      {phase.step === 'working' && (
        <p className="text-xs text-brand-700 mt-2 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {phase.label}
        </p>
      )}
      {phase.step === 'awaiting-approval' && (
        <p className="text-xs text-amber-700 mt-2 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          Ready — waiting for your review on the{' '}
          <Link href="/approvals" className="underline font-medium">Approvals page</Link>. Publishes automatically once approved.
        </p>
      )}
      {phase.step === 'published' && (
        <p className="text-xs text-green-700 mt-2 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Published!
          {phase.url && (
            <a href={phase.url} target="_blank" rel="noreferrer" className="underline font-medium flex items-center gap-0.5">
              Watch on YouTube <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </p>
      )}
      {phase.step === 'error' && (
        <p className="text-xs text-red-600 mt-2 flex items-center gap-1.5">
          <XCircle className="w-3.5 h-3.5" /> {phase.message} — click Publish to resume (finished steps are skipped).
        </p>
      )}
      {generate.isError && (
        <p className="text-xs text-red-500 mt-2">
          {(generate.error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed to generate clips'}
        </p>
      )}
    </div>
  );
}

export default function ShortsVideoDetailPage() {
  const { importedVideoId } = useParams<{ importedVideoId: string }>();
  const [tab, setTab] = useState<'highlights' | 'topics'>('highlights');

  const { data: topics = [], isLoading: loadingTopics } = useQuery<Topic[]>({
    queryKey: ['shorts-topics', importedVideoId],
    queryFn: () => api.shortsStudio.topics(importedVideoId).then((r) => r.data as Topic[]),
  });
  const { data: highlights = [], isLoading: loadingHighlights } = useQuery<Highlight[]>({
    queryKey: ['shorts-highlights', importedVideoId],
    queryFn: () => api.shortsStudio.highlights(importedVideoId).then((r) => r.data as Highlight[]),
  });
  const { data: clips = [] } = useQuery<Clip[]>({
    queryKey: ['shorts-clips', importedVideoId],
    queryFn: () => api.shortsStudio.videoClips(importedVideoId).then((r) => r.data as Clip[]),
  });

  const loading = loadingTopics || loadingHighlights;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href="/shorts-studio" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> Shorts Studio
      </Link>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-brand-600" /> Analysis results
        </h1>
        <div className="flex rounded-xl bg-gray-100 p-1 text-sm">
          <button
            onClick={() => setTab('highlights')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg ${tab === 'highlights' ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-500'}`}
          >
            <Trophy className="w-4 h-4" /> Highlights ({highlights.length})
          </button>
          <button
            onClick={() => setTab('topics')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg ${tab === 'topics' ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-500'}`}
          >
            <ListTree className="w-4 h-4" /> Topics ({topics.length})
          </button>
        </div>
      </div>

      {clips.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Clapperboard className="w-4 h-4" /> Clips ({clips.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {clips.map((c) => (
              <div key={c.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {c.topicSegment.highlight?.titleSuggestion ?? c.topicSegment.title}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {c.clipType.replace(/_/g, ' ')} · {c.timeline ? fmt(c.timeline.durationMs) : '—'} · {c.status.replace(/_/g, ' ').toLowerCase()}
                    {c.timeline && c.timeline._count.captions > 0 ? ` · ${c.timeline._count.captions} captions` : ''}
                  </p>
                </div>
                <Link
                  href={`/shorts-studio/clips/${c.id}/edit`}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-700 shrink-0"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-gray-400 py-16 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading analysis…
        </div>
      )}

      {!loading && tab === 'highlights' && (
        <div className="space-y-4">
          {highlights.length === 0 && (
            <p className="text-center text-gray-400 py-16">
              No highlights yet — run Analyze from the Shorts Studio page and wait for the pipeline to finish.
            </p>
          )}
          {highlights.map((h) => <HighlightCard key={h.id} h={h} />)}
        </div>
      )}

      {!loading && tab === 'topics' && (
        <div className="space-y-2">
          {topics.length === 0 && (
            <p className="text-center text-gray-400 py-16">No topics yet — run Analyze from the Shorts Studio page.</p>
          )}
          {topics.map((t) => (
            <div key={t.id} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
              <span className="text-xs text-gray-400 font-mono shrink-0 mt-0.5 w-20">{fmt(t.startMs)}–{fmt(t.endMs)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${CATEGORY_COLORS[t.category] ?? 'bg-gray-100 text-gray-600'}`}>
                    {t.category.replace(/_/g, ' ')}
                  </span>
                  <p className="font-medium text-gray-900 truncate">{t.title}</p>
                </div>
                <p className="text-sm text-gray-500 mt-1">{t.summary}</p>
              </div>
              {t.highlight && (
                <span className="text-sm font-bold text-brand-700 shrink-0" title="Highlight score">
                  {Math.round(t.highlight.finalScore)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
