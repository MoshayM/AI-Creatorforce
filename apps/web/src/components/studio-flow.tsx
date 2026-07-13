'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Youtube, BarChart2, Lightbulb, FileText, Mic, Music, Clapperboard,
  Play, RefreshCw, Loader2, CheckCircle, ChevronDown, ChevronUp, Save, Pencil, AlertTriangle, X,
  KeyRound, Sparkles, Download, FileVideo, FileAudio, FileImage, FileText as FileTextIcon, ShieldCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ElapsedBadge, formatElapsed } from '@/components/ai-activity';
import { getErrorMessage } from '@/lib/getErrorMessage';

/**
 * Guided in-project production flow (design refs: image.png layout —
 * channel → Analyse / Suggestion / Script / Voice over / Music / Video —
 * with project.PNG's soft lavender clay tiles). Every tile wraps the
 * compliance-gated pipeline with resume, and every stage result is editable:
 * edits persist via the stage-override endpoint so downstream stages use
 * the edited version.
 */

export interface PipelineProgress {
  stage: string;
  index: number;
  count: number;
  etaSecs: number;
}

interface Job {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  result?: unknown;
  error?: string | null;
}

interface ScriptResult {
  title: string;
  hook: string;
  sections: Array<{ heading: string; content: string; durationEstimateSecs?: number }>;
  callToAction: string;
  totalWordCount?: number;
  estimatedDurationMins?: number;
  sources?: string[];
}

interface Props {
  projectId: string;
  channel: { title: string; youtubeChannelId: string };
  jobs: Job[];
  anyPipelineRunning: boolean;
  progress: PipelineProgress | null;
  runningPipeline: { id: string; startedAt?: string | null; createdAt: string } | null;
}

const RUNNING_STATES = ['PENDING', 'QUEUED', 'RUNNING'];

