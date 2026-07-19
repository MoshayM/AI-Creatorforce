'use client';
import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, apiClient } from '@/lib/api';
import { useProjectJobEvents } from '@/hooks/use-job-events';
import {
  Loader2, Play, CheckCircle, XCircle, Clock, AlertCircle,
  ChevronDown, ChevronUp, ArrowLeft,
  Check, Copy, Download,
  RotateCcw, ArrowRightLeft, Timer, Trash2, Pause,
  FileText, RefreshCw, Film, Search, ShieldCheck, Tag, Image as ImageIcon,
  Youtube, Send, X,
} from 'lucide-react';
import type { ProjectPublishReady } from '@/lib/api';

type PageTab = 'pipeline' | 'script' | 'storyboard' | 'seo' | 'checks';

// ─── Storyboard Types ─────────────────────────────────────────────────────────

interface Scene {
  id?: string;
  sectionRef?: string;
  title: string;
  purpose?: string;
  narration?: string;
  startSecs?: number;
  endSecs?: number;
  durationSecs: number;
  shotType: string;
  imagePrompt?: string;
  videoPrompt: string;
  negativePrompt?: string;
  transition?: string;
  cameraMotion?: string;
  animationType?: string;
  emotion?: string;
  subtitleStyle?: string;
  voiceSettings?: { emotion?: string; pace?: string };
  musicSettings?: { mood?: string; volume?: number; duck?: boolean };
}

interface VideoScenePlan {
  projectId?: string;
  totalDurationSecs: number;
  scenes: Scene[];
  productionNotes?: string;
  providerRecommendation?: string;
  semanticMethod?: string;
  sceneCount?: number;
}
import { ElapsedBadge, formatDuration } from '@/components/ai-activity';

// ─── SEO & Audience Types ─────────────────────────────────────────────────────

interface SeoResult {
  optimizedTitle: string;
  optimizedDescription: string;
  tags: string[];
  searchKeywords: string[];
  seoScore: number;
  improvements: string[];
}

interface AudienceResult {
  primaryDemographic: string;
  interestClusters: Array<{ cluster: string; size: string; engagement: string }>;
  contentPreferences: string[];
  bestPostingTimes: string[];
  growthTips: string[];
}
import { StudioFlow, type PipelineProgress } from '@/components/studio-flow';

// ─── Checks Types ─────────────────────────────────────────────────────────────

interface FactCheckResult {
  overallScore: number;
  claims: Array<{
    claim: string;
    verdict: 'SUPPORTED' | 'DISPUTED' | 'UNVERIFIABLE';
    confidence: number;
    notes?: string;
  }>;
  summary: string;
  sources?: string[];
}

interface ComplianceResult {
  passed: boolean;
  score: number;
  issues: Array<{
    severity: 'BLOCKER' | 'WARNING' | 'INFO';
    category: string;
    description: string;
    suggestion?: string;
  }>;
  summary: string;
  youtubeReady: boolean;
  monetizationSafe: boolean;
}

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
  /** Phase 5 §10: org whose shared wallet pays for this project's AI jobs. */
  billingOrgId?: string | null;
  channel: { title: string; youtubeChannelId: string };
  jobs: Job[];
}

type ContentType = 'VIDEO' | 'MUSIC' | 'SHORT';

/**
 * Phase 5 §10: pick which wallet pays for this project's AI jobs. Hidden when
 * the user belongs to no org. Spend-time gating (SPEND role + budget) happens
 * server-side on every job regardless of this setting.
 */
