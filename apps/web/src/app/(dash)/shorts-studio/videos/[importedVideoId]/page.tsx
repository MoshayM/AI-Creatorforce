'use client';
import { useCallback, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Sparkles, ListTree, Trophy, Scissors, CheckCircle2, Clapperboard, Pencil, Upload, ShieldCheck, ExternalLink, XCircle, ChevronDown, ChevronRight, BookOpen, Check } from 'lucide-react';
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

interface Chapter {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  summary: string;
  keyPoints: string[];
  confidence: number;
  editedByUser: boolean;
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

/** Tiny status chip shown in the collapsed row while a publish flow runs. */
function PhaseChip({ phase }: { phase: FlowPhase }) {
  if (phase.step === 'working') {
    return <span className="flex items-center gap-1 px-2 py-0.5 bg-brand-50 text-brand-700 rounded-full text-[11px] shrink-0"><Loader2 className="w-3 h-3 animate-spin" /> {phase.label}</span>;
  }
  if (phase.step === 'awaiting-approval') {
    return <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[11px] shrink-0"><ShieldCheck className="w-3 h-3" /> awaiting review</span>;
  }
  if (phase.step === 'published') {
    return <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-[11px] shrink-0"><CheckCircle2 className="w-3 h-3" /> published</span>;
  }
  if (phase.step === 'error') {
    return <span className="flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[11px] shrink-0"><XCircle className="w-3 h-3" /> failed</span>;
  }
  return null;
}

function HighlightCard({ h, open, onToggle }: { h: Highlight; open: boolean; onToggle: () => void }) {
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
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      {/* Collapsed header — always visible, click to enlarge */}
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        <span className="text-lg font-bold text-brand-700 shrink-0 w-8 text-center">{Math.round(h.finalScore)}</span>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${CATEGORY_COLORS[h.topicSegment.category] ?? 'bg-gray-100 text-gray-600'}`}>
          {h.topicSegment.category.replace(/_/g, ' ')}
        </span>
        <p className="font-semibold text-gray-900 text-sm truncate flex-1 min-w-0">{h.titleSuggestion}</p>
        <PhaseChip phase={phase} />
        <span className="text-xs text-gray-400 shrink-0">{fmt(h.topicSegment.startMs)}–{fmt(h.topicSegment.endMs)}</span>
      </div>

      {!open ? null : (
      <div className="px-5 pb-5 border-t border-gray-50 pt-3">
      <p className="text-sm text-gray-500">{h.reason}</p>
      {h.keywords.length > 0 && (
        <p className="text-[11px] text-gray-400 mt-1.5 truncate">{h.keywords.map((k) => `#${k.replace(/\s+/g, '')}`).join(' ')}</p>
      )}

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
      )}
    </div>
  );
}