// Target distribution platform — shapes research/script tone and format
const PLATFORMS = ['YouTube', 'Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'Podcast', 'Custom'] as const;

const PRESETS = [
  { value: 'LANDSCAPE', label: 'Landscape 16:9' },
  { value: 'VERTICAL',  label: 'Vertical 9:16' },
  { value: 'SQUARE',    label: 'Square 1:1' },
] as const;

const FULL_MEDIA_REGENERATE = ['VOICE_GENERATE', 'IMAGE_GENERATE', 'MUSIC_GENERATE', 'VIDEO_GENERATE', 'EDIT_PLAN', 'RENDER'] as const;

function latest(jobs: Job[], type: string): Job | undefined {
  return jobs
    .filter((j) => j.type === type)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function isDone(jobs: Job[], type: string): boolean {
  return latest(jobs, type)?.status === 'COMPLETED';
}

function isRunning(jobs: Job[], ...types: string[]): Job | undefined {
  return jobs
    .filter((j) => types.includes(j.type) && RUNNING_STATES.includes(j.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

/** Latest FAILED job of the given types, unless a newer success/run supersedes it. */
function latestFailure(jobs: Job[], ...types: string[]): Job | undefined {
  const relevant = jobs
    .filter((j) => types.includes(j.type))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return relevant[0]?.status === 'FAILED' ? relevant[0] : undefined;
}

function completedAt(jobs: Job[], type: string): string | undefined {
  const j = latest(jobs, type);
  return j?.status === 'COMPLETED' ? (j.completedAt ?? undefined) : undefined;
}

// ── File helpers (for exports grid) ──────────────────────────────────────────

function fileIcon(name: string) {
  if (/\.(mp4|mov|webm)$/i.test(name)) return <FileVideo className="w-4 h-4 text-brand-600" />;
  if (/\.(mp3|wav)$/i.test(name)) return <FileAudio className="w-4 h-4 text-purple-600" />;
  if (/\.(png|jpg|jpeg)$/i.test(name)) return <FileImage className="w-4 h-4 text-green-600" />;
  return <FileTextIcon className="w-4 h-4 text-gray-500" />;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

async function downloadBlob(res: { data: unknown }, name: string) {
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function StatusBadge({ state, updatedAt }: { state: 'done' | 'running' | 'failed' | 'notStarted'; updatedAt?: string }) {
  if (state === 'running') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-brand-700">
        <Loader2 className="w-3 h-3 animate-spin" /> In progress
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-red-600">
        <AlertTriangle className="w-3 h-3" /> Failed
      </span>
    );
  }
  if (state === 'done') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-green-600" title={updatedAt ? `Last updated ${new Date(updatedAt).toLocaleString()}` : undefined}>
        <CheckCircle className="w-3 h-3" />
        Completed{updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] font-medium text-gray-500">
      <span className="w-2 h-2 rounded-full bg-gray-300" /> Not started
    </span>
  );
}

// ── Small blob-backed media player (auth header needed, so no direct <audio src>) ──

function MediaPlayer({ versionId, kind }: { versionId: string; kind: 'audio' | 'video' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await api.media.versionFile(versionId);
      setUrl(URL.createObjectURL(res.data as Blob));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  if (!url) {
    return (
      <span className="flex items-center gap-2">
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-medium text-brand-700 border border-brand-200 rounded-full px-3 py-1.5 hover:bg-brand-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {loading ? 'Loading…' : loadError ? 'Retry' : kind === 'audio' ? 'Play audio' : 'Play video'}
        </button>
        {loadError && <span className="text-[11px] text-red-500">Couldn&rsquo;t load media</span>}
      </span>
    );
  }
  return kind === 'audio'
    // eslint-disable-next-line jsx-a11y/media-has-caption -- AI-generated preview; caption track not produced
    ? <audio controls src={url} className="w-full h-9" />
    // eslint-disable-next-line jsx-a11y/media-has-caption -- AI-generated preview; caption track not produced
    : <video controls src={url} className="w-full rounded-xl max-h-56 bg-black" />;
}

// ── Tile shell ────────────────────────────────────────────────────────────────

function Tile({
  icon, title, subtitle, status, running, failed, updatedAt, selected, hasDetail, onToggle, action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  status: 'done' | 'ready' | 'locked';
  running?: Job;
  failed?: Job;
  updatedAt?: string;
  selected: boolean;
  hasDetail: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  const badgeState = running ? 'running' : failed ? 'failed' : status === 'done' ? 'done' : 'notStarted';
  const expandable = hasDetail && status !== 'locked';
  return (
    <div className={`rounded-3xl p-5 transition-all duration-200 ${
      status === 'locked'
        ? 'bg-[#f3effb] opacity-70'
        : 'bg-[#efe8fb] shadow-sm hover:shadow-lg hover:-translate-y-0.5'
    }${selected ? ' ring-2 ring-[#8b74d8] shadow-md' : ''}`}>
      <div
        className={`flex items-start gap-3 ${expandable ? 'cursor-pointer' : ''}`}
        onClick={expandable ? onToggle : undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        onKeyDown={expandable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } } : undefined}
      >
        <div className="w-11 h-11 rounded-2xl bg-white shadow-sm flex items-center justify-center text-brand-600 shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-900">{title}</p>
            {running && <ElapsedBadge since={running.startedAt ?? running.createdAt} />}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        {expandable && (
          <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="text-gray-500 hover:text-gray-600 p-1 shrink-0" aria-label={`${selected ? 'Collapse' : 'Expand'} ${title}`}>
            {selected ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 mt-3.5">
        <StatusBadge state={badgeState} updatedAt={updatedAt} />
        {action}
      </div>
      {failed && !running && (
        <p className="text-[11px] text-red-500 mt-2 line-clamp-2" title={(failed as { error?: string }).error ?? ''}>
          {(failed as { error?: string }).error ?? 'The last run failed — try again.'}
        </p>
      )}
    </div>
  );
}

function RunButton({ label, onClick, disabled, rerun }: { label: string; onClick: () => void; disabled: boolean; rerun: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors disabled:opacity-40 ${
        rerun ? 'border border-brand-300 text-brand-700 hover:bg-brand-50' : 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm'
      }`}
    >
      {rerun ? <RefreshCw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      {label}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function StudioFlow({ projectId, channel, jobs, anyPipelineRunning, progress, runningPipeline }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  // Mount the detail content exactly once: inline below the card on mobile,
  // in the full-width panel on md+ (CSS-only hiding would duplicate labeled
  // inputs in the DOM).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const [error, setError] = useState('');
  const [topic, setTopic] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(`cf_topic_${projectId}`) ?? '' : '');
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>(() =>
    (typeof window !== 'undefined' ? localStorage.getItem(`cf_platform_${projectId}`) : null) as (typeof PLATFORMS)[number] | null ?? 'YouTube');
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['value']>(() =>
    (typeof window !== 'undefined' ? (localStorage.getItem(`cf_preset_${projectId}`) as (typeof PRESETS)[number]['value'] | null) : null) ?? 'LANDSCAPE');
  const [refreshMedia, setRefreshMedia] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [mood, setMood] = useState('');
  const [genre, setGenre] = useState('');
  const [scriptDraft, setScriptDraft] = useState<ScriptResult | null>(null);
  const [voiceKey, setVoiceKey] = useState('');
  const [voiceKeySaved, setVoiceKeySaved] = useState(false);

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Array<{ id: string; title: string; youtubeChannelId: string }>),
  });

  const { data: exportFiles = [] } = useQuery({
    queryKey: ['exports', projectId],
    queryFn: () => api.media.listExports(projectId).then((r) => r.data),
    refetchInterval: runningPipeline ? 15_000 : false,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['project', projectId] });

  const enqueue = useMutation({
    mutationFn: ({ type, payload }: { type: string; payload?: Record<string, unknown> }) =>
      api.jobs.enqueue(projectId, type, payload),
    onMutate: () => setError(''),
    onError: (err: unknown) => setError(getErrorMessage(err) || 'Failed to start'),
    onSettled: invalidate,
  });

  const switchChannel = useMutation({
    mutationFn: (channelId: string) => api.projects.update(projectId, { channelId }),
    onSettled: invalidate,
  });

  const saveScript = useMutation({
    mutationFn: (result: ScriptResult) => {
      const words = [result.hook, ...result.sections.map((s) => s.content), result.callToAction]
        .join(' ').trim().split(/\s+/).length;
      return api.jobs.overrideResult(projectId, 'SCRIPT', { ...result, totalWordCount: words });
    },
    onSuccess: () => { setScriptDraft(null); invalidate(); },
    onError: (err: unknown) => setError(getErrorMessage(err) || 'Failed to save script'),
  });

  const saveVoiceKey = useMutation({
    mutationFn: (key: string) => api.settings.updateApiKeys({ ELEVENLABS_API_KEY: key.trim() }),
    onSuccess: () => { setVoiceKeySaved(true); setVoiceKey(''); },
    onError: (err: unknown) => setError(getErrorMessage(err) || 'Failed to save the voice key'),
  });

  function chooseTopic(t: string) {
    setTopic(t);
    localStorage.setItem(`cf_topic_${projectId}`, t);
  }

  function choosePlatform(p: (typeof PLATFORMS)[number]) {
    setPlatform(p);
    localStorage.setItem(`cf_platform_${projectId}`, p);
  }

  function choosePreset(p: (typeof PRESETS)[number]['value']) {
    setPreset(p);
    localStorage.setItem(`cf_preset_${projectId}`, p);
  }

  const busy = enqueue.isPending || anyPipelineRunning;

  // Stage state
  const analyseJob = latest(jobs, 'TREND_ANALYSIS');
  const analyseDone = isDone(jobs, 'TREND_ANALYSIS');
  const trends = (analyseJob?.result as { trending?: Array<{ topic: string; score: number }> } | undefined)?.trending ?? [];
  const scriptJob = latest(jobs, 'SCRIPT');
  const scriptDone = isDone(jobs, 'SCRIPT');
  const script = scriptJob?.status === 'COMPLETED' ? (scriptJob.result as ScriptResult) : null;
  const voiceJob = latest(jobs, 'VOICE_GENERATE');
  const voiceResult = voiceJob?.status === 'COMPLETED' ? (voiceJob.result as { versionId?: string; provider?: string; durationMs?: number; notes?: string }) : null;
  const musicJob = latest(jobs, 'MUSIC_GENERATE');
  const musicResult = musicJob?.status === 'COMPLETED' ? (musicJob.result as { versionId?: string; provider?: string; durationMs?: number; notes?: string }) : null;
  const musicBrief = latest(jobs, 'MUSIC_BRIEF')?.result as { mood?: string; genre?: string } | undefined;
  const videoJob = latest(jobs, 'VIDEO_GENERATE');
  const videoResult = videoJob?.status === 'COMPLETED' ? (videoJob.result as { videos?: Array<{ sceneId: string; versionId?: string; provider: string }> }) : null;
  const renderJob = latest(jobs, 'RENDER');
  const renderDone = isDone(jobs, 'RENDER');
  const renderResult = renderJob?.status === 'COMPLETED'
    ? (renderJob.result as { versionId?: string; preset?: string; durationSecs?: number } | undefined)
    : undefined;

  const runningFoundation = isRunning(jobs, 'RESEARCH', 'SCRIPT', 'FACT_CHECK', 'COMPLIANCE', 'FULL_PRODUCTION');
  const effectiveTopic = topic || customTopic;

  const toggle = (key: string) => setExpanded((e) => (e === key ? null : key));

  // Progress bar pct for rendering section
  const pct = progress && progress.count > 0 ? Math.round((progress.index / progress.count) * 100) : 0;

  // ── Detail content variables ──────────────────────────────────────────────

  // Compliance info for analyse detail
  const complianceJob = latest(jobs, 'COMPLIANCE');
  const complianceDone = complianceJob?.status === 'COMPLETED';
  const complianceResult = complianceDone
    ? (complianceJob?.result as { passed?: boolean; score?: number } | undefined)
    : undefined;

  const analyseDetail = (
    <>
      {trends.length ? (
        <ul className="space-y-1.5">
          {trends.map((t, i) => (
            <li key={i} className="flex items-center justify-between text-sm text-gray-700">
              <span className="truncate">{t.topic}</span>
              <span className="text-xs font-bold text-brand-600 shrink-0 ml-2">{t.score}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-gray-500">Run the analysis to see trending topics.</p>}

      {/* Channel intelligence rows */}
      <div className="mt-4 border-t border-gray-100 pt-3 space-y-2">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Channel intelligence</p>

        {/* Audience row */}
        {(() => {
          const audienceJob = latest(jobs, 'AUDIENCE_ANALYSIS');
          const audienceDone = isDone(jobs, 'AUDIENCE_ANALYSIS');
          const audienceRunning = isRunning(jobs, 'AUDIENCE_ANALYSIS');
          const audienceResult = audienceDone
            ? (audienceJob?.result as { primaryDemographic?: string; summary?: string } | undefined)
            : undefined;
          const audienceSummary = audienceResult?.primaryDemographic ?? audienceResult?.summary ?? '';
          return (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-gray-700 shrink-0">Audience</span>
              <span className="flex-1 text-gray-500 truncate text-right mr-2">
                {audienceRunning
                  ? <span className="flex items-center justify-end gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Running…</span>
                  : audienceSummary
                    ? audienceSummary.slice(0, 60) + (audienceSummary.length > 60 ? '…' : '')
                    : null}
              </span>
              <button
                onClick={() => enqueue.mutate({ type: 'AUDIENCE_ANALYSIS' })}
                disabled={busy}
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-40"
              >
                {audienceDone ? <RefreshCw className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                {audienceDone ? 'Re-run' : 'Run'}
              </button>
            </div>
          );
        })()}

        {/* Channel report row */}
        {(() => {
          const analyticsJob = latest(jobs, 'ANALYTICS');
          const analyticsDone = isDone(jobs, 'ANALYTICS');
          const analyticsRunning = isRunning(jobs, 'ANALYTICS');
          const analyticsResult = analyticsDone
            ? (analyticsJob?.result as { overallScore?: number; summary?: string; insights?: string[] } | undefined)
            : undefined;
          const firstInsight = analyticsResult?.insights?.[0] ?? analyticsResult?.summary ?? '';
          return (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-gray-700 shrink-0">Channel report</span>
              <span className="flex-1 text-gray-500 truncate text-right mr-2">
                {analyticsRunning
                  ? <span className="flex items-center justify-end gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Running…</span>
                  : analyticsDone && analyticsResult
                    ? `Score ${analyticsResult.overallScore ?? '?'}/100${firstInsight ? ` · ${firstInsight.slice(0, 40)}${firstInsight.length > 40 ? '…' : ''}` : ''}`
                    : null}
              </span>
              <button
                onClick={() => enqueue.mutate({ type: 'ANALYTICS' })}
                disabled={busy}
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-40"
              >
                {analyticsDone ? <RefreshCw className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                {analyticsDone ? 'Re-run' : 'Run'}
              </button>
            </div>
          );
        })()}

        {/* Growth ideas row */}
        {(() => {
          const growthJob = latest(jobs, 'GROWTH_REPORT');
          const growthDone = isDone(jobs, 'GROWTH_REPORT');
          const growthRunning = isRunning(jobs, 'GROWTH_REPORT');
          const analyticsDone = isDone(jobs, 'ANALYTICS');
          const growthResult = growthDone
            ? (growthJob?.result as { nextTopics?: Array<{ topic: string; rationale?: string; opportunityScore?: number }> } | undefined)
            : undefined;
          const firstGrowthTopic = growthResult?.nextTopics?.[0]?.topic ?? '';
          return (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-gray-700 shrink-0">Growth ideas</span>
              <span className="flex-1 text-gray-500 truncate text-right mr-2">
                {growthRunning
                  ? <span className="flex items-center justify-end gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Running…</span>
                  : firstGrowthTopic
                    ? firstGrowthTopic.slice(0, 50) + (firstGrowthTopic.length > 50 ? '…' : '')
                    : null}
              </span>
              <button
                onClick={() => enqueue.mutate({ type: 'GROWTH_REPORT' })}
                disabled={busy || !analyticsDone}
                title={!analyticsDone ? 'Run Channel report first' : 'Run Growth ideas'}
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {growthDone ? <RefreshCw className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                {growthDone ? 'Re-run' : 'Run'}
              </button>
            </div>
          );
        })()}
      </div>

      {/* Production settings */}
      <div className="mt-4 border-t border-gray-100 pt-3 space-y-3">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Production settings</p>

        <div className="space-y-2">
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-gray-700 shrink-0">Platform</span>
            <select
              value={platform}
              onChange={(e) => choosePlatform(e.target.value as (typeof PLATFORMS)[number])}
              aria-label="Target platform"
              className="border border-gray-200 bg-white rounded-full px-3 py-1.5 text-xs font-medium text-gray-700"
            >
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-gray-700 shrink-0">Output format</span>
            <select
              value={preset}
              onChange={(e) => choosePreset(e.target.value as (typeof PRESETS)[number]['value'])}
              aria-label="Output format"
              className="border border-gray-200 bg-white rounded-full px-3 py-1.5 text-xs font-medium text-gray-700"
            >
              {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={refreshMedia}
              onChange={(e) => setRefreshMedia(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-gray-700">Regenerate media on next render</span>
          </label>
          <p className="text-[11px] text-gray-500 pl-5">Ignores cached voice/music/images when rendering.</p>
        </div>

        {/* Compliance status */}
        <div className="flex items-center gap-2 text-xs pt-1">
          {complianceDone && complianceResult ? (
            complianceResult.passed ? (
              <span className="flex items-center gap-1.5 text-green-700">
                <CheckCircle className="w-3.5 h-3.5" />
                Compliance passed · score {complianceResult.score ?? '?'}/100
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" />
                Compliance failed · score {complianceResult.score ?? '?'}/100
              </span>
            )
          ) : (
            <span className="flex items-center gap-1.5 text-gray-500">
              <ShieldCheck className="w-3.5 h-3.5" />
              Runs automatically before any media generation
            </span>
          )}
        </div>

        <p className="text-[11px] text-gray-500 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 shrink-0" />
          Compliance-gated · publishing always needs your approval
        </p>
      </div>
    </>
  );

  const suggestionDetail = (() => {
    const growthJob = latest(jobs, 'GROWTH_REPORT');
    const growthTopics = (growthJob?.status === 'COMPLETED'
      ? (growthJob.result as { nextTopics?: Array<{ topic: string }> } | undefined)?.nextTopics
      : undefined) ?? [];

    // AI recommendations from TREND_ANALYSIS + GROWTH_REPORT
    const trendRecs = (analyseJob?.status === 'COMPLETED'
      ? (analyseJob.result as { recommendations?: string[] } | undefined)?.recommendations
      : undefined) ?? [];
    const growthActions = (growthJob?.status === 'COMPLETED'
      ? (growthJob.result as { optimizationActions?: Array<{ priority: string; action: string }> } | undefined)?.optimizationActions
      : undefined) ?? [];
    const hasAiRecs = trendRecs.length > 0 || growthActions.length > 0;

    return (
      <div className="space-y-3">
        {trends.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {trends.map((t, i) => (
              <button
                key={i}
                onClick={() => chooseTopic(t.topic)}
                className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                  topic === t.topic ? 'bg-brand-600 text-white border-brand-600' : 'border-brand-200 text-brand-700 hover:bg-brand-50'
                }`}
              >
                {t.topic}
              </button>
            ))}
          </div>
        )}
        {growthTopics.length > 0 && (
          <>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">From growth analysis</p>
            <div className="flex flex-wrap gap-1.5">
              {growthTopics.map((g, i) => (
                <button
                  key={i}
                  onClick={() => chooseTopic(g.topic)}
                  className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
                    topic === g.topic ? 'bg-brand-600 text-white border-brand-600' : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'
                  }`}
                >
                  {g.topic}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="flex gap-2">
          <input
            value={customTopic}
            onChange={(e) => setCustomTopic(e.target.value)}
            placeholder="…or write your own topic"
            className="flex-1 text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <button
            onClick={() => customTopic.trim() && chooseTopic(customTopic.trim())}
            disabled={!customTopic.trim()}
            className="px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-xl disabled:opacity-40"
          >
            Use
          </button>
        </div>

        {hasAiRecs && (
          <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">AI recommendations</p>
            {trendRecs.slice(0, 3).map((rec, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-700">
                <span className="text-brand-500 font-bold shrink-0">•</span>
                <span>{rec}</span>
              </div>
            ))}
            {growthActions.slice(0, 2).map((a, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-700">
                <span className="text-indigo-500 font-bold shrink-0 uppercase text-[10px] mt-0.5">{a.priority}</span>
                <span>{a.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  })();

  const scriptDetail = (() => {
    // Publishing content from METADATA + SEO_OPTIMIZATION
    const metaJob = latest(jobs, 'METADATA');
    const metaResult = metaJob?.status === 'COMPLETED'
      ? (metaJob.result as { metadata?: { title?: string; description?: string; tags?: string[] } } | undefined)?.metadata
      : undefined;
    const seoJob = latest(jobs, 'SEO_OPTIMIZATION');
    const seoResult = seoJob?.status === 'COMPLETED'
      ? (seoJob.result as { title?: string; description?: string; tags?: string[] } | undefined)
      : undefined;

    // Chapters from script sections
    const chapters = script
      ? (() => {
          let cumSecs = 0;
          return script.sections.map((s) => {
            const mm = Math.floor(cumSecs / 60).toString().padStart(2, '0');
            const ss = (cumSecs % 60).toString().padStart(2, '0');
            const line = `${mm}:${ss} ${s.heading}`;
            cumSecs += s.durationEstimateSecs ?? 30;
            return line;
          });
        })()
      : [];

    const hasPublishing = !!(metaResult || seoResult);

    return (
      <div className="space-y-3">
        <div>
          <label htmlFor="studio-script-topic" className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Script topic</label>
          <input
            id="studio-script-topic"
            value={effectiveTopic}
            onChange={(e) => chooseTopic(e.target.value)}
            placeholder="Pick a topic in Suggestion or type one here"
            aria-label="Script topic"
            className="mt-1 w-full text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          <p className="text-[11px] text-gray-500 mt-1">Selected suggestions appear here automatically — edit freely before running.</p>
        </div>
        {script ? (
          scriptDraft ? (
            <div className="space-y-3">
              <input
                value={scriptDraft.title}
                onChange={(e) => setScriptDraft({ ...scriptDraft, title: e.target.value })}
                aria-label="Script title"
                className="w-full text-sm font-semibold px-3 py-2 border border-gray-200 rounded-xl"
              />
              <textarea
                value={scriptDraft.hook}
                onChange={(e) => setScriptDraft({ ...scriptDraft, hook: e.target.value })}
                aria-label="Hook"
                rows={2}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-xl"
              />
              {scriptDraft.sections.map((s, i) => (
                <div key={i}>
                  <input
                    value={s.heading}
                    onChange={(e) => setScriptDraft({ ...scriptDraft, sections: scriptDraft.sections.map((x, j) => j === i ? { ...x, heading: e.target.value } : x) })}
                    aria-label={`Section ${i + 1} heading`}
                    className="w-full text-xs font-semibold px-3 py-1.5 border border-gray-200 rounded-t-xl"
                  />
                  <textarea
                    value={s.content}
                    onChange={(e) => setScriptDraft({ ...scriptDraft, sections: scriptDraft.sections.map((x, j) => j === i ? { ...x, content: e.target.value } : x) })}
                    aria-label={`Section ${i + 1} content`}
                    rows={4}
                    className="w-full text-sm px-3 py-2 border border-t-0 border-gray-200 rounded-b-xl"
                  />
                </div>
              ))}
              <textarea
                value={scriptDraft.callToAction}
                onChange={(e) => setScriptDraft({ ...scriptDraft, callToAction: e.target.value })}
                aria-label="Call to action"
                rows={2}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-xl"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveScript.mutate(scriptDraft)}
                  disabled={saveScript.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-xs font-semibold rounded-full disabled:opacity-50"
                >
                  {saveScript.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save edits
                </button>
                <button onClick={() => setScriptDraft(null)} className="px-4 py-2 text-xs text-gray-500">Cancel</button>
              </div>
              <p className="text-xs text-gray-500">Saved edits flow into voice, subtitles, and video automatically.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">{script.totalWordCount ?? '?'} words · {script.sections.length} sections</p>
                <button
                  onClick={() => setScriptDraft(JSON.parse(JSON.stringify(script)) as ScriptResult)}
                  className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  <Pencil className="w-3 h-3" /> Edit script
                </button>
              </div>
              <p className="text-sm font-semibold text-gray-800">{script.title}</p>
              <p className="text-sm text-gray-600 italic">&ldquo;{script.hook}&rdquo;</p>
              <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                {script.sections.map((s, i) => (
                  <div key={i}>
                    <p className="text-xs font-semibold text-gray-500 uppercase">{s.heading}</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{s.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : <p className="text-sm text-gray-500">Pick a topic, then run — includes fact-check and the compliance gate.</p>}

        {/* Publishing content section */}
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Publishing content</p>
          {hasPublishing ? (
            <div className="space-y-3">
              {(metaResult?.title ?? seoResult?.title) && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">SEO Title</p>
                  <p className="text-sm text-gray-800 font-medium">{metaResult?.title ?? seoResult?.title}</p>
                </div>
              )}
              {(metaResult?.description ?? seoResult?.description) && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Description</p>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {((metaResult?.description ?? seoResult?.description) ?? '').slice(0, 200)}
                    {((metaResult?.description ?? seoResult?.description) ?? '').length > 200 ? '…' : ''}
                  </p>
                </div>
              )}
              {((metaResult?.tags ?? seoResult?.tags) ?? []).length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Hashtags</p>
                  <div className="flex flex-wrap gap-1">
                    {((metaResult?.tags ?? seoResult?.tags) ?? []).map((tag, i) => (
                      <span key={i} className="px-2 py-0.5 bg-brand-50 text-brand-700 text-xs rounded-full">#{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {chapters.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Chapters</p>
                  <div className="font-mono text-[11px] text-gray-600 space-y-0.5">
                    {chapters.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Generated during the Video stage.</p>
          )}
        </div>
      </div>
    );
  })();

  const voiceDetail = voiceResult?.versionId ? (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <MediaPlayer versionId={voiceResult.versionId} kind="audio" />
        <button
          onClick={async () => {
            const res = await api.media.versionFile(voiceResult.versionId!);
            await downloadBlob(res, 'voice-narration');
          }}
          className="flex items-center gap-1 text-xs font-medium text-brand-700 border border-brand-200 rounded-full px-3 py-1.5 hover:bg-brand-50 shrink-0"
          title="Download narration"
        >
          <Download className="w-3 h-3" />
        </button>
      </div>
      {voiceResult.notes && <p className="text-xs text-amber-600">{voiceResult.notes}</p>}
      {(voiceResult.provider === 'offline-synth-voice' || voiceKeySaved) && (
        <div className="border border-brand-200 bg-brand-50 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-brand-600" />
            {voiceKeySaved ? 'Real voice enabled — regenerate to hear it' : 'Enable real voice narration'}
          </p>
          {!voiceKeySaved && (
            <>
              <p className="text-[11px] text-gray-500">
                Paste your ElevenLabs API key (from elevenlabs.io → profile → API Keys). It activates instantly and is stored securely — also available in Settings → API Keys.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={voiceKey}
                  onChange={(e) => setVoiceKey(e.target.value)}
                  placeholder="ElevenLabs API key"
                  aria-label="ElevenLabs API key"
                  className="flex-1 text-xs px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
                <button
                  onClick={() => saveVoiceKey.mutate(voiceKey)}
                  disabled={!voiceKey.trim() || saveVoiceKey.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-xl disabled:opacity-40"
                >
                  {saveVoiceKey.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                  Save
                </button>
              </div>
            </>
          )}
          {voiceKeySaved && (
            <button
              onClick={() => enqueue.mutate({ type: 'FULL_PRODUCTION', payload: { scope: 'VOICE', regenerate: ['VOICE_SPEC', 'VOICE_GENERATE'] } })}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-full disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" />
              Regenerate with real voice
            </button>
          )}
        </div>
      )}
    </div>
  ) : (
    <>
      <p className="text-sm text-gray-500">Run to generate the narration from your (edited) script.</p>
      <div className="border border-brand-200 bg-brand-50 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-brand-600" />
          {voiceKeySaved ? 'Real voice enabled — regenerate to hear it' : 'Enable real voice narration'}
        </p>
        {!voiceKeySaved && (
          <>
            <p className="text-[11px] text-gray-500">
              Paste your ElevenLabs API key (from elevenlabs.io → profile → API Keys). It activates instantly and is stored securely — also available in Settings → API Keys.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={voiceKey}
                onChange={(e) => setVoiceKey(e.target.value)}
                placeholder="ElevenLabs API key"
                aria-label="ElevenLabs API key"
                className="flex-1 text-xs px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <button
                onClick={() => saveVoiceKey.mutate(voiceKey)}
                disabled={!voiceKey.trim() || saveVoiceKey.isPending}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-xl disabled:opacity-40"
              >
                {saveVoiceKey.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
                Save
              </button>
            </div>
          </>
        )}
        {voiceKeySaved && (
          <button
            onClick={() => enqueue.mutate({ type: 'FULL_PRODUCTION', payload: { scope: 'VOICE', regenerate: ['VOICE_SPEC', 'VOICE_GENERATE'] } })}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-full disabled:opacity-40"
          >
            <RefreshCw className="w-3 h-3" />
            Regenerate with real voice
          </button>
        )}
      </div>
    </>
  );

  const musicDetail = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <input
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          placeholder={`Mood${musicBrief?.mood ? ` (current: ${musicBrief.mood})` : ' — e.g. uplifting'}`}
          aria-label="Music mood"
          className="text-xs px-3 py-2 border border-gray-200 rounded-xl"
        />
        <input
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder={`Genre${musicBrief?.genre ? ` (current: ${musicBrief.genre})` : ' — e.g. cinematic'}`}
          aria-label="Music genre"
          className="text-xs px-3 py-2 border border-gray-200 rounded-xl"
        />
      </div>
      {musicResult?.versionId ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MediaPlayer versionId={musicResult.versionId} kind="audio" />
            <button
              onClick={async () => {
                const res = await api.media.versionFile(musicResult.versionId!);
                await downloadBlob(res, 'background-music');
              }}
              className="flex items-center gap-1 text-xs font-medium text-brand-700 border border-brand-200 rounded-full px-3 py-1.5 hover:bg-brand-50 shrink-0"
              title="Download music"
            >
              <Download className="w-3 h-3" />
            </button>
          </div>
          {musicResult.notes && <p className="text-xs text-amber-600">{musicResult.notes}</p>}
        </div>
      ) : <p className="text-xs text-gray-500">Set a mood/genre (or leave blank for AI&rsquo;s pick) and run.</p>}
    </div>
  );

  const videoDetail = (
    <div className="space-y-5">
      {/* Scenes */}
      <div>
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Scenes</p>
        {videoResult?.videos?.length ? (
          <div className="space-y-2">
            {/* sceneId comes from the LLM scene plan and is not guaranteed unique */}
            {videoResult.videos.map((v, i) => (
              <div key={`${v.sceneId}-${i}`} className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-600 truncate">Scene {i + 1} · {v.provider}</p>
                {v.versionId && <MediaPlayer versionId={v.versionId} kind="video" />}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Run to storyboard the script and generate every scene.</p>
        )}
      </div>

      {/* Rendering */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Rendering</p>
        {runningPipeline ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="flex items-center gap-1.5 text-gray-700">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-600" />
                {progress ? progress.stage : 'Starting pipeline…'}
              </span>
              <span className="flex items-center gap-3 text-gray-500 tabular-nums">
                <ElapsedBadge since={runningPipeline.startedAt ?? runningPipeline.createdAt} />
                {progress && progress.etaSecs > 0 && <span>~{formatElapsed(progress.etaSecs)} remaining</span>}
                {progress && <span>{progress.index}/{progress.count} stages</span>}
              </span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 rounded-full transition-all duration-700"
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() =>
              enqueue.mutate({
                type: 'FULL_PRODUCTION',
                payload: {
                  scope: 'FULL',
                  preset,
                  ...(refreshMedia
                    ? { regenerate: [...FULL_MEDIA_REGENERATE] }
                    : renderDone
                      ? { regenerate: ['RENDER'] }
                      : {}),
                },
              })
            }
            disabled={busy || !scriptDone}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-colors disabled:opacity-40 ${
              renderDone
                ? 'border border-brand-300 text-brand-700 hover:bg-brand-50'
                : 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm'
            }`}
          >
            {renderDone ? <RefreshCw className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {renderDone ? 'Re-render' : 'Render final video'}
          </button>
        )}
      </div>

      {/* Final video */}
      {renderResult?.versionId && (
        <div className="border-t border-gray-100 pt-4">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Final video</p>
          <MediaPlayer versionId={renderResult.versionId} kind="video" />
          {(renderResult.preset ?? renderResult.durationSecs) && (
            <p className="text-[11px] text-gray-500 mt-1">
              {renderResult.preset}{renderResult.durationSecs ? ` · ${Math.round(renderResult.durationSecs)}s` : ''}
            </p>
          )}
        </div>
      )}

      {/* Downloads · Upload package */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Downloads · Upload package</p>
        {exportFiles.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {exportFiles.map((f) => (
              <button
                key={f.name}
                onClick={() => void api.media.downloadExport(projectId, f.name).then((res) => downloadBlob(res, f.name))}
                className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-left text-sm text-gray-800 transition-colors"
              >
                {fileIcon(f.name)}
                <span className="flex-1 truncate text-xs">{f.name}</span>
                <span className="text-[11px] text-gray-500 shrink-0">{formatSize(f.sizeBytes)}</span>
                <Download className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">Render the final video to generate the upload-ready package.</p>
        )}
        <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 shrink-0" />
          Publishing to YouTube requires your approval in Approvals.
        </p>
      </div>
    </div>
  );

  // Detail panel icon + title map (mirrors card header look)
  const agentMeta: Record<string, { icon: React.ReactNode; title: string }> = {
    analyse:    { icon: <BarChart2 className="w-5 h-5" />,    title: 'Analyse' },
    suggestion: { icon: <Lightbulb className="w-5 h-5" />,    title: 'Suggestion' },
    script:     { icon: <FileText className="w-5 h-5" />,     title: 'Script' },
    voice:      { icon: <Mic className="w-5 h-5" />,          title: 'Voice over' },
    music:      { icon: <Music className="w-5 h-5" />,        title: 'Music' },
    video:      { icon: <Clapperboard className="w-5 h-5" />, title: 'Video' },
  };

  function detailFor(key: string): React.ReactNode {
    switch (key) {
      case 'analyse':    return analyseDetail;
      case 'suggestion': return suggestionDetail;
      case 'script':     return scriptDetail;
      case 'voice':      return voiceDetail;
      case 'music':      return musicDetail;
      case 'video':      return videoDetail;
      default:           return null;
    }
  }

  return (
    <div className="mb-6">
      {/* Content Pipeline header (design ref: 1.png) */}
      <div className="flex items-center gap-4 flex-wrap mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Content Pipeline</h2>
          <p className="text-xs text-gray-500">Create content step-by-step with AI</p>
        </div>
      </div>

      {/* Channel strip (image.png: channel first) */}
      <div className="bg-[#e6dcf8] rounded-3xl px-6 py-4 mb-4 flex items-center gap-4 flex-wrap shadow-sm">
        <div className="w-11 h-11 rounded-2xl bg-white shadow-sm flex items-center justify-center shrink-0">
          <Youtube className="w-5 h-5 text-red-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500">Producing for channel</p>
          <p className="font-bold text-gray-900 truncate">{channel.title}</p>
        </div>
        {channels.length > 1 && (
          <select
            value={channels.find((c) => c.youtubeChannelId === channel.youtubeChannelId)?.id ?? ''}
            onChange={(e) => switchChannel.mutate(e.target.value)}
            disabled={switchChannel.isPending || busy}
            aria-label="Switch channel"
            className="border border-white bg-white/70 rounded-full px-3 py-1.5 text-xs text-gray-700"
          >
            {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2 mb-3">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* 1 · Analyse */}
        <div>
          <Tile
            icon={<BarChart2 className="w-5 h-5" />}
            title="Analyse"
            subtitle="Trends, audience & channel intelligence"
            status={analyseDone ? 'done' : 'ready'}
            running={isRunning(jobs, 'TREND_ANALYSIS')}
            failed={latestFailure(jobs, 'TREND_ANALYSIS')}
            updatedAt={completedAt(jobs, 'TREND_ANALYSIS')}
            selected={expanded === 'analyse'}
            hasDetail={true}
            onToggle={() => toggle('analyse')}
            action={<RunButton label={analyseDone ? 'Re-run' : 'Run'} rerun={analyseDone} disabled={busy} onClick={() => enqueue.mutate({ type: 'TREND_ANALYSIS' })} />}
          />
          {isMobile && expanded === 'analyse' && (
            <div key="analyse" className="md:hidden fade-in mt-3 bg-white rounded-2xl p-4 shadow-inner">{detailFor('analyse')}</div>
          )}
        </div>

        {/* 2 · Suggestion */}
        <div>
          <Tile
            icon={<Lightbulb className="w-5 h-5" />}
            title="Suggestion"
            subtitle={effectiveTopic ? `Topic: ${effectiveTopic.slice(0, 40)}${effectiveTopic.length > 40 ? '…' : ''}` : 'Pick or write your video topic'}
            status={effectiveTopic ? 'done' : analyseDone ? 'ready' : 'locked'}
            selected={expanded === 'suggestion'}
            hasDetail={true}
            onToggle={() => toggle('suggestion')}
          />
          {isMobile && expanded === 'suggestion' && (
            <div key="suggestion" className="md:hidden fade-in mt-3 bg-white rounded-2xl p-4 shadow-inner">{detailFor('suggestion')}</div>
          )}
        </div>

        {/* 3 · Script */}
        <div>
          <Tile
            icon={<FileText className="w-5 h-5" />}
            title="Script"
            subtitle={script ? `"${script.title.slice(0, 40)}…"` : effectiveTopic ? `Topic: ${effectiveTopic.slice(0, 40)}${effectiveTopic.length > 40 ? '…' : ''}` : 'Research the topic and write the script'}
            status={scriptDone ? 'done' : effectiveTopic ? 'ready' : 'locked'}
            running={runningFoundation}
            failed={latestFailure(jobs, 'RESEARCH', 'SCRIPT', 'FACT_CHECK', 'COMPLIANCE', 'FULL_PRODUCTION')}
            updatedAt={completedAt(jobs, 'SCRIPT')}
            selected={expanded === 'script'}
            hasDetail={true}
            onToggle={() => toggle('script')}
            action={
              <RunButton
                label={scriptDone ? 'Re-run' : 'Run'}
                rerun={scriptDone}
                disabled={busy || !effectiveTopic}
                onClick={() => enqueue.mutate({
                  type: 'FULL_PRODUCTION',
                  payload: { scope: 'SCRIPT', topic: effectiveTopic, platform, ...(scriptDone ? { regenerate: ['RESEARCH', 'SCRIPT', 'FACT_CHECK', 'COMPLIANCE'] } : {}) },
                })}
              />
            }
          />
          {isMobile && expanded === 'script' && (
            <div key="script" className="md:hidden fade-in mt-3 bg-white rounded-2xl p-4 shadow-inner">{detailFor('script')}</div>
          )}
        </div>

        {/* 4 · Voice over */}
        <div>
          <Tile
            icon={<Mic className="w-5 h-5" />}
            title="Voice over"
            subtitle={voiceResult ? `${voiceResult.provider} · ${Math.round((voiceResult.durationMs ?? 0) / 1000)}s` : 'Narrate the script'}
            status={voiceResult ? 'done' : scriptDone ? 'ready' : 'locked'}
            running={isRunning(jobs, 'VOICE_SPEC', 'VOICE_GENERATE')}
            failed={latestFailure(jobs, 'VOICE_SPEC', 'VOICE_GENERATE')}
            updatedAt={completedAt(jobs, 'VOICE_GENERATE')}
            selected={expanded === 'voice'}
            hasDetail={true}
            onToggle={() => toggle('voice')}
            action={
              <RunButton
                label={voiceResult ? 'Regenerate' : 'Run'}
                rerun={!!voiceResult}
                disabled={busy || !scriptDone}
                onClick={() => enqueue.mutate({
                  type: 'FULL_PRODUCTION',
                  payload: { scope: 'VOICE', ...(voiceResult ? { regenerate: ['VOICE_SPEC', 'VOICE_GENERATE'] } : {}) },
                })}
              />
            }
          />
          {isMobile && expanded === 'voice' && (
            <div key="voice" className="md:hidden fade-in mt-3 bg-white rounded-2xl p-4 shadow-inner">{detailFor('voice')}</div>
          )}
        </div>

        {/* 5 · Music */}
        <div>
          <Tile
            icon={<Music className="w-5 h-5" />}
            title="Music"
            subtitle={musicResult ? `${musicResult.provider} · ${Math.round((musicResult.durationMs ?? 0) / 1000)}s` : 'Background music for the video'}
            status={musicResult ? 'done' : scriptDone ? 'ready' : 'locked'}
            running={isRunning(jobs, 'MUSIC_BRIEF', 'MUSIC_GENERATE')}
            failed={latestFailure(jobs, 'MUSIC_BRIEF', 'MUSIC_GENERATE')}
            updatedAt={completedAt(jobs, 'MUSIC_GENERATE')}
            selected={expanded === 'music'}
            hasDetail={true}
            onToggle={() => toggle('music')}
            action={
              <RunButton
                label={musicResult ? 'Regenerate' : 'Run'}
                rerun={!!musicResult}
                disabled={busy || !scriptDone}
                onClick={() => enqueue.mutate({
                  type: 'FULL_PRODUCTION',
                  payload: {
                    scope: 'MUSIC',
                    ...(mood.trim() ? { mood: mood.trim() } : {}),
                    ...(genre.trim() ? { genre: genre.trim() } : {}),
                    ...(musicResult ? { regenerate: ['MUSIC_BRIEF', 'MUSIC_GENERATE'] } : {}),
                  },
                })}
              />
            }
          />
          {isMobile && expanded === 'music' && (
            <div key="music" className="md:hidden fade-in mt-3 bg-white rounded-2xl p-4 shadow-inner">{detailFor('music')}</div>
          )}
        </div>

        {/* 6 · Video */}
        <div>
          <Tile
            icon={<Clapperboard className="w-5 h-5" />}
            title="Video"
            subtitle={videoResult?.videos?.length ? `${videoResult.videos.length} scene(s) · scenes, rendering & final delivery` : 'Scenes, rendering & final delivery'}
            status={videoResult ? 'done' : scriptDone ? 'ready' : 'locked'}
            running={isRunning(jobs, 'VIDEO_SCENE_PLAN', 'IMAGE_BRIEF', 'IMAGE_GENERATE', 'VIDEO_GENERATE', 'SUBTITLE_GENERATE', 'THUMBNAIL')}
            failed={latestFailure(jobs, 'VIDEO_SCENE_PLAN', 'IMAGE_BRIEF', 'IMAGE_GENERATE', 'VIDEO_GENERATE', 'SUBTITLE_GENERATE', 'THUMBNAIL')}
            updatedAt={completedAt(jobs, 'VIDEO_GENERATE')}
            selected={expanded === 'video'}
            hasDetail={true}
            onToggle={() => toggle('video')}
            action={
              <RunButton
                label={videoResult ? 'Regenerate' : 'Run'}
                rerun={!!videoResult}
                disabled={busy || !scriptDone}
                onClick={() => enqueue.mutate({
                  type: 'FULL_PRODUCTION',
                  payload: { scope: 'VIDEO', ...(videoResult ? { regenerate: ['VIDEO_SCENE_PLAN', 'IMAGE_BRIEF', 'IMAGE_GENERATE', 'VIDEO_GENERATE', 'SUBTITLE_GENERATE', 'THUMBNAIL'] } : {}) },
                })}
              />
            }
          />
          {isMobile && expanded === 'video' && (
            <div key="video" className="md:hidden fade-in mt-3 bg-white rounded-2xl p-4 shadow-inner">{detailFor('video')}</div>
          )}
        </div>
      </div>

      {/* Agent detail panel — desktop/tablet only (mobile renders inline below the card) */}
      {!isMobile && expanded && agentMeta[expanded] && (
        <div key={expanded} className="hidden md:block fade-in mt-4 bg-[#efe8fb] rounded-3xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-xl bg-white shadow-sm flex items-center justify-center text-brand-600 shrink-0">
              {agentMeta[expanded].icon}
            </div>
            <p className="font-semibold text-gray-900">{agentMeta[expanded].title}</p>
            <button
              onClick={() => setExpanded(null)}
              aria-label="Close details"
              className="ml-auto text-gray-500 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-inner">{detailFor(expanded)}</div>
        </div>
      )}

      <p className="text-xs text-gray-500 text-center mt-4">
        Complete each step in order for the best results.
      </p>
    </div>
  );
}
