'use client';
import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useProjectJobEvents } from '@/hooks/use-job-events';
import {
  Loader2, Play, CheckCircle, XCircle, Clock, AlertCircle,
  ChevronDown, ChevronUp, ArrowLeft,
  Check, Copy, Download,
  RotateCcw, ArrowRightLeft, Timer,
} from 'lucide-react';
import { ElapsedBadge, formatDuration } from '@/components/ai-activity';
import { StudioFlow, type PipelineProgress } from '@/components/studio-flow';

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface ProjectDetail {
  id: string;
  title: string;
  niche?: string;
  status: string;
  channel: { title: string; youtubeChannelId: string };
  jobs: Job[];
}

type ContentType = 'VIDEO' | 'MUSIC' | 'SHORT';

// ─── Status styling ───────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  COMPLETED:         'bg-green-100 text-green-700',
  FAILED:            'bg-red-100 text-red-700',
  RUNNING:           'bg-blue-100 text-blue-700',
  WAITING_APPROVAL:  'bg-orange-100 text-orange-700',
  QUEUED:            'bg-gray-100 text-gray-600',
  PENDING:           'bg-gray-100 text-gray-500',
  CANCELLED:         'bg-gray-100 text-gray-400',
  RETRYING:          'bg-yellow-100 text-yellow-700',
  RATE_LIMITED:      'bg-amber-100 text-amber-700',
  PROVIDER_SWITCHING:'bg-indigo-100 text-indigo-700',
};

const STATUS_LABEL: Record<string, string> = {
  COMPLETED:         'Completed',
  FAILED:            'Failed',
  RUNNING:           'Running',
  WAITING_APPROVAL:  'Awaiting Review',
  QUEUED:            'Queued',
  PENDING:           'Pending',
  CANCELLED:         'Cancelled',
  RETRYING:          'Retrying…',
  RATE_LIMITED:      'Rate Limited',
  PROVIDER_SWITCHING:'Provider Switching',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  COMPLETED:         <CheckCircle className="w-3.5 h-3.5" />,
  FAILED:            <XCircle className="w-3.5 h-3.5" />,
  RUNNING:           <Loader2 className="w-3.5 h-3.5 animate-spin" />,
  WAITING_APPROVAL:  <AlertCircle className="w-3.5 h-3.5" />,
  QUEUED:            <Clock className="w-3.5 h-3.5" />,
  PENDING:           <Clock className="w-3.5 h-3.5" />,
  RETRYING:          <RotateCcw className="w-3.5 h-3.5 animate-spin" />,
  RATE_LIMITED:      <Timer className="w-3.5 h-3.5" />,
  PROVIDER_SWITCHING:<ArrowRightLeft className="w-3.5 h-3.5" />,
};

// ─── Script Viewer ────────────────────────────────────────────────────────────