export default function ShortsVideoDetailPage() {
  const { importedVideoId } = useParams<{ importedVideoId: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'highlights' | 'topics' | 'chapters'>('highlights');
  const [openHighlights, setOpenHighlights] = useState<Set<string>>(new Set());
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());
  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterTitleDraft, setChapterTitleDraft] = useState('');
  const [clipsOpen, setClipsOpen] = useState(true);
  const [openClips, setOpenClips] = useState<Set<string>>(new Set());

  const { data: topics = [], isLoading: loadingTopics } = useQuery<Topic[]>({
    queryKey: ['shorts-topics', importedVideoId],
    queryFn: () => api.shortsStudio.topics(importedVideoId).then((r) => r.data as Topic[]),
  });
  const { data: chapters = [] } = useQuery<Chapter[]>({
    queryKey: ['shorts-chapters', importedVideoId],
    queryFn: () => api.shortsStudio.chapters(importedVideoId).then((r) => r.data as Chapter[]),
  });
  const detectChapters = useMutation({
    mutationFn: () => api.shortsStudio.detectChapters(importedVideoId),
  });
  const renameChapter = useMutation({
    mutationFn: ({ chapterId, title }: { chapterId: string; title: string }) =>
      api.shortsStudio.updateChapter(chapterId, { title }),
    onSuccess: () => {
      setEditingChapterId(null);
      void qc.invalidateQueries({ queryKey: ['shorts-chapters', importedVideoId] });
    },
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
          <button
            onClick={() => setTab('chapters')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg ${tab === 'chapters' ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-500'}`}
          >
            <BookOpen className="w-4 h-4" /> Chapters ({chapters.length})
          </button>
        </div>
      </div>

      {clips.length > 0 && (
        <section className="mb-6">
          <div
            onClick={() => setClipsOpen((o) => !o)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setClipsOpen((o) => !o); } }}
            className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors shadow-sm"
          >
            {clipsOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
              <Clapperboard className="w-4 h-4" /> Clips
            </h2>
            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[11px] font-medium">{clips.length}</span>
            {clipsOpen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenClips((prev) => prev.size === clips.length ? new Set() : new Set(clips.map((c) => c.id)));
                }}
                className="ml-auto text-xs text-brand-600 hover:underline"
              >
                {openClips.size === clips.length ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          {clipsOpen && (
            <div className="space-y-2 mt-2">
              {clips.map((c) => {
                const open = openClips.has(c.id);
                const toggle = () => setOpenClips((prev) => {
                  const next = new Set(prev);
                  if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                  return next;
                });
                const published = c.status === 'PUBLISHED';
                return (
                  <div key={c.id} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                    <div
                      onClick={toggle}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                      <p className="text-sm font-medium text-gray-900 truncate flex-1 min-w-0">
                        {c.topicSegment.highlight?.titleSuggestion ?? c.topicSegment.title}
                      </p>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${published ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {c.status.replace(/_/g, ' ').toLowerCase()}
                      </span>
                      <span className="text-[11px] text-gray-400 shrink-0">{c.timeline ? fmt(c.timeline.durationMs) : '—'}</span>
                    </div>
                    {open && (
                      <div className="px-4 pb-4 pt-2 border-t border-gray-50 flex items-center gap-4 flex-wrap">
                        <div className="text-xs text-gray-500 space-y-0.5 flex-1 min-w-[220px]">
                          <p><span className="text-gray-400">Platform:</span> {c.clipType.replace(/_/g, ' ')}</p>
                          <p><span className="text-gray-400">Source range:</span> {fmt(c.sourceStartMs)}–{fmt(c.sourceEndMs)}</p>
                          <p><span className="text-gray-400">Captions:</span> {c.timeline?._count.captions ? `${c.timeline._count.captions} lines` : 'none yet'}</p>
                          {c.topicSegment.highlight && (
                            <p><span className="text-gray-400">Highlight score:</span> {Math.round(c.topicSegment.highlight.finalScore)}</p>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Link
                            href={`/shorts-studio/clips/${c.id}/edit`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-700"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </Link>
                          <Link
                            href={`/shorts-studio/clips/${c.id}/export`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1.5 px-3 py-1.5 border border-brand-200 text-brand-700 rounded-lg text-xs hover:bg-brand-50"
                          >
                            <Clapperboard className="w-3.5 h-3.5" /> Export
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
          {highlights.length > 0 && (
            <div className="flex justify-end -mb-2">
              <button
                onClick={() => setOpenHighlights((prev) => prev.size === highlights.length ? new Set() : new Set(highlights.map((h) => h.id)))}
                className="text-xs text-brand-600 hover:underline"
              >
                {openHighlights.size === highlights.length ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          )}
          {highlights.map((h) => (
            <HighlightCard
              key={h.id}
              h={h}
              open={openHighlights.has(h.id)}
              onToggle={() => setOpenHighlights((prev) => {
                const next = new Set(prev);
                if (next.has(h.id)) next.delete(h.id); else next.add(h.id);
                return next;
              })}
            />
          ))}
        </div>
      )}

      {!loading && tab === 'topics' && (
        <div className="space-y-2">
          {topics.length === 0 && (
            <p className="text-center text-gray-400 py-16">No topics yet — run Analyze from the Shorts Studio page.</p>
          )}
          {topics.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => setOpenTopics((prev) => prev.size === topics.length ? new Set() : new Set(topics.map((t) => t.id)))}
                className="text-xs text-brand-600 hover:underline"
              >
                {openTopics.size === topics.length ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          )}
          {topics.map((t) => {
            const open = openTopics.has(t.id);
            const toggle = () => setOpenTopics((prev) => {
              const next = new Set(prev);
              if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
              return next;
            });
            return (
              <div key={t.id} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                <div
                  onClick={toggle}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                  <span className="text-xs text-gray-400 font-mono shrink-0 w-20">{fmt(t.startMs)}–{fmt(t.endMs)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${CATEGORY_COLORS[t.category] ?? 'bg-gray-100 text-gray-600'}`}>
                    {t.category.replace(/_/g, ' ')}
                  </span>
                  <p className="font-medium text-gray-900 truncate text-sm flex-1 min-w-0">{t.title}</p>
                  {t.highlight && (
                    <span className="text-sm font-bold text-brand-700 shrink-0" title="Highlight score">
                      {Math.round(t.highlight.finalScore)}
                    </span>
                  )}
                </div>
                {open && (
                  <div className="px-4 pb-4 pt-2 border-t border-gray-50">
                    <p className="text-sm text-gray-600">{t.summary}</p>
                    <p className="text-[11px] text-gray-400 mt-2">
                      {fmt(t.startMs)}–{fmt(t.endMs)} · {Math.round((t.endMs - t.startMs) / 1000)}s · confidence {(t.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && tab === 'chapters' && (
        <div className="space-y-2">
          {chapters.length === 0 && (
            <div className="text-center py-16">
              <p className="text-gray-400 mb-4">No chapters yet.</p>
              <button
                onClick={() => detectChapters.mutate()}
                disabled={detectChapters.isPending || detectChapters.isSuccess || topics.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {detectChapters.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                {detectChapters.isSuccess ? 'Detecting — check back shortly' : 'Detect chapters'}
              </button>
              {topics.length === 0 && (
                <p className="text-xs text-gray-400 mt-2">Chapters are derived from topics — run Analyze first.</p>
              )}
            </div>
          )}
          {chapters.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => setOpenChapters((prev) => prev.size === chapters.length ? new Set() : new Set(chapters.map((c) => c.id)))}
                className="text-xs text-brand-600 hover:underline"
              >
                {openChapters.size === chapters.length ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          )}
          {chapters.map((c, i) => {
            const open = openChapters.has(c.id);
            const editing = editingChapterId === c.id;
            const toggle = () => setOpenChapters((prev) => {
              const next = new Set(prev);
              if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
              return next;
            });
            const saveTitle = () => {
              const title = chapterTitleDraft.trim();
              if (title && title !== c.title) renameChapter.mutate({ chapterId: c.id, title });
              else setEditingChapterId(null);
            };
            return (
              <div key={c.id} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                <div
                  onClick={editing ? undefined : toggle}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (!editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } }}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                  <span className="text-xs text-gray-400 font-mono shrink-0 w-24">{fmt(c.startMs)}–{fmt(c.endMs)}</span>
                  <span className="px-2 py-0.5 bg-brand-50 text-brand-700 rounded-full text-[11px] font-medium shrink-0">Ch. {i + 1}</span>
                  {editing ? (
                    <span className="flex items-center gap-1.5 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={chapterTitleDraft}
                        onChange={(e) => setChapterTitleDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingChapterId(null); }}
                        className="flex-1 min-w-0 text-sm border border-brand-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                      <button onClick={saveTitle} disabled={renameChapter.isPending} className="text-brand-600 hover:text-brand-800 shrink-0">
                        {renameChapter.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </button>
                    </span>
                  ) : (
                    <>
                      <p className="font-medium text-gray-900 truncate text-sm flex-1 min-w-0">
                        {c.title}
                        {c.editedByUser && <span className="ml-1.5 text-[10px] text-gray-400" title="Edited by you">✎</span>}
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingChapterId(c.id); setChapterTitleDraft(c.title); }}
                        className="text-gray-300 hover:text-brand-600 shrink-0"
                        title="Rename chapter"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <span className="text-[11px] text-gray-400 shrink-0">{Math.round((c.endMs - c.startMs) / 1000)}s</span>
                </div>
                {open && (
                  <div className="px-4 pb-4 pt-2 border-t border-gray-50">
                    <p className="text-sm text-gray-600">{c.summary}</p>
                    {c.keyPoints.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {c.keyPoints.map((kp, j) => (
                          <li key={j} className="text-xs text-gray-500 flex gap-1.5">
                            <span className="text-brand-400">•</span> {kp}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="text-[11px] text-gray-400 mt-2">
                      {fmt(c.startMs)}–{fmt(c.endMs)} · confidence {(c.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