function BillingOrgPicker({ projectId, billingOrgId }: { projectId: string; billingOrgId: string | null | undefined }) {
  const qc = useQueryClient();
  const { data: orgs = [] } = useQuery({
    queryKey: ['orgs-mine'],
    queryFn: () => api.orgs.mine().then((r) => r.data),
  });
  const save = useMutation({
    mutationFn: (orgId: string) => api.projects.update(projectId, { billingOrgId: orgId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });
  if (orgs.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="project-billing-org" className="text-xs text-gray-500">Bill to</label>
      <select
        id="project-billing-org"
        value={billingOrgId ?? ''}
        onChange={(e) => save.mutate(e.target.value)}
        disabled={save.isPending}
        className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg px-2 py-1"
      >
        <option value="">Personal wallet</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Status styling ───────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  COMPLETED:         'bg-green-100 text-green-700',
  FAILED:            'bg-red-100 text-red-700',
  RUNNING:           'bg-blue-100 text-blue-700',
  WAITING_APPROVAL:  'bg-orange-100 text-orange-700',
  QUEUED:            'bg-gray-100 text-gray-600',
  PENDING:           'bg-gray-100 text-gray-500',
  CANCELLED:         'bg-gray-100 text-gray-500',
  PAUSED:            'bg-yellow-100 text-yellow-700',
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
  PAUSED:            'Paused',
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
  PAUSED:            <Pause className="w-3.5 h-3.5" />,
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
          <p className="text-xs text-gray-500 mt-0.5">
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
                  <span className="text-xs text-gray-500">{Math.round(section.durationEstimateSecs / 60)}m</span>
                )}
                {expandedSections.has(idx)
                  ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" />
                  : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
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
              <span className="absolute bottom-2 right-2 text-xs text-gray-500 font-mono">{aspectRatio || '16:9'}</span>
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
    return <p className="text-xs text-gray-500">Result preview unavailable</p>;
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [activeTab, setActiveTab] = useState<PageTab>('pipeline');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Whole Recent Jobs section collapses to a summary bar (like Approvals history)
  const [jobsOpen, setJobsOpen] = useState(false);
  // Script Writer tab state
  const [scriptTopic, setScriptTopic] = useState('');
  const [scriptTone, setScriptTone] = useState('Informative');
  const [scriptDuration, setScriptDuration] = useState('Medium 8-12min');
  const [scriptAudience, setScriptAudience] = useState('');
  // Live transient status per jobId (RETRYING, RATE_LIMITED, etc.)
  const [liveStatus, setLiveStatus] = useState<Record<string, { status: string; detail?: string }>>({});
  // Per-job activity log: messages streamed in real-time via WebSocket
  const [jobLogs, setJobLogs] = useState<Record<string, Array<{ msg: string; detail?: string }>>>({});
  // FULL_PRODUCTION pipeline progress (stage n/m + ETA) streamed via job events
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);
  const [confirmDeleteJob, setConfirmDeleteJob] = useState<string | null>(null);
  const [confirmCancelJob, setConfirmCancelJob] = useState<string | null>(null);

  // SEO & Audience tab state
  const [seoForm, setSeoForm] = useState({ title: '', description: '', niche: '' });
  const [seoResult, setSeoResult] = useState<SeoResult | null>(null);
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoError, setSeoError] = useState('');
  const [audienceForm, setAudienceForm] = useState({ niche: '' });
  const [audienceResult, setAudienceResult] = useState<AudienceResult | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState('');

  const qc = useQueryClient();
  const deleteJobMutation = useMutation({
    mutationFn: (jobId: string) => api.jobs.remove(jobId),
    onSuccess: () => { setConfirmDeleteJob(null); void qc.invalidateQueries({ queryKey: ['project', id] }); },
  });
  const cancelJobMutation = useMutation({
    mutationFn: (jobId: string) => api.jobs.cancel(jobId),
    onSuccess: () => { setConfirmCancelJob(null); void qc.invalidateQueries({ queryKey: ['project', id] }); },
  });
  const pauseJobMutation = useMutation({
    mutationFn: (jobId: string) => api.jobs.pause(jobId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['project', id] }),
  });
  const resumeJobMutation = useMutation({
    mutationFn: (jobId: string) => api.jobs.resume(jobId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['project', id] }),
  });

  const generateScriptMutation = useMutation({
    mutationFn: () => api.jobs.enqueue(id, 'SCRIPT', {
      topic: scriptTopic || undefined,
      tone: scriptTone,
      duration: scriptDuration,
      audience: scriptAudience || undefined,
    }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['project', id] }),
  });

  const [enqueuePending, setEnqueuePending] = useState(false);
  async function enqueueStoryboard() {
    setEnqueuePending(true);
    try {
      await api.jobs.enqueue(id, 'VIDEO_SCENE_PLAN', {});
      void qc.invalidateQueries({ queryKey: ['project', id] });
    } finally {
      setEnqueuePending(false);
    }
  }

  const [factCheckLoading, setFactCheckLoading] = useState(false);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);

  async function runFactCheck() {
    setFactCheckLoading(true);
    try {
      await api.jobs.enqueue(id, 'FACT_CHECK', {});
      void qc.invalidateQueries({ queryKey: ['project', id] });
    } finally {
      setFactCheckLoading(false);
    }
  }

  async function runComplianceCheck() {
    setComplianceLoading(true);
    try {
      await api.jobs.enqueue(id, 'COMPLIANCE', {});
      void qc.invalidateQueries({ queryKey: ['project', id] });
    } finally {
      setComplianceLoading(false);
    }
  }

  async function generateMetadata() {
    setMetadataLoading(true);
    try {
      await api.jobs.enqueue(id, 'METADATA', {});
      void qc.invalidateQueries({ queryKey: ['project', id] });
    } finally {
      setMetadataLoading(false);
    }
  }

  async function generateThumbnailBrief() {
    setThumbnailLoading(true);
    try {
      await api.jobs.enqueue(id, 'THUMBNAIL', {});
      void qc.invalidateQueries({ queryKey: ['project', id] });
    } finally {
      setThumbnailLoading(false);
    }
  }

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

  async function handleSeoOptimize() {
    setSeoLoading(true);
    setSeoError('');
    try {
      const res = await apiClient.post<SeoResult>('/seo/optimize', {
        title: seoForm.title,
        description: seoForm.description,
        niche: seoForm.niche || undefined,
      });
      setSeoResult(res.data);
    } catch {
      setSeoError('Failed to optimize — try again.');
    } finally {
      setSeoLoading(false);
    }
  }

  async function handleAudienceAnalyze() {
    setAudienceLoading(true);
    setAudienceError('');
    try {
      const res = await apiClient.post<AudienceResult>('/audience/analyze', {
        niche: audienceForm.niche,
        recentTopics: [],
      });
      setAudienceResult(res.data);
    } catch {
      setAudienceError('Failed to analyze — try again.');
    } finally {
      setAudienceLoading(false);
    }
  }

  const contentType: ContentType =
    typeof window !== 'undefined'
      ? ((localStorage.getItem(`cf_ct_${id}`) as ContentType | null) ?? 'VIDEO')
      : 'VIDEO';

  const { data: project, isLoading } = useQuery<ProjectDetail>({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id).then((r) => r.data as ProjectDetail),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (project?.title) {
      setSeoForm((f) => f.title ? f : { ...f, title: project.title });
      setAudienceForm((f) => f.niche ? f : { niche: project.title });
    }
  }, [project?.title]);

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

  // Derive latest completed SCRIPT job for the Script tab
  const latestScriptJob = [...project.jobs]
    .filter((j) => j.type === 'SCRIPT' && j.status === 'COMPLETED')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  const pendingScriptJob = project.jobs.find((j) => j.type === 'SCRIPT' && ['PENDING', 'QUEUED', 'RUNNING'].includes(j.status));

  // Derive latest completed VIDEO_SCENE_PLAN job for the Storyboard tab
  const latestStoryboardJob = [...project.jobs]
    .filter((j) => j.type === 'VIDEO_SCENE_PLAN' && j.status === 'COMPLETED')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  const storyboardData = latestStoryboardJob?.result as VideoScenePlan | undefined;

  const latestFactCheckJob = [...project.jobs]
    .filter((j) => j.type === 'FACT_CHECK')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  const factCheckResult = latestFactCheckJob?.status === 'COMPLETED' ? latestFactCheckJob.result as FactCheckResult | undefined : undefined;
  const hasDoneFactCheck = !!factCheckResult;

  const latestComplianceJob = [...project.jobs]
    .filter((j) => j.type === 'COMPLIANCE')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  const complianceResult = latestComplianceJob?.status === 'COMPLETED' ? latestComplianceJob.result as ComplianceResult | undefined : undefined;
  const hasDoneCompliance = !!complianceResult;

  const latestMetadataJob = [...project.jobs]
    .filter((j) => j.type === 'METADATA')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  const metadataResult = latestMetadataJob?.status === 'COMPLETED'
    ? (latestMetadataJob.result as { title: string; description: string; tags: string[]; category: string; language: string; thumbnailPrompt: string } | undefined)
    : undefined;

  const latestThumbnailJob = [...project.jobs]
    .filter((j) => j.type === 'THUMBNAIL')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
  const thumbnailResult = latestThumbnailJob?.status === 'COMPLETED'
    ? (latestThumbnailJob.result as { concept: string; suggestedTextOverlay?: string; colorScheme?: string; visualElements?: string[]; aspectRatio?: string } | undefined)
    : undefined;

  return (
    <div className="p-8 max-w-5xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-600 mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> All Projects
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{project.title}</h1>
            <p className="text-gray-500 mt-1">{project.channel.title}{project.niche ? ` · ${project.niche}` : ''}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <BillingOrgPicker projectId={id} billingOrgId={project.billingOrgId} />
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${CT_META[contentType].color}`}>
              {CT_META[contentType].label}
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${project.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              {project.status}
            </span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex bg-gray-100 rounded-full p-1 mb-6 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('pipeline')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${activeTab === 'pipeline' ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Play className="w-3.5 h-3.5" /> Pipeline
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('script')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${activeTab === 'script' ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <FileText className="w-3.5 h-3.5" /> Script
          {latestScriptJob && <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('storyboard')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${activeTab === 'storyboard' ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Film className="w-3.5 h-3.5" /> Storyboard
          {latestStoryboardJob && <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('seo')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${activeTab === 'seo' ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <Search className="w-3.5 h-3.5" /> SEO &amp; Audience
          {(seoResult ?? audienceResult) && <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('checks')}
          className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${activeTab === 'checks' ? 'bg-white shadow text-brand-700' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <ShieldCheck className="w-3.5 h-3.5" /> Checks
          {(hasDoneFactCheck || hasDoneCompliance) && <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />}
        </button>
      </div>

      {/* ── Script Writer tab ─────────────────────────────────────────────── */}
      {activeTab === 'script' && (
        <div className="space-y-5">
          {/* Generation form */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-600" /> AI Script Writer
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Topic</label>
                <input
                  type="text"
                  value={scriptTopic}
                  onChange={(e) => setScriptTopic(e.target.value)}
                  placeholder={project.title}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tone</label>
                <select
                  value={scriptTone}
                  onChange={(e) => setScriptTone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  {['Informative', 'Entertaining', 'Inspirational', 'Educational', 'Conversational'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Target duration</label>
                <select
                  value={scriptDuration}
                  onChange={(e) => setScriptDuration(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option>Short 3-5min</option>
                  <option>Medium 8-12min</option>
                  <option>Long 15-20min</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Target audience <span className="text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  value={scriptAudience}
                  onChange={(e) => setScriptAudience(e.target.value)}
                  placeholder={`e.g. Beginners interested in ${project.niche ?? 'this topic'}`}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => generateScriptMutation.mutate()}
                disabled={generateScriptMutation.isPending || !!pendingScriptJob}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-full text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 shadow-sm"
              >
                {(generateScriptMutation.isPending || pendingScriptJob) ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                ) : latestScriptJob ? (
                  <><RefreshCw className="w-4 h-4" /> Regenerate Script</>
                ) : (
                  <><Play className="w-4 h-4" /> Generate Script</>
                )}
              </button>
              {generateScriptMutation.isError && (
                <p className="text-xs text-red-500">Failed to start — try again.</p>
              )}
            </div>
          </div>

          {/* Latest script result */}
          {pendingScriptJob && !latestScriptJob && (
            <div className="bg-white border border-gray-200 rounded-2xl p-10 flex flex-col items-center gap-3 text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
              <p className="text-sm">Script is being generated…</p>
            </div>
          )}

          {!!latestScriptJob?.result && (
            <div className="bg-white border border-gray-200 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Latest Script</h3>
                <p className="text-xs text-gray-400">{new Date(latestScriptJob.createdAt).toLocaleDateString()}</p>
              </div>
              <ScriptViewer r={latestScriptJob.result as Record<string, unknown>} />
            </div>
          )}

          {latestScriptJob?.status === 'COMPLETED' && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
              <h3 className="font-semibold text-gray-900 text-sm">Generate from Script</h3>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => { void generateMetadata(); }}
                  disabled={metadataLoading || latestMetadataJob?.status === 'RUNNING' || latestMetadataJob?.status === 'QUEUED'}
                  className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-full text-sm font-semibold hover:bg-sky-700 disabled:opacity-50"
                >
                  {metadataLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
                  {metadataResult ? 'Refresh Metadata' : 'Generate YouTube Metadata'}
                </button>
                <button
                  type="button"
                  onClick={() => { void generateThumbnailBrief(); }}
                  disabled={thumbnailLoading || latestThumbnailJob?.status === 'RUNNING' || latestThumbnailJob?.status === 'QUEUED'}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-full text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
                >
                  {thumbnailLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                  {thumbnailResult ? 'Refresh Thumbnail Brief' : 'Generate Thumbnail Brief'}
                </button>
              </div>

              {metadataResult && (
                <div className="space-y-3 border-t border-gray-100 pt-4">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">YouTube Metadata</h4>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Title</p>
                    <p className="font-semibold text-gray-900">{metadataResult.title}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">Description</p>
                    <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">{metadataResult.description}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">Tags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {metadataResult.tags.map((tag, i) => (
                        <span key={i} className="px-2 py-0.5 bg-sky-50 text-sky-700 text-xs rounded-full">#{tag}</span>
                      ))}
                    </div>
                  </div>
                  {metadataResult.thumbnailPrompt && (
                    <div>
                      <p className="text-xs text-gray-500 mb-0.5">Thumbnail Prompt</p>
                      <p className="text-xs text-gray-600 italic">{metadataResult.thumbnailPrompt}</p>
                    </div>
                  )}
                </div>
              )}

              {thumbnailResult && (
                <div className="space-y-3 border-t border-gray-100 pt-4">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Thumbnail Brief</h4>
                  <div className="rounded-xl bg-gray-900 aspect-video flex items-center justify-center relative overflow-hidden max-w-sm">
                    {thumbnailResult.suggestedTextOverlay && (
                      <p className="text-white font-black text-lg leading-tight drop-shadow-lg text-center px-4" style={{ textShadow: '2px 2px 8px rgba(0,0,0,0.8)' }}>
                        {thumbnailResult.suggestedTextOverlay}
                      </p>
                    )}
                    <span className="absolute bottom-2 right-2 text-xs text-gray-500 font-mono">{thumbnailResult.aspectRatio ?? '16:9'}</span>
                  </div>
                  <p className="text-sm text-gray-700">{thumbnailResult.concept}</p>
                  {thumbnailResult.colorScheme && (
                    <p className="text-xs text-gray-500">Color scheme: {thumbnailResult.colorScheme}</p>
                  )}
                  {thumbnailResult.visualElements && thumbnailResult.visualElements.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {thumbnailResult.visualElements.map((el, i) => (
                        <span key={i} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full">{el}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!latestScriptJob && !pendingScriptJob && (
            <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-500">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No script yet — fill in the form above and click Generate Script.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Storyboard tab ───────────────────────────────────────────────── */}
      {activeTab === 'storyboard' && (
        <div>
          {!storyboardData ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
              <Film className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 mb-4">No storyboard yet.</p>
              <button
                onClick={() => { void enqueueStoryboard(); }}
                disabled={enqueuePending}
                className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
              >
                {enqueuePending ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                Generate Storyboard (Stage 4)
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="bg-white border border-gray-200 rounded-xl px-5 py-3 flex items-center gap-6 text-sm text-gray-600">
                <span><strong className="text-gray-900">{storyboardData.scenes.length}</strong> scenes</span>
                <span><strong className="text-gray-900">{Math.round(storyboardData.totalDurationSecs)}s</strong> total</span>
                {storyboardData.semanticMethod && (
                  <span className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full text-xs font-medium">
                    {storyboardData.semanticMethod}
                  </span>
                )}
                {storyboardData.providerRecommendation && (
                  <span className="text-gray-500">{storyboardData.providerRecommendation}</span>
                )}
                <button
                  onClick={() => { void enqueueStoryboard(); }}
                  disabled={enqueuePending}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                  {enqueuePending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Regenerate
                </button>
              </div>

              {/* Scene cards grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {storyboardData.scenes.map((scene, i) => (
                  <SceneCard key={scene.id ?? i} scene={scene} index={i} />
                ))}
              </div>

              {storyboardData.productionNotes && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                  <strong>Director notes:</strong> {storyboardData.productionNotes}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SEO & Audience tab ───────────────────────────────────────────── */}
      {activeTab === 'seo' && (
        <div className="space-y-6">

          {/* SEO Optimizer */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Search className="w-4 h-4 text-violet-600" /> SEO Optimizer
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Video Title</label>
                <input
                  type="text"
                  value={seoForm.title}
                  onChange={(e) => setSeoForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder={project.title}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea
                  value={seoForm.description}
                  onChange={(e) => setSeoForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Describe what this video is about…"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Niche / Category <span className="text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  value={seoForm.niche}
                  onChange={(e) => setSeoForm((f) => ({ ...f, niche: e.target.value }))}
                  placeholder={project.niche ?? 'e.g. Tech, Fitness, Finance…'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { void handleSeoOptimize(); }}
                  disabled={seoLoading || !seoForm.title.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-full text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 shadow-sm"
                >
                  {seoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {seoLoading ? 'Optimizing…' : seoResult ? 'Re-optimize' : 'Optimize with AI'}
                </button>
                {seoError && <p className="text-xs text-red-500">{seoError}</p>}
              </div>
            </div>

            {seoResult && (
              <div className="mt-5 space-y-4 border-t border-gray-100 pt-5">
                {/* SEO Score */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600">SEO Score</span>
                    <span className={`text-sm font-bold ${seoResult.seoScore >= 70 ? 'text-green-600' : seoResult.seoScore >= 40 ? 'text-amber-500' : 'text-red-500'}`}>
                      {seoResult.seoScore}/100
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${seoResult.seoScore >= 70 ? 'bg-green-500' : seoResult.seoScore >= 40 ? 'bg-amber-400' : 'bg-red-500'}`}
                      style={{ width: `${seoResult.seoScore}%` }}
                    />
                  </div>
                </div>

                {/* Optimized Title */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Optimized Title</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-900 font-medium flex-1">{seoResult.optimizedTitle}</p>
                    <button
                      onClick={() => { void navigator.clipboard.writeText(seoResult.optimizedTitle); }}
                      className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                      title="Copy"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Optimized Description */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-1">Optimized Description</p>
                  <div className="flex items-start gap-2">
                    <p className="text-sm text-gray-700 leading-relaxed flex-1">{seoResult.optimizedDescription}</p>
                    <button
                      onClick={() => { void navigator.clipboard.writeText(seoResult.optimizedDescription); }}
                      className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"
                      title="Copy"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Tags */}
                {seoResult.tags.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">Tags</p>
                    <div className="flex flex-wrap gap-1.5">
                      {seoResult.tags.map((tag, i) => (
                        <span key={i} className="px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full text-xs">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search Keywords */}
                {seoResult.searchKeywords.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">Search Keywords</p>
                    <div className="flex flex-wrap gap-1.5">
                      {seoResult.searchKeywords.map((kw, i) => (
                        <span key={i} className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-medium">{kw}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Improvements */}
                {seoResult.improvements.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">Suggested Improvements</p>
                    <ul className="space-y-1">
                      {seoResult.improvements.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                          <span className="text-violet-400 flex-shrink-0 mt-0.5">•</span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Audience Insights */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Search className="w-4 h-4 text-violet-600" /> Audience Insights
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Content Niche</label>
                <input
                  type="text"
                  value={audienceForm.niche}
                  onChange={(e) => setAudienceForm({ niche: e.target.value })}
                  placeholder={project.title}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { void handleAudienceAnalyze(); }}
                  disabled={audienceLoading || !audienceForm.niche.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-full text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 shadow-sm"
                >
                  {audienceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {audienceLoading ? 'Analyzing…' : audienceResult ? 'Re-analyze' : 'Analyze Audience'}
                </button>
                {audienceError && <p className="text-xs text-red-500">{audienceError}</p>}
              </div>
            </div>

            {audienceResult && (
              <div className="mt-5 space-y-4 border-t border-gray-100 pt-5">
                {/* Primary demographic */}
                <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3">
                  <p className="text-xs font-medium text-violet-600 mb-0.5">Primary Demographic</p>
                  <p className="text-sm text-gray-900 font-medium">{audienceResult.primaryDemographic}</p>
                </div>

                {/* Interest clusters */}
                {audienceResult.interestClusters.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Interest Clusters</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {audienceResult.interestClusters.map((c, i) => (
                        <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                          <p className="text-sm font-medium text-gray-800">{c.cluster}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{c.size} · {c.engagement} engagement</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content preferences */}
                {audienceResult.contentPreferences.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">Content Preferences</p>
                    <div className="flex flex-wrap gap-1.5">
                      {audienceResult.contentPreferences.map((pref, i) => (
                        <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs">{pref}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Best posting times */}
                {audienceResult.bestPostingTimes.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">Best Posting Times</p>
                    <div className="flex flex-wrap gap-1.5">
                      {audienceResult.bestPostingTimes.map((t, i) => (
                        <span key={i} className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs font-medium">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Growth tips */}
                {audienceResult.growthTips.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">Growth Tips</p>
                    <ul className="space-y-1">
                      {audienceResult.growthTips.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                          <span className="text-green-500 flex-shrink-0 mt-0.5">✓</span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Checks tab ───────────────────────────────────────────────────── */}
      {activeTab === 'checks' && (
        <div className="space-y-6">

          {/* Fact Check */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-500" /> Fact Check
              </h2>
              <button
                type="button"
                onClick={() => { void runFactCheck(); }}
                disabled={factCheckLoading || latestFactCheckJob?.status === 'RUNNING' || latestFactCheckJob?.status === 'QUEUED'}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-full text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {factCheckLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {factCheckLoading ? 'Running…' : hasDoneFactCheck ? 'Re-check' : 'Run Fact Check'}
              </button>
            </div>

            {latestFactCheckJob && (latestFactCheckJob.status === 'RUNNING' || latestFactCheckJob.status === 'QUEUED') && (
              <div className="flex items-center gap-2 text-sm text-blue-600 mb-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking facts…
              </div>
            )}

            {factCheckResult ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="text-3xl font-bold text-gray-900">{factCheckResult.overallScore}<span className="text-base text-gray-500">/100</span></div>
                  <p className="text-sm text-gray-600 flex-1">{factCheckResult.summary}</p>
                </div>
                <div className="space-y-2">
                  {factCheckResult.claims.map((c, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 border border-gray-100 rounded-lg">
                      <span className={`mt-0.5 flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
                        c.verdict === 'SUPPORTED' ? 'bg-green-100 text-green-700'
                          : c.verdict === 'DISPUTED' ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>{c.verdict}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800">{c.claim}</p>
                        {c.notes && <p className="text-xs text-gray-500 mt-0.5">{c.notes}</p>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{Math.round(c.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
                {factCheckResult.sources && factCheckResult.sources.length > 0 && (
                  <div className="text-xs text-gray-500">
                    <strong>Sources:</strong> {factCheckResult.sources.join(', ')}
                  </div>
                )}
              </div>
            ) : !factCheckLoading && (
              <p className="text-sm text-gray-500 text-center py-4">Run a fact check to verify claims in your script.</p>
            )}
          </div>

          {/* Compliance */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" /> Compliance
              </h2>
              <button
                type="button"
                onClick={() => { void runComplianceCheck(); }}
                disabled={complianceLoading || latestComplianceJob?.status === 'RUNNING' || latestComplianceJob?.status === 'QUEUED'}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-full text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
              >
                {complianceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {complianceLoading ? 'Checking…' : hasDoneCompliance ? 'Re-check' : 'Check Compliance'}
              </button>
            </div>

            {latestComplianceJob && (latestComplianceJob.status === 'RUNNING' || latestComplianceJob.status === 'QUEUED') && (
              <div className="flex items-center gap-2 text-sm text-green-600 mb-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Checking compliance…
              </div>
            )}

            {complianceResult ? (
              <div className="space-y-4">
                <div className="flex items-center gap-6 flex-wrap">
                  <div className="text-3xl font-bold text-gray-900">{complianceResult.score}<span className="text-base text-gray-500">/100</span></div>
                  <div className="flex gap-3">
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${complianceResult.youtubeReady ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {complianceResult.youtubeReady ? 'YouTube Ready' : 'Not YouTube Ready'}
                    </span>
                    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${complianceResult.monetizationSafe ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {complianceResult.monetizationSafe ? 'Monetization Safe' : 'Monetization Risk'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 flex-1">{complianceResult.summary}</p>
                </div>
                {complianceResult.issues.length > 0 && (
                  <div className="space-y-2">
                    {complianceResult.issues.map((issue, i) => (
                      <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${
                        issue.severity === 'BLOCKER' ? 'border-red-200 bg-red-50'
                          : issue.severity === 'WARNING' ? 'border-amber-200 bg-amber-50'
                          : 'border-gray-200 bg-gray-50'
                      }`}>
                        <span className={`mt-0.5 flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
                          issue.severity === 'BLOCKER' ? 'bg-red-200 text-red-800'
                            : issue.severity === 'WARNING' ? 'bg-amber-200 text-amber-800'
                            : 'bg-gray-200 text-gray-700'
                        }`}>{issue.severity}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-700">{issue.category}</p>
                          <p className="text-sm text-gray-800">{issue.description}</p>
                          {issue.suggestion && <p className="text-xs text-gray-500 mt-1"><strong>Fix:</strong> {issue.suggestion}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : !complianceLoading && (
              <p className="text-sm text-gray-500 text-center py-4">Run a compliance check to verify YouTube and monetization readiness.</p>
            )}
          </div>

        </div>
      )}

      {/* ── Pipeline tab (existing content) ──────────────────────────────── */}
      {activeTab === 'pipeline' && <>

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

      <PublishFromRenderPanel projectId={id} />

      {/* Full Job History — section collapses to one clickable bar */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div
          onClick={() => setJobsOpen((o) => !o)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setJobsOpen((o) => !o); } }}
          className={`px-6 py-4 flex items-center gap-2 cursor-pointer hover:bg-gray-50 transition-colors rounded-t-xl ${jobsOpen ? 'border-b border-gray-100' : 'rounded-b-xl'}`}
        >
          {jobsOpen ? <ChevronUp className="w-4 h-4 text-gray-500 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />}
          <div>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              Recent Jobs
              <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[11px] font-medium">{project.jobs.length}</span>
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">All AI agent runs for this project</p>
          </div>
          {jobsOpen && project.jobs.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpandedIds((prev) => {
                  const allKeys = project.jobs.map((j) => (j.result ? `hist-${j.id}` : `log-${j.id}`));
                  const allOpen = allKeys.every((k) => prev.has(k));
                  return allOpen ? new Set() : new Set(allKeys);
                });
              }}
              className="ml-auto text-xs text-brand-600 hover:underline shrink-0"
            >
              {project.jobs.every((j) => expandedIds.has(j.result ? `hist-${j.id}` : `log-${j.id}`)) ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
        {!jobsOpen ? null : project.jobs.length === 0 ? (
          <div className="text-center py-14 text-gray-500">
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

              // Whole row is clickable: opens the result details, or the
              // activity log when the run produced no result payload
              const rowToggleKey = job.result ? histKey : hasLogs && !isJobRunning ? logKey : null;

              return (
                <div key={job.id} className="px-6 py-3">
                  <div
                    className={`flex items-center justify-between gap-3 -mx-2 px-2 py-1 rounded-lg ${rowToggleKey ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                    onClick={rowToggleKey ? () => toggle(rowToggleKey) : undefined}
                    role={rowToggleKey ? 'button' : undefined}
                    tabIndex={rowToggleKey ? 0 : undefined}
                    onKeyDown={rowToggleKey ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(rowToggleKey); } } : undefined}
                  >
                    <div>
                      <p className="font-medium text-gray-800 text-sm">
                        {job.type}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(job.createdAt).toLocaleString()}
                        {job.completedAt && ` · took ${formatDuration(new Date(job.completedAt).getTime() - new Date(job.startedAt ?? job.createdAt).getTime())}`}
                      </p>
                      {job.error && (
                        <p className="text-xs text-red-500 mt-1 truncate max-w-md" title={job.error}>{job.error}</p>
                      )}
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
                            <span className="text-xs text-gray-500">{live.detail}</span>
                          )}
                        </div>
                      )}
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[job.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_ICON[job.status]}
                        {STATUS_LABEL[job.status] ?? job.status}
                      </span>
                      {!!job.result && (
                        <button onClick={(e) => { e.stopPropagation(); toggle(histKey); }} className="text-gray-500 hover:text-gray-600">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      )}
                      {['PENDING', 'QUEUED', 'RUNNING'].includes(job.status) && (
                        confirmCancelJob === job.id ? (
                          <span className="flex items-center gap-1.5">
                            <button onClick={(e) => { e.stopPropagation(); cancelJobMutation.mutate(job.id); }} disabled={cancelJobMutation.isPending} className="text-xs px-2 py-1 bg-orange-600 text-white rounded-lg disabled:opacity-50">Stop it</button>
                            <button onClick={(e) => { e.stopPropagation(); setConfirmCancelJob(null); }} className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-500">Keep</button>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); pauseJobMutation.mutate(job.id); }}
                              disabled={pauseJobMutation.isPending}
                              aria-label={`Pause ${job.type} run`}
                              title="Pause this job (can be resumed later)"
                              className="text-gray-300 hover:text-yellow-500 transition-colors disabled:opacity-40"
                            >
                              <Pause className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmCancelJob(job.id); }}
                              aria-label={`Cancel ${job.type} run`}
                              title="Cancel this running job"
                              className="text-gray-300 hover:text-orange-500 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        )
                      )}
                      {job.status === 'PAUSED' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); resumeJobMutation.mutate(job.id); }}
                          disabled={resumeJobMutation.isPending}
                          aria-label={`Resume ${job.type} run`}
                          title="Resume this paused job"
                          className="text-yellow-500 hover:text-green-500 transition-colors disabled:opacity-40"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!['PENDING', 'QUEUED', 'RUNNING'].includes(job.status) && (
                        confirmDeleteJob === job.id ? (
                          <span className="flex items-center gap-1.5">
                            <button onClick={(e) => { e.stopPropagation(); deleteJobMutation.mutate(job.id); }} disabled={deleteJobMutation.isPending} className="text-xs px-2 py-1 bg-red-600 text-white rounded-lg disabled:opacity-50">Delete</button>
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteJob(null); }} className="text-xs px-2 py-1 border border-gray-200 rounded-lg text-gray-500">Cancel</button>
                          </span>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteJob(job.id); }}
                            aria-label={`Delete ${job.type} run`}
                            title="Delete this run from history. If it is the latest result for a stage, the stage reverts to the previous run."
                            className="text-gray-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Live activity log — open while RUNNING, collapsible when done */}
                  {hasLogs && (
                    <div className="mt-2">
                      {!isJobRunning && (
                        <button
                          onClick={() => toggle(logKey)}
                          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-600 mb-1.5"
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
      </> /* end pipeline tab */}
    </div>
  );
}

// ─── Publish from Render Panel ────────────────────────────────────────────────

function PublishFromRenderPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery<ProjectPublishReady>({
    queryKey: ['publish-ready', projectId],
    queryFn: () => api.publishing.projectReady(projectId).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!data?.render?.r2Key || !data.approval || !data.video) return;
      setError('');
      await api.publishing.publish({
        videoId: data.video.id,
        channelId: data.project.channel.id,
        title: data.video.title,
        description: data.video.description ?? '',
        tags: data.video.tags,
        approvalId: data.approval.id,
        r2Key: data.render.r2Key,
        scheduledAt: scheduledAt || undefined,
        containsSyntheticMedia: true,
      });
    },
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['publish-ready', projectId] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Publish failed'),
  });

  if (isLoading) return null;
  if (!data) return null;

  const { render, approval, video, canPublish } = data;

  // Already published
  if (video?.youtubeVideoId) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex items-center gap-3">
        <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-green-800">Published to YouTube</p>
          <a
            href={`https://youtube.com/watch?v=${video.youtubeVideoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-green-700 underline"
          >
            youtube.com/watch?v={video.youtubeVideoId}
          </a>
        </div>
      </div>
    );
  }

  // Not ready — show status
  if (!canPublish) {
    const missing: string[] = [];
    if (!render) missing.push('Render not complete');
    if (!approval) missing.push('No approved approval');
    if (!video) missing.push('No video metadata (run Metadata step)');
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4">
        <div className="flex items-center gap-2 mb-2">
          <Youtube className="w-4 h-4 text-gray-400" />
          <p className="text-sm font-semibold text-gray-700">Publish to YouTube</p>
        </div>
        <p className="text-xs text-gray-500">Waiting for: {missing.join(' · ')}</p>
      </div>
    );
  }

  const durationStr = render?.durationMs
    ? `${Math.floor(render.durationMs / 60000)}m ${Math.round((render.durationMs % 60000) / 1000)}s`
    : null;

  return (
    <>
      <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
            <Youtube className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Ready to publish</p>
            <p className="text-xs text-gray-500">
              Render complete{durationStr ? ` · ${durationStr}` : ''} · Approval granted · Human-approved ✓
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors shrink-0"
        >
          <Send className="w-4 h-4" />
          Publish to YouTube
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Youtube className="w-5 h-5 text-red-600" />
                <h2 className="text-lg font-bold text-gray-900">Confirm Publish</h2>
              </div>
              <button onClick={() => { setOpen(false); setError(''); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 mb-5">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-0.5">Title</p>
                <p className="text-sm font-medium text-gray-900">{video!.title}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-0.5">Channel</p>
                <p className="text-sm font-medium text-gray-900">{data.project.channel.title}</p>
              </div>
              {render?.preset && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500 mb-0.5">Render preset{durationStr ? ` · ${durationStr}` : ''}</p>
                  <p className="text-sm font-medium text-gray-900">{render.preset}</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Schedule (optional — leave blank to publish now)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
                />
              </div>
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                This video contains AI-generated media and will be labelled "Altered or synthetic content" per YouTube policy.
              </p>
            </div>

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => { setOpen(false); setError(''); }}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                {publishMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {publishMutation.isPending ? 'Publishing…' : scheduledAt ? 'Schedule' : 'Publish Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Scene Card ───────────────────────────────────────────────────────────────

const EMOTION_COLORS: Record<string, string> = {
  inspiring:  'bg-amber-100 text-amber-700',
  dramatic:   'bg-red-100 text-red-700',
  calm:       'bg-blue-100 text-blue-700',
  energetic:  'bg-orange-100 text-orange-700',
  melancholic:'bg-indigo-100 text-indigo-700',
  joyful:     'bg-green-100 text-green-700',
  tense:      'bg-purple-100 text-purple-700',
  neutral:    'bg-gray-100 text-gray-600',
};

function SceneCard({ scene, index }: { scene: Scene; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const emotionStyle = EMOTION_COLORS[scene.emotion ?? 'neutral'] ?? EMOTION_COLORS['neutral'];
  const durationStr = scene.durationSecs >= 60
    ? `${Math.floor(scene.durationSecs / 60)}m ${Math.round(scene.durationSecs % 60)}s`
    : `${Math.round(scene.durationSecs)}s`;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 bg-violet-100 text-violet-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
            {index + 1}
          </span>
          <h3 className="font-semibold text-gray-900 text-sm leading-tight">{scene.title}</h3>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-gray-400 hover:text-gray-600 p-1"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{durationStr}</span>
        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">{scene.shotType}</span>
        {scene.emotion && (
          <span className={`px-2 py-0.5 rounded-full text-xs ${emotionStyle}`}>{scene.emotion}</span>
        )}
        {scene.cameraMotion && scene.cameraMotion !== 'static' && (
          <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs">{scene.cameraMotion}</span>
        )}
        {scene.transition && scene.transition !== 'cut' && (
          <span className="px-2 py-0.5 bg-pink-100 text-pink-700 rounded-full text-xs">→ {scene.transition}</span>
        )}
      </div>

      {scene.imagePrompt && (
        <p className="text-xs text-gray-500 italic leading-relaxed mb-2 line-clamp-2">
          🎨 {scene.imagePrompt}
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-2.5 border-t border-gray-100 pt-3">
          {scene.purpose && (
            <div>
              <span className="text-xs font-medium text-gray-500">Purpose</span>
              <p className="text-xs text-gray-700 mt-0.5">{scene.purpose}</p>
            </div>
          )}
          {scene.narration && (
            <div>
              <span className="text-xs font-medium text-gray-500">Narration</span>
              <p className="text-xs text-gray-700 mt-0.5 italic">&ldquo;{scene.narration}&rdquo;</p>
            </div>
          )}
          <div>
            <span className="text-xs font-medium text-gray-500">Video prompt</span>
            <p className="text-xs text-gray-700 mt-0.5">{scene.videoPrompt}</p>
          </div>
          {scene.voiceSettings?.emotion && (
            <div>
              <span className="text-xs font-medium text-gray-500">Voice</span>
              <p className="text-xs text-gray-700 mt-0.5">{scene.voiceSettings.emotion} · {scene.voiceSettings.pace ?? 'normal'}</p>
            </div>
          )}
          {scene.musicSettings?.mood && (
            <div>
              <span className="text-xs font-medium text-gray-500">Music</span>
              <p className="text-xs text-gray-700 mt-0.5">{scene.musicSettings.mood} · vol {scene.musicSettings.volume ?? 0.3}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