function ScriptViewer({ r }: { r: Record<string, unknown> }) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]));
  const [copied, setCopied] = useState(false);

  const title = String(r['title'] ?? '');
  const hook = String(r['hook'] ?? '');
  const cta = String(r['callToAction'] ?? '');
  const wordCount = r['totalWordCount'] as number | undefined;
  const durationMins = r['estimatedDurationMins'] as number | undefined;
  const sections = (r['sections'] as Array<{ heading: string; content: string; durationEstimateSecs?: number }>) ?? [];
  const sources = (r['sources'] as string[]) ?? [];

  const plainText = [
    title,
    hook ? `HOOK\n${hook}` : '',
    ...sections.map((s) => `${s.heading.toUpperCase()}\n${s.content}`),
    cta ? `CALL TO ACTION\n${cta}` : '',
    sources.length ? `SOURCES\n${sources.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const mdText = [
    title ? `# ${title}` : '',
    hook ? `\n## Hook\n\n${hook}` : '',
    ...sections.map((s) => `\n## ${s.heading}\n\n${s.content}`),
    cta ? `\n## Call to Action\n\n${cta}` : '',
    sources.length ? `\n## Sources\n\n${sources.map((s) => `- ${s}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  function toggleSection(idx: number) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  function handleCopy() {
    void navigator.clipboard.writeText(plainText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload(fmt: 'txt' | 'md') {
    const content = fmt === 'md' ? mdText : plainText;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(title || 'script').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {/* Header: meta + actions */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {title && <p className="font-semibold text-gray-900 text-sm">{title}</p>}
          <p className="text-xs text-gray-400 mt-0.5">
            {wordCount ? `${wordCount} words` : ''}
            {sections.length ? ` · ${sections.length} sections` : ''}
            {durationMins ? ` · ~${durationMins} min` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button
            onClick={() => handleDownload('txt')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-3 h-3" /> .txt
          </button>
          <button
            onClick={() => handleDownload('md')}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-3 h-3" /> .md
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="max-h-[30rem] overflow-y-auto space-y-2 pr-1">
        {hook && (
          <div className="bg-brand-50 border border-brand-100 rounded-lg px-4 py-3">
            <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide mb-1">Hook</p>
            <p className="text-sm text-gray-700 leading-relaxed italic">&ldquo;{hook}&rdquo;</p>
          </div>
        )}

        {sections.map((section, idx) => (
          <div key={idx} className="border border-gray-200 rounded-lg overflow-hidden bg-white">
            <button
              onClick={() => toggleSection(idx)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 text-left transition-colors"
            >
              <span className="text-sm font-medium text-gray-800">{section.heading}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {section.durationEstimateSecs != null && (
                  <span className="text-xs text-gray-400">{Math.round(section.durationEstimateSecs / 60)}m</span>
                )}
                {expandedSections.has(idx)
                  ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                  : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </div>
            </button>
            {expandedSections.has(idx) && (
              <div className="px-4 py-3 border-t border-gray-100">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{section.content}</p>
              </div>
            )}
          </div>
        ))}

        {cta && (
          <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3">
            <p className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-1">Call to Action</p>
            <p className="text-sm text-gray-700 leading-relaxed">{cta}</p>
          </div>
        )}

        {sources.length > 0 && (
          <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sources</p>
            <ul className="space-y-1">
              {sources.map((src, i) => (
                <li key={i} className="text-xs text-gray-500 break-all">· {src}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Result renderers ─────────────────────────────────────────────────────────

function ResultPreview({ job }: { job: Job }) {
  if (!job.result) return null;
  const r = job.result as Record<string, unknown>;

  try {
    switch (job.type) {
      case 'TREND_ANALYSIS': {
        const trends = (r['trending'] as Array<{ topic: string; score: number; relatedKeywords?: string[] }>) ?? [];
        const recs = (r['recommendations'] as string[]) ?? [];
        return (
          <div className="space-y-2">
            {trends.slice(0, 3).map((t, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-700 flex-1">{t.topic}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${t.score >= 80 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {t.score}
                </span>
              </div>
            ))}
            {recs.slice(0, 1).map((rec, i) => (
              <p key={i} className="text-xs text-brand-700 bg-brand-50 rounded px-2 py-1.5 mt-2">💡 {rec}</p>
            ))}
          </div>
        );
      }

      case 'AUDIENCE_ANALYSIS': {
        const demographic = String(r['primaryDemographic'] ?? r['summary'] ?? '');
        const interests = (r['interests'] as string[]) ?? (r['topInterests'] as string[]) ?? [];
        const engagement = String(r['bestUploadTime'] ?? r['peakEngagement'] ?? '');
        return (
          <div className="space-y-2">
            {demographic && <p className="text-sm text-gray-700 font-medium">{demographic}</p>}
            <div className="flex flex-wrap gap-1">
              {interests.slice(0, 5).map((interest, i) => (
                <span key={i} className="px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded-full">{interest}</span>
              ))}
            </div>
            {engagement && <p className="text-xs text-gray-500">Best upload time: {engagement}</p>}
          </div>
        );
      }

      case 'RESEARCH': {
        const topic = String(r['topic'] ?? '');
        const summary = String(r['summary'] ?? '');
        const keyPoints = (r['keyPoints'] as string[]) ?? [];
        return (
          <div className="space-y-2">
            {topic && <p className="font-semibold text-sm text-gray-800">{topic}</p>}
            {summary && <p className="text-sm text-gray-600 leading-relaxed">{summary.slice(0, 240)}{summary.length > 240 ? '…' : ''}</p>}
            {keyPoints.slice(0, 3).map((pt, i) => (
              <div key={i} className="flex gap-2 text-xs text-gray-600">
                <span className="text-brand-500 font-bold mt-0.5 flex-shrink-0">•</span>
                <span>{pt}</span>
              </div>
            ))}
          </div>
        );
      }

      case 'SCRIPT': {
        return <ScriptViewer r={r} />;
      }

      case 'FACT_CHECK': {
        const overallVerdict = String(r['overallVerdict'] ?? r['overallVerified'] ?? '');
        const accuracyScore = (r['accuracyScore'] as number | undefined) ?? (r['overallVerified'] ? 100 : 0);
        const isPositive = accuracyScore >= 70 || String(r['overallVerified']) === 'true';
        const claims = (r['claims'] as Array<{ claim: string; status?: string; verdict?: string; confidence: number }>) ?? [];
        const recommendations = Array.isArray(r['recommendations']) ? (r['recommendations'] as string[]) : r['recommendation'] ? [String(r['recommendation'])] : [];
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isPositive
                ? <CheckCircle className="w-4 h-4 text-green-600" />
                : <AlertCircle className="w-4 h-4 text-amber-500" />}
              <span className={`text-sm font-medium ${isPositive ? 'text-green-700' : 'text-amber-700'}`}>
                {overallVerdict || (isPositive ? 'All claims verified' : 'Some claims need review')}
              </span>
              {accuracyScore > 0 && <span className="text-xs text-gray-500 ml-auto">{accuracyScore}% accurate</span>}
            </div>
            {claims.slice(0, 3).map((c, i) => {
              const statusStr = String(c.status ?? c.verdict ?? '');
              const ok = statusStr.toLowerCase().includes('verif') || statusStr === 'true';
              return (
                <div key={i} className="flex gap-2 items-start text-xs">
                  <span className={ok ? 'text-green-500' : 'text-red-500'}>{ok ? '✓' : '✗'}</span>
                  <span className="text-gray-600">{c.claim}</span>
                </div>
              );
            })}
            {recommendations[0] && <p className="text-xs text-gray-500 italic">{recommendations[0]}</p>}
          </div>
        );
      }

      case 'COMPLIANCE': {
        const passed = r['passed'] as boolean;
        const score = r['score'] as number;
        const flags = (r['flags'] as Array<{ category: string; severity: string; description: string }>) ?? [];
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {passed
                ? <CheckCircle className="w-4 h-4 text-green-600" />
                : <XCircle className="w-4 h-4 text-red-600" />}
              <span className={`text-sm font-semibold ${passed ? 'text-green-700' : 'text-red-700'}`}>
                {passed ? 'Compliance Passed' : 'Compliance Failed'} — Score: {score}/100
              </span>
            </div>
            {flags.map((f, i) => (
              <div key={i} className={`text-xs px-2 py-1.5 rounded flex gap-2 ${f.severity === 'BLOCK' ? 'bg-red-50 text-red-700' : 'bg-yellow-50 text-yellow-700'}`}>
                <span className="font-semibold flex-shrink-0">{f.category}:</span>
                <span>{f.description}</span>
              </div>
            ))}
          </div>
        );
      }

      case 'METADATA': {
        const title = String(r['title'] ?? '');
        const tags = (r['tags'] as string[]) ?? [];
        const desc = String(r['description'] ?? '');
        return (
          <div className="space-y-2">
            {title && <p className="font-semibold text-sm text-gray-800">{title}</p>}
            {desc && <p className="text-xs text-gray-500 leading-relaxed">{desc.slice(0, 160)}…</p>}
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 6).map((tag, i) => (
                <span key={i} className="px-2 py-0.5 bg-brand-50 text-brand-700 text-xs rounded-full">#{tag}</span>
              ))}
            </div>
          </div>
        );
      }

      case 'SEO_OPTIMIZATION': {
        const primary = (r['primaryKeywords'] as string[]) ?? [];
        const secondary = (r['secondaryKeywords'] as string[]) ?? [];
        const volume = r['estimatedMonthlySearches'] ?? r['searchVolume'];
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {primary.slice(0, 4).map((kw, i) => (
                <span key={i} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-full font-medium">{kw}</span>
              ))}
              {secondary.slice(0, 4).map((kw, i) => (
                <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">{kw}</span>
              ))}
            </div>
            {volume != null && (
              <p className="text-xs text-gray-500">Est. monthly searches: {String(volume)}</p>
            )}
          </div>
        );
      }

      case 'THUMBNAIL': {
        const concept = String(r['concept'] ?? r['description'] ?? '');
        const textOverlay = String(r['suggestedTextOverlay'] ?? r['textOverlay'] ?? '');
        const colorScheme = String(r['colorScheme'] ?? '');
        const visualElements = Array.isArray(r['visualElements']) ? (r['visualElements'] as string[]) : [];
        const aspectRatio = String(r['aspectRatio'] ?? '');
        const note = String(r['note'] ?? '');
        return (
          <div className="space-y-3">
            {/* Mock thumbnail card */}
            <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-900 aspect-video flex items-center justify-center relative">
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                {textOverlay && (
                  <p className="text-white font-black text-lg leading-tight drop-shadow-lg"
                     style={{ textShadow: '2px 2px 8px rgba(0,0,0,0.8)' }}>
                    {textOverlay}
                  </p>
                )}
              </div>
              <span className="absolute bottom-2 right-2 text-xs text-gray-400 font-mono">{aspectRatio || '16:9'}</span>
            </div>

            {/* Brief details */}
            <div className="space-y-2">
              {concept && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Concept</p>
                  <p className="text-sm text-gray-700 leading-relaxed">{concept}</p>
                </div>
              )}
              {colorScheme && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">Color Scheme</p>
                  <p className="text-xs text-gray-600">{colorScheme}</p>
                </div>
              )}
              {visualElements.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Visual Elements</p>
                  <ul className="space-y-0.5">
                    {visualElements.map((el, i) => (
                      <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                        <span className="text-brand-400 flex-shrink-0">·</span>{el}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {note && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">{note}</p>
              )}
            </div>
          </div>
        );
      }

      default:
        return (
          <pre className="text-xs text-gray-600 whitespace-pre-wrap overflow-auto max-h-48">
            {JSON.stringify(r, null, 2)}
          </pre>
        );
    }
  } catch {
    return <p className="text-xs text-gray-400">Result preview unavailable</p>;
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Live transient status per jobId (RETRYING, RATE_LIMITED, etc.)
  const [liveStatus, setLiveStatus] = useState<Record<string, { status: string; detail?: string }>>({});
  // Per-job activity log: messages streamed in real-time via WebSocket
  const [jobLogs, setJobLogs] = useState<Record<string, Array<{ msg: string; detail?: string }>>>({});
  // FULL_PRODUCTION pipeline progress (stage n/m + ETA) streamed via job events
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);

  const handleJobEvent = useCallback((event: Record<string, unknown>) => {
    if (event['pipelineStage'] !== undefined) {
      setPipelineProgress({
        stage: String(event['pipelineStage']),
        index: Number(event['pipelineIndex'] ?? 0),
        count: Number(event['pipelineCount'] ?? 0),
        etaSecs: Number(event['etaSecs'] ?? 0),
      });
    }
    const jobId = String(event['jobId'] ?? '');
    const status = String(event['status'] ?? '');
    if (!jobId || !status) return;
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) {
      setLiveStatus((prev) => { const next = { ...prev }; delete next[jobId]; return next; });
    } else if (['RETRYING', 'RATE_LIMITED', 'PROVIDER_SWITCHING', 'QUEUED'].includes(status)) {
      let detail = '';
      if (status === 'RETRYING') detail = `Attempt ${event['attempt'] as number}/${event['maxAttempts'] as number} via ${event['provider'] as string}`;
      if (status === 'RATE_LIMITED') detail = String(event['reason'] ?? '');
      if (status === 'PROVIDER_SWITCHING') detail = `${event['from'] as string} → ${event['to'] as string}`;
      setLiveStatus((prev) => ({ ...prev, [jobId]: { status, detail } }));
    }
  }, []);

  const handleLogEvent = useCallback((e: { jobId: string; message: string; detail?: string }) => {
    setJobLogs((prev) => ({
      ...prev,
      [e.jobId]: [...(prev[e.jobId] ?? []), { msg: e.message, detail: e.detail }],
    }));
  }, []);

  useProjectJobEvents(id, handleJobEvent, handleLogEvent);

  const contentType: ContentType =
    typeof window !== 'undefined'
      ? ((localStorage.getItem(`cf_ct_${id}`) as ContentType | null) ?? 'VIDEO')
      : 'VIDEO';

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id).then((r) => r.data as ProjectDetail),
    refetchInterval: 10_000,
  });

  function toggle(key: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>;
  }
  if (!project) return null;

  const CT_META: Record<ContentType, { label: string; color: string }> = {
    VIDEO: { label: 'YouTube Video', color: 'bg-red-100 text-red-700' },
    MUSIC: { label: 'Music / Audio', color: 'bg-purple-100 text-purple-700' },
    SHORT: { label: 'YouTube Short', color: 'bg-blue-100 text-blue-700' },
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> All Projects
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{project.title}</h1>
            <p className="text-gray-500 mt-1">{project.channel.title}{project.niche ? ` · ${project.niche}` : ''}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${CT_META[contentType].color}`}>
              {CT_META[contentType].label}
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${project.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              {project.status}
            </span>
          </div>
        </div>
      </div>

      {/* Guided step-by-step studio flow (design ref: image.png / project.PNG) */}
      <StudioFlow
        projectId={id}
        channel={project.channel}
        jobs={project.jobs}
        anyPipelineRunning={project.jobs.some((j) => j.type === 'FULL_PRODUCTION' && ['RUNNING', 'QUEUED', 'PENDING'].includes(j.status))}
        progress={pipelineProgress}
        runningPipeline={
          project.jobs
            .filter((j) => j.type === 'FULL_PRODUCTION' && ['RUNNING', 'QUEUED', 'PENDING'].includes(j.status))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null
        }
      />

      {/* Full Job History */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Jobs</h2>
          <p className="text-xs text-gray-400 mt-0.5">All AI agent runs for this project</p>
        </div>
        {project.jobs.length === 0 ? (
          <div className="text-center py-14 text-gray-400">
            <Play className="w-8 h-8 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No jobs yet — run an agent above to start creating content.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {project.jobs.map((job) => {
              const histKey = `hist-${job.id}`;
              const isExpanded = expandedIds.has(histKey);
              // Live transient status
              const live = job.status === 'RUNNING' ? liveStatus[job.id] : undefined;
              const displayStatus = live?.status ?? job.status;
              // Activity logs for this job
              const logs = jobLogs[job.id];
              const hasLogs = logs && logs.length > 0;
              const logKey = `log-${job.id}`;
              const isJobRunning = job.status === 'RUNNING';
              const logOpen = isJobRunning || expandedIds.has(logKey);

              return (
                <div key={job.id} className="px-6 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">
                        {job.type}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(job.createdAt).toLocaleString()}
                        {job.completedAt && ` · took ${formatDuration(new Date(job.completedAt).getTime() - new Date(job.startedAt ?? job.createdAt).getTime())}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {job.status === 'RUNNING' && (
                        <ElapsedBadge since={job.startedAt ?? job.createdAt} />
                      )}
                      {/* Transient live status badge */}
                      {live && (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[displayStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_ICON[displayStatus]}
                            {STATUS_LABEL[displayStatus] ?? displayStatus}
                          </span>
                          {live.detail && (
                            <span className="text-xs text-gray-400">{live.detail}</span>
                          )}
                        </div>
                      )}
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[job.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_ICON[job.status]}
                        {job.status}
                      </span>
                      {!!job.result && (
                        <button onClick={() => toggle(histKey)} className="text-gray-400 hover:text-gray-600">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Live activity log — open while RUNNING, collapsible when done */}
                  {hasLogs && (
                    <div className="mt-2">
                      {!isJobRunning && (
                        <button
                          onClick={() => toggle(logKey)}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-1.5"
                        >
                          {logOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          Activity log ({logs.length} steps)
                        </button>
                      )}
                      {logOpen && (
                        <div className="bg-gray-950 rounded-lg px-3.5 py-2.5 font-mono space-y-1 overflow-y-auto max-h-48">
                          {isJobRunning && (
                            <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin text-green-500" />
                              <span className="text-green-500 font-medium">Agent running</span>
                              <ElapsedBadge since={job.startedAt ?? job.createdAt} className="!text-gray-500" />
                            </p>
                          )}
                          {logs.map((entry, i) => {
                            const isLast = i === logs.length - 1;
                            return (
                              <div key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                                <span className={`flex-shrink-0 mt-0.5 ${isLast && isJobRunning ? 'text-green-400' : 'text-gray-600'}`}>
                                  {isLast && isJobRunning ? '▶' : '·'}
                                </span>
                                <span className={isLast && isJobRunning ? 'text-green-300' : 'text-gray-300'}>
                                  {entry.msg}
                                  {entry.detail && (
                                    <span className="text-gray-500 ml-2">— {entry.detail}</span>
                                  )}
                                </span>
                                {isLast && isJobRunning && (
                                  <span className="text-green-500 animate-pulse ml-0.5 flex-shrink-0">●</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {isExpanded && !!job.result && (
                    <div className="mt-3 bg-gray-50 border border-gray-100 rounded-xl p-4">
                      <ResultPreview job={job} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
