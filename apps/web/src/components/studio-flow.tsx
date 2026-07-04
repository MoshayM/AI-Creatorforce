'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Youtube, BarChart2, Lightbulb, FileText, Mic, Music, Clapperboard,
  Play, RefreshCw, Loader2, CheckCircle, ChevronDown, ChevronUp, Save, Pencil, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { ElapsedBadge } from '@/components/ai-activity';
import { getErrorMessage } from '@/lib/getErrorMessage';

/**
 * Guided in-project production flow (design refs: image.png layout —
 * channel → Analyse / Suggestion / Script / Voice over / Music / Video —
 * with project.PNG's soft lavender clay tiles). Every tile wraps the
 * compliance-gated pipeline with resume, and every stage result is editable:
 * edits persist via the stage-override endpoint so downstream stages use
 * the edited version.
 */

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
}

const RUNNING_STATES = ['PENDING', 'QUEUED', 'RUNNING'];

// Target distribution platform — shapes research/script tone and format
const PLATFORMS = ['YouTube', 'Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'Podcast', 'Custom'] as const;

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
    <span className="flex items-center gap-1 text-[11px] font-medium text-gray-400">
      <span className="w-2 h-2 rounded-full bg-gray-300" /> Not started
    </span>
  );
}

// ── Small blob-backed media player (auth header needed, so no direct <audio src>) ──

function MediaPlayer({ versionId, kind }: { versionId: string; kind: 'audio' | 'video' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.media.versionFile(versionId);
      setUrl(URL.createObjectURL(res.data as Blob));
    } finally {
      setLoading(false);
    }
  }

  if (!url) {
    return (
      <button
        onClick={() => void load()}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-medium text-brand-700 border border-brand-200 rounded-full px-3 py-1.5 hover:bg-brand-50 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
        {loading ? 'Loading…' : kind === 'audio' ? 'Play audio' : 'Play video'}
      </button>
    );
  }
  return kind === 'audio'
    ? <audio controls src={url} className="w-full h-9" />
    : <video controls src={url} className="w-full rounded-xl max-h-56 bg-black" />;
}

// ── Tile shell ────────────────────────────────────────────────────────────────

function Tile({
  icon, title, subtitle, status, running, failed, updatedAt, expanded, onToggle, children, action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  status: 'done' | 'ready' | 'locked';
  running?: Job;
  failed?: Job;
  updatedAt?: string;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const badgeState = running ? 'running' : failed ? 'failed' : status === 'done' ? 'done' : 'notStarted';
  const expandable = !!children && status !== 'locked';
  return (
    <div className={`rounded-3xl p-5 transition-all duration-200 ${
      status === 'locked'
        ? 'bg-[#f3effb] opacity-70'
        : 'bg-[#efe8fb] shadow-sm hover:shadow-lg hover:-translate-y-0.5'
    }`}>
      <div
        className={`flex items-start gap-3 ${expandable ? 'cursor-pointer' : ''}`}
        onClick={expandable ? onToggle : undefined}
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
          <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="text-gray-400 hover:text-gray-600 p-1 shrink-0" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
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
      {expanded && children && <div className="mt-4 bg-white rounded-2xl p-4 shadow-inner">{children}</div>}
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

export function StudioFlow({ projectId, channel, jobs, anyPipelineRunning }: Props) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [topic, setTopic] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(`cf_topic_${projectId}`) ?? '' : '');
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>(() =>
    (typeof window !== 'undefined' ? localStorage.getItem(`cf_platform_${projectId}`) : null) as (typeof PLATFORMS)[number] | null ?? 'YouTube');
  const [customTopic, setCustomTopic] = useState('');
  const [mood, setMood] = useState('');
  const [genre, setGenre] = useState('');
  const [scriptDraft, setScriptDraft] = useState<ScriptResult | null>(null);

  const { data: channels = [] } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Array<{ id: string; title: string; youtubeChannelId: string }>),
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

  function chooseTopic(t: string) {
    setTopic(t);
    localStorage.setItem(`cf_topic_${projectId}`, t);
  }

  function choosePlatform(p: (typeof PLATFORMS)[number]) {
    setPlatform(p);
    localStorage.setItem(`cf_platform_${projectId}`, p);
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

  const runningFoundation = isRunning(jobs, 'RESEARCH', 'SCRIPT', 'FACT_CHECK', 'COMPLIANCE', 'FULL_PRODUCTION');
  const effectiveTopic = topic || customTopic;

  const toggle = (key: string) => setExpanded((e) => (e === key ? null : key));

  return (
    <div className="mb-6">
      {/* Content Pipeline header (design ref: 1.png) */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Content Pipeline</h2>
          <p className="text-xs text-gray-500">Create content step-by-step with AI</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          Platform
          <select
            value={platform}
            onChange={(e) => choosePlatform(e.target.value as (typeof PLATFORMS)[number])}
            className="border border-gray-200 bg-white rounded-full px-3 py-1.5 text-xs font-medium text-gray-700"
            aria-label="Target platform"
          >
            {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
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
        <Tile
          icon={<BarChart2 className="w-5 h-5" />}
          title="Analyse"
          subtitle="Trends, audience & channel intelligence"
          status={analyseDone ? 'done' : 'ready'}
          running={isRunning(jobs, 'TREND_ANALYSIS')}
          failed={latestFailure(jobs, 'TREND_ANALYSIS')}
          updatedAt={completedAt(jobs, 'TREND_ANALYSIS')}
          expanded={expanded === 'analyse'}
          onToggle={() => toggle('analyse')}
          action={<RunButton label={analyseDone ? 'Re-run' : 'Run'} rerun={analyseDone} disabled={busy} onClick={() => enqueue.mutate({ type: 'TREND_ANALYSIS' })} />}
        >
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
            ) : <p className="text-sm text-gray-400">Run the analysis to see trending topics.</p>}

            {/* Channel intelligence rows */}
            <div className="mt-4 border-t border-gray-100 pt-3 space-y-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Channel intelligence</p>

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
          </>
        </Tile>

        {/* 2 · Suggestion */}
        <Tile
          icon={<Lightbulb className="w-5 h-5" />}
          title="Suggestion"
          subtitle={effectiveTopic ? `Topic: ${effectiveTopic.slice(0, 40)}${effectiveTopic.length > 40 ? '…' : ''}` : 'Pick or write your video topic'}
          status={effectiveTopic ? 'done' : analyseDone ? 'ready' : 'locked'}
          expanded={expanded === 'suggestion'}
          onToggle={() => toggle('suggestion')}
        >
          {(() => {
            const growthJob = latest(jobs, 'GROWTH_REPORT');
            const growthTopics = (growthJob?.status === 'COMPLETED'
              ? (growthJob.result as { nextTopics?: Array<{ topic: string }> } | undefined)?.nextTopics
              : undefined) ?? [];
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
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">From growth analysis</p>
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
              </div>
            );
          })()}
        </Tile>

        {/* 3 · Script */}
        <Tile
          icon={<FileText className="w-5 h-5" />}
          title="Script"
          subtitle={script ? `"${script.title.slice(0, 40)}…"` : effectiveTopic ? `Topic: ${effectiveTopic.slice(0, 40)}${effectiveTopic.length > 40 ? '…' : ''}` : 'Research the topic and write the script'}
          status={scriptDone ? 'done' : effectiveTopic ? 'ready' : 'locked'}
          running={runningFoundation}
          failed={latestFailure(jobs, 'RESEARCH', 'SCRIPT', 'FACT_CHECK', 'COMPLIANCE', 'FULL_PRODUCTION')}
          updatedAt={completedAt(jobs, 'SCRIPT')}
          expanded={expanded === 'script'}
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
        >
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Script topic</label>
              <input
                value={effectiveTopic}
                onChange={(e) => chooseTopic(e.target.value)}
                placeholder="Pick a topic in Suggestion or type one here"
                aria-label="Script topic"
                className="mt-1 w-full text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <p className="text-[11px] text-gray-400 mt-1">Selected suggestions appear here automatically — edit freely before running.</p>
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
                  <p className="text-xs text-gray-400">Saved edits flow into voice, subtitles, and video automatically.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400">{script.totalWordCount ?? '?'} words · {script.sections.length} sections</p>
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
            ) : <p className="text-sm text-gray-400">Pick a topic, then run — includes fact-check and the compliance gate.</p>}

          </div>
        </Tile>

        {/* 4 · Voice over */}
        <Tile
          icon={<Mic className="w-5 h-5" />}
          title="Voice over"
          subtitle={voiceResult ? `${voiceResult.provider} · ${Math.round((voiceResult.durationMs ?? 0) / 1000)}s` : 'Narrate the script'}
          status={voiceResult ? 'done' : scriptDone ? 'ready' : 'locked'}
          running={isRunning(jobs, 'VOICE_SPEC', 'VOICE_GENERATE')}
          failed={latestFailure(jobs, 'VOICE_SPEC', 'VOICE_GENERATE')}
          updatedAt={completedAt(jobs, 'VOICE_GENERATE')}
          expanded={expanded === 'voice'}
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
        >
          {voiceResult?.versionId ? (
            <div className="space-y-2">
              <MediaPlayer versionId={voiceResult.versionId} kind="audio" />
              {voiceResult.notes && <p className="text-xs text-amber-600">{voiceResult.notes}</p>}
            </div>
          ) : <p className="text-sm text-gray-400">Run to generate the narration from your (edited) script.</p>}
        </Tile>

        {/* 5 · Music */}
        <Tile
          icon={<Music className="w-5 h-5" />}
          title="Music"
          subtitle={musicResult ? `${musicResult.provider} · ${Math.round((musicResult.durationMs ?? 0) / 1000)}s` : 'Background music for the video'}
          status={musicResult ? 'done' : scriptDone ? 'ready' : 'locked'}
          running={isRunning(jobs, 'MUSIC_BRIEF', 'MUSIC_GENERATE')}
          failed={latestFailure(jobs, 'MUSIC_BRIEF', 'MUSIC_GENERATE')}
          updatedAt={completedAt(jobs, 'MUSIC_GENERATE')}
          expanded={expanded === 'music'}
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
        >
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
                <MediaPlayer versionId={musicResult.versionId} kind="audio" />
                {musicResult.notes && <p className="text-xs text-amber-600">{musicResult.notes}</p>}
              </div>
            ) : <p className="text-xs text-gray-400">Set a mood/genre (or leave blank for AI&rsquo;s pick) and run.</p>}
          </div>
        </Tile>

        {/* 6 · Video */}
        <Tile
          icon={<Clapperboard className="w-5 h-5" />}
          title="Video"
          subtitle={videoResult?.videos?.length ? `${videoResult.videos.length} scene(s) ready` : 'Storyboard, scenes, subtitles & thumbnail'}
          status={videoResult ? 'done' : scriptDone ? 'ready' : 'locked'}
          running={isRunning(jobs, 'VIDEO_SCENE_PLAN', 'IMAGE_BRIEF', 'IMAGE_GENERATE', 'VIDEO_GENERATE', 'SUBTITLE_GENERATE', 'THUMBNAIL')}
          failed={latestFailure(jobs, 'VIDEO_SCENE_PLAN', 'IMAGE_BRIEF', 'IMAGE_GENERATE', 'VIDEO_GENERATE', 'SUBTITLE_GENERATE', 'THUMBNAIL')}
          updatedAt={completedAt(jobs, 'VIDEO_GENERATE')}
          expanded={expanded === 'video'}
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
        >
          {videoResult?.videos?.length ? (
            <div className="space-y-2">
              {videoResult.videos.map((v, i) => (
                <div key={v.sceneId} className="flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-600 truncate">Scene {i + 1} · {v.provider}</p>
                  {v.versionId && <MediaPlayer versionId={v.versionId} kind="video" />}
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-1">Use the studio card above for the final render + upload-ready package.</p>
            </div>
          ) : <p className="text-sm text-gray-400">Run to storyboard the script and generate every scene.</p>}
        </Tile>
      </div>

      <p className="text-xs text-gray-400 text-center mt-4">
        💡 Complete each step in order for the best results.
      </p>
    </div>
  );
}
