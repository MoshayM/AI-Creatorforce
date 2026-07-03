'use client';
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getErrorMessage } from '@/lib/getErrorMessage';
import { api } from '@/lib/api';
import { useProjectJobEvents } from '@/hooks/use-job-events';
import {
  Loader2, Play, CheckCircle, XCircle, Clock, AlertCircle,
  ChevronDown, ChevronUp, ArrowLeft, TrendingUp, BookOpen,
  FileText, ShieldCheck, Tag, ImageIcon, Upload, Users, Search,
  Music, Sparkles, Zap, RefreshCw, Copy, Download, Check,
  RotateCcw, ArrowRightLeft, Timer, Mic,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  type: string;
  status: string;
  createdAt: string;
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

interface StageJob {
  type: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  requiresInput?: { key: string; placeholder: string };
  requiresPrevious?: string;
}

interface Stage {
  id: string;
  label: string;
  icon: React.ReactNode;
  jobs: StageJob[];
}

// ─── Pipeline Definitions ─────────────────────────────────────────────────────

const VIDEO_PIPELINE: Stage[] = [
  {
    id: 'discover', label: 'Discover', icon: <TrendingUp className="w-4 h-4" />,
    jobs: [
      { type: 'TREND_ANALYSIS', label: 'Analyze Trends', icon: <TrendingUp className="w-4 h-4" />, description: 'Identify top trending topics in your niche with virality scores and peak timing' },
      { type: 'AUDIENCE_ANALYSIS', label: 'Analyze Audience', icon: <Users className="w-4 h-4" />, description: 'Map your target demographic — age, interests, watch behaviour, and engagement signals' },
    ],
  },
  {
    id: 'research', label: 'Research', icon: <BookOpen className="w-4 h-4" />,
    jobs: [
      { type: 'RESEARCH', label: 'Research Topic', icon: <BookOpen className="w-4 h-4" />, description: 'Deep-dive into your chosen topic with authoritative sources, key angles, and audience interest signals', requiresInput: { key: 'topic', placeholder: 'e.g. Best AI tools for YouTube creators in 2026' } },
    ],
  },
  {
    id: 'create', label: 'Create', icon: <FileText className="w-4 h-4" />,
    jobs: [
      { type: 'SCRIPT', label: 'Write Script', icon: <FileText className="w-4 h-4" />, description: 'Generate a full video script — hook, structured sections, and a strong call-to-action', requiresPrevious: 'RESEARCH' },
      { type: 'FACT_CHECK', label: 'Fact Check', icon: <ShieldCheck className="w-4 h-4" />, description: 'Verify every claim in your script against source material before publishing', requiresPrevious: 'SCRIPT' },
    ],
  },
  {
    id: 'optimize', label: 'Optimize', icon: <Search className="w-4 h-4" />,
    jobs: [
      { type: 'COMPLIANCE', label: 'Compliance Audit', icon: <ShieldCheck className="w-4 h-4" />, description: 'Audit for copyright, advertiser-friendliness, hate speech, misinformation, and platform policy', requiresPrevious: 'SCRIPT' },
      { type: 'METADATA', label: 'Generate Metadata', icon: <Tag className="w-4 h-4" />, description: 'SEO-optimized title (100 chars), description (5 000 chars), and tags for maximum organic reach', requiresPrevious: 'COMPLIANCE' },
      { type: 'SEO_OPTIMIZATION', label: 'SEO Optimization', icon: <Search className="w-4 h-4" />, description: 'Keyword research, search volume analysis, and ranking strategy for YouTube discovery', requiresPrevious: 'METADATA' },
    ],
  },
  {
    id: 'assets', label: 'Assets (Beta)', icon: <Sparkles className="w-4 h-4" />,
    jobs: [
      { type: 'VOICE_SPEC', label: 'Voice Narration Spec', icon: <Mic className="w-4 h-4" />, description: 'Generate per-section TTS specifications with SSML markup, pacing, and pronunciation guides', requiresPrevious: 'SCRIPT' },
      { type: 'IMAGE_BRIEF', label: 'Image Briefs', icon: <ImageIcon className="w-4 h-4" />, description: 'Create per-scene b-roll and still image generation prompts matched to your brand style', requiresPrevious: 'SCRIPT' },
      { type: 'MUSIC_BRIEF', label: 'Music Brief', icon: <Music className="w-4 h-4" />, description: 'Generate mood, BPM, and instrument brief for AI music generation tools (Suno/Udio)', requiresPrevious: 'SCRIPT' },
      { type: 'VIDEO_SCENE_PLAN', label: 'Video Scene Plan', icon: <Zap className="w-4 h-4" />, description: 'Create a shot list and per-scene video generation prompts for AI video tools (Runway/Pika)', requiresPrevious: 'SCRIPT' },
      { type: 'SUBTITLE_GENERATE', label: 'Generate Subtitles', icon: <FileText className="w-4 h-4" />, description: 'Auto-generate timed subtitle cues (SRT/VTT) from script sections with brand styling', requiresPrevious: 'SCRIPT' },
    ],
  },
  {
    id: 'publish', label: 'Publish', icon: <Upload className="w-4 h-4" />,
    jobs: [
      { type: 'THUMBNAIL', label: 'Thumbnail Brief', icon: <ImageIcon className="w-4 h-4" />, description: 'AI-crafted visual concept — colour palette, text overlay, subject positioning, and emotional hook', requiresPrevious: 'METADATA' },
      { type: 'PUBLISH', label: 'Publish to YouTube', icon: <Upload className="w-4 h-4" />, description: 'Push your approved content live to your connected YouTube channel', requiresPrevious: 'METADATA' },
    ],
  },
];

const MUSIC_PIPELINE: Stage[] = [
  {
    id: 'discover', label: 'Discover', icon: <TrendingUp className="w-4 h-4" />,
    jobs: [
      { type: 'TREND_ANALYSIS', label: 'Trending Sounds', icon: <TrendingUp className="w-4 h-4" />, description: 'Identify trending music genres, moods, lyric themes, and styles gaining momentum' },
      { type: 'AUDIENCE_ANALYSIS', label: 'Listener Profile', icon: <Users className="w-4 h-4" />, description: 'Understand your listeners — genre preferences, playlist habits, and streaming behaviour' },
    ],
  },
  {
    id: 'concept', label: 'Concept', icon: <Sparkles className="w-4 h-4" />,
    jobs: [
      { type: 'RESEARCH', label: 'Develop Concept', icon: <Sparkles className="w-4 h-4" />, description: 'Build your song concept — theme, mood board, lyric direction, structure, and emotional arc', requiresInput: { key: 'topic', placeholder: 'e.g. Motivational gospel track for young adults facing doubt' } },
    ],
  },
  {
    id: 'create', label: 'Create', icon: <Music className="w-4 h-4" />,
    jobs: [
      { type: 'SCRIPT', label: 'Write Lyrics', icon: <Music className="w-4 h-4" />, description: 'Generate full lyrics — verse, pre-chorus, chorus, bridge — with hooks and singable phrasing', requiresPrevious: 'RESEARCH' },
      { type: 'FACT_CHECK', label: 'Content Review', icon: <ShieldCheck className="w-4 h-4" />, description: 'Check lyric originality, cultural sensitivity, and theological accuracy (if applicable)', requiresPrevious: 'SCRIPT' },
    ],
  },
  {
    id: 'optimize', label: 'Optimize', icon: <Tag className="w-4 h-4" />,
    jobs: [
      { type: 'COMPLIANCE', label: 'Rights Audit', icon: <ShieldCheck className="w-4 h-4" />, description: 'Copyright clearance check, sampling advisory, and licensing compliance for music release', requiresPrevious: 'SCRIPT' },
      { type: 'METADATA', label: 'Music Metadata', icon: <Tag className="w-4 h-4" />, description: 'Genre tags, mood descriptors, BPM estimate, album art brief, and streaming platform description', requiresPrevious: 'COMPLIANCE' },
      { type: 'SEO_OPTIMIZATION', label: 'Discoverability', icon: <Search className="w-4 h-4" />, description: 'YouTube Music and streaming platform keyword strategy for organic discovery', requiresPrevious: 'METADATA' },
    ],
  },
  {
    id: 'release', label: 'Release', icon: <Upload className="w-4 h-4" />,
    jobs: [
      { type: 'THUMBNAIL', label: 'Album Art Brief', icon: <ImageIcon className="w-4 h-4" />, description: 'Visual concept for your single or EP artwork — style, colour story, and text treatment', requiresPrevious: 'METADATA' },
      { type: 'PUBLISH', label: 'Release to YouTube', icon: <Upload className="w-4 h-4" />, description: 'Publish your music video or audio visualizer to your YouTube Music channel', requiresPrevious: 'METADATA' },
    ],
  },
];

const SHORT_PIPELINE: Stage[] = [
  {
    id: 'discover', label: 'Discover', icon: <TrendingUp className="w-4 h-4" />,
    jobs: [
      { type: 'TREND_ANALYSIS', label: 'Viral Trends', icon: <TrendingUp className="w-4 h-4" />, description: 'Find the trending Short formats, hook styles, and audio tracks dominating this week' },
    ],
  },
  {
    id: 'angle', label: 'Angle', icon: <Zap className="w-4 h-4" />,
    jobs: [
      { type: 'RESEARCH', label: 'Find the Angle', icon: <Zap className="w-4 h-4" />, description: 'Identify the perfect 30–60 second hook, narrative format, and delivery style for maximum retention', requiresInput: { key: 'topic', placeholder: 'e.g. One AI trick that saves 1 hour every day' } },
    ],
  },
  {
    id: 'create', label: 'Script', icon: <FileText className="w-4 h-4" />,
    jobs: [
      { type: 'SCRIPT', label: 'Write Short Script', icon: <FileText className="w-4 h-4" />, description: 'Punchy 45-second script engineered for instant retention — hook in 2 seconds, viral CTA at the end', requiresPrevious: 'RESEARCH' },
    ],
  },
  {
    id: 'optimize', label: 'Optimize', icon: <Tag className="w-4 h-4" />,
    jobs: [
      { type: 'COMPLIANCE', label: 'Compliance Check', icon: <ShieldCheck className="w-4 h-4" />, description: 'Policy compliance for YouTube Shorts monetization and ad-friendly status', requiresPrevious: 'SCRIPT' },
      { type: 'METADATA', label: 'Shorts Metadata', icon: <Tag className="w-4 h-4" />, description: 'Title, hashtags, and description tuned for the Shorts algorithm and search discovery', requiresPrevious: 'COMPLIANCE' },
    ],
  },
  {
    id: 'publish', label: 'Publish', icon: <Upload className="w-4 h-4" />,
    jobs: [
      { type: 'THUMBNAIL', label: 'Cover Frame', icon: <ImageIcon className="w-4 h-4" />, description: 'Vertical thumbnail concept optimised for maximum CTR in the Shorts shelf', requiresPrevious: 'METADATA' },
      { type: 'PUBLISH', label: 'Publish as Short', icon: <Upload className="w-4 h-4" />, description: 'Push your Short live to your YouTube Shorts feed with full metadata applied', requiresPrevious: 'METADATA' },
    ],
  },
];

const PIPELINES: Record<ContentType, Stage[]> = { VIDEO: VIDEO_PIPELINE, MUSIC: MUSIC_PIPELINE, SHORT: SHORT_PIPELINE };

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
  const qc = useQueryClient();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [enqueuingType, setEnqueuingType] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastRan, setLastRan] = useState<string | null>(null);
  // Live transient status per jobId (RETRYING, RATE_LIMITED, etc.)
  const [liveStatus, setLiveStatus] = useState<Record<string, { status: string; detail?: string }>>({});
  // Per-job activity log: messages streamed in real-time via WebSocket
  const [jobLogs, setJobLogs] = useState<Record<string, Array<{ msg: string; detail?: string }>>>({});

  const handleJobEvent = useCallback((event: Record<string, unknown>) => {
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

  const enqueueMutation = useMutation({
    mutationFn: ({ type, payload }: { type: string; payload?: Record<string, unknown> }) =>
      api.jobs.enqueue(id, type, payload),
    onMutate: ({ type }) => {
      setEnqueuingType(type);
      setRunError(null);
      setLastRan(null);
    },
    onSuccess: (_, { type }) => {
      setLastRan(type);
    },
    onError: (err: unknown) => {
      setRunError(getErrorMessage(err) || 'Failed to start agent');
    },
    onSettled: () => {
      setEnqueuingType(null);
      void qc.invalidateQueries({ queryKey: ['project', id] });
    },
  });

  const pipeline = PIPELINES[contentType];

  function latestJob(type: string): Job | undefined {
    return project?.jobs
      .filter((j) => j.type === type)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }

  function stageStatus(stage: Stage): 'done' | 'running' | 'partial' | 'pending' {
    const statuses = stage.jobs.map((sj) => latestJob(sj.type)?.status);
    if (statuses.every((s) => s === 'COMPLETED')) return 'done';
    if (statuses.some((s) => s === 'RUNNING' || s === 'QUEUED')) return 'running';
    if (statuses.some((s) => s === 'COMPLETED' || s === 'WAITING_APPROVAL' || s === 'FAILED')) return 'partial';
    return 'pending';
  }

  function canRun(sj: StageJob): boolean {
    if (!sj.requiresPrevious) return true;
    return latestJob(sj.requiresPrevious)?.status === 'COMPLETED';
  }

  function nextRecommendation(): { sj: StageJob; stage: Stage } | null {
    for (const stage of pipeline) {
      for (const sj of stage.jobs) {
        const job = latestJob(sj.type);
        if (!job || job.status === 'FAILED' || job.status === 'CANCELLED') {
          if (canRun(sj)) return { sj, stage };
        }
      }
    }
    return null;
  }

  function toggle(key: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function handleRun(sj: StageJob) {
    const payload: Record<string, unknown> = {};
    if (sj.requiresInput && inputs[sj.type]) {
      payload[sj.requiresInput.key] = inputs[sj.type];
    }
    enqueueMutation.mutate({ type: sj.type, payload: Object.keys(payload).length ? payload : undefined });
  }

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>;
  }
  if (!project) return null;

  const next = nextRecommendation();

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

      {/* Pipeline Progress Bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-5">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">Content Pipeline</h2>
        <div className="flex items-center gap-0 overflow-x-auto">
          {pipeline.map((stage, i) => {
            const status = stageStatus(stage);
            return (
              <div key={stage.id} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                    status === 'done'    ? 'bg-green-500 text-white' :
                    status === 'running' ? 'bg-blue-500 text-white' :
                    status === 'partial' ? 'bg-brand-500 text-white' :
                    'bg-gray-100 text-gray-400'
                  }`}>
                    {status === 'done' ? <CheckCircle className="w-5 h-5" /> :
                     status === 'running' ? <Loader2 className="w-5 h-5 animate-spin" /> :
                     stage.icon}
                  </div>
                  <span className={`text-xs font-medium ${
                    status === 'done'    ? 'text-green-700' :
                    status === 'running' ? 'text-blue-700' :
                    status === 'partial' ? 'text-brand-700' :
                    'text-gray-400'
                  }`}>{stage.label}</span>
                </div>
                {i < pipeline.length - 1 && (
                  <div className={`w-10 h-0.5 mx-1 mb-4 ${status === 'done' ? 'bg-green-400' : status === 'running' ? 'bg-blue-300' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Next Recommended Action */}
      {next && (
        <div className="bg-gradient-to-r from-brand-50 to-indigo-50 border border-brand-200 rounded-xl p-5 mb-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center text-white flex-shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Recommended Next Step</p>
                <p className="text-gray-900 font-semibold mt-0.5">{next.sj.label}</p>
                <p className="text-sm text-gray-600 mt-0.5">{next.sj.description}</p>
              </div>
            </div>
            {!next.sj.requiresInput && (
              <button
                onClick={() => handleRun(next.sj)}
                disabled={enqueueMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 font-medium text-sm flex-shrink-0"
              >
                {enqueuingType === next.sj.type
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Play className="w-4 h-4" />}
                Run Now
              </button>
            )}
          </div>
        </div>
      )}

      {/* Run feedback banners */}
      {runError && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700">Agent failed to start</p>
            <p className="text-xs text-red-600 mt-0.5">{runError}</p>
          </div>
          <button onClick={() => setRunError(null)} className="text-red-400 hover:text-red-600 text-xs flex-shrink-0">✕</button>
        </div>
      )}
      {lastRan && !runError && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4">
          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
          <p className="text-sm text-green-700 flex-1">
            <span className="font-semibold">{lastRan.replace(/_/g, ' ')}</span> completed — results are ready below.
          </p>
          <button onClick={() => setLastRan(null)} className="text-green-400 hover:text-green-600 text-xs flex-shrink-0">✕</button>
        </div>
      )}

      {/* Pipeline Stages */}
      <div className="space-y-4 mb-6">
        {pipeline.map((stage) => (
          <div key={stage.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            {/* Stage header */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
              <span className="text-brand-600">{stage.icon}</span>
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{stage.label}</h3>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                stageStatus(stage) === 'done'    ? 'bg-green-100 text-green-700' :
                stageStatus(stage) === 'running' ? 'bg-blue-100 text-blue-700' :
                stageStatus(stage) === 'partial' ? 'bg-amber-100 text-amber-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                {stageStatus(stage) === 'done'    ? '✓ Complete' :
                 stageStatus(stage) === 'running' ? '⟳ Running' :
                 stageStatus(stage) === 'partial' ? 'Partial' : 'Not started'}
              </span>
            </div>

            {/* Stage jobs */}
            <div className="divide-y divide-gray-50">
              {stage.jobs.map((sj) => {
                const job = latestJob(sj.type);
                const runnable = canRun(sj);
                const isEnqueuing = enqueuingType === sj.type;
                const expandKey = `stage-${sj.type}`;
                const isExpanded = expandedIds.has(expandKey);
                const hasResult = job?.status === 'COMPLETED' && job.result != null;
                // Use transient live status (RETRYING, RATE_LIMITED, etc.) if job is RUNNING
                const live = job?.status === 'RUNNING' ? liveStatus[job.id] : undefined;
                const displayStatus = live?.status ?? job?.status;

                return (
                  <div key={sj.type} className="px-6 py-4">
                    <div className="flex items-start gap-4">
                      {/* Job type icon */}
                      <div className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        job?.status === 'COMPLETED'       ? 'bg-green-100 text-green-600' :
                        job?.status === 'RUNNING'         ? 'bg-blue-100 text-blue-600' :
                        job?.status === 'FAILED'          ? 'bg-red-100 text-red-600' :
                        job?.status === 'WAITING_APPROVAL'? 'bg-orange-100 text-orange-600' :
                        job?.status === 'QUEUED'          ? 'bg-gray-100 text-gray-400' :
                        'bg-gray-50 text-gray-300'
                      }`}>
                        {job?.status === 'RUNNING'
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : sj.icon}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Job header row */}
                        <div className="flex items-start gap-3 flex-wrap">
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900 text-sm">{sj.label}</p>
                            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{sj.description}</p>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {job && displayStatus && (
                              <div className="flex flex-col items-end gap-0.5">
                                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[displayStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                                  {STATUS_ICON[displayStatus]}
                                  {STATUS_LABEL[displayStatus] ?? displayStatus}
                                </span>
                                {live?.detail && (
                                  <span className="text-xs text-gray-400 pr-1">{live.detail}</span>
                                )}
                              </div>
                            )}
                            {hasResult && (
                              <button
                                onClick={() => toggle(expandKey)}
                                className="flex items-center gap-1 text-brand-600 hover:text-brand-700 text-xs font-medium"
                              >
                                Results {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}
                            <button
                              onClick={() => handleRun(sj)}
                              disabled={isEnqueuing || enqueueMutation.isPending || !runnable}
                              aria-label={sj.label}
                              title={!runnable && sj.requiresPrevious ? `Complete ${sj.requiresPrevious.replace(/_/g, ' ')} first` : sj.label}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                !runnable
                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                  : job?.status === 'COMPLETED'
                                    ? 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                                    : 'bg-brand-600 text-white hover:bg-brand-700'
                              }`}
                            >
                              {isEnqueuing
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : job?.status === 'COMPLETED'
                                  ? <RefreshCw className="w-3 h-3" />
                                  : <Play className="w-3 h-3" />}
                              {job?.status === 'COMPLETED' ? 'Re-run' : 'Run'}
                            </button>
                          </div>
                        </div>

                        {/* Topic input for research-style jobs */}
                        {sj.requiresInput && runnable && (!job || job.status === 'FAILED') && (
                          <div className="mt-3">
                            <input
                              value={inputs[sj.type] ?? ''}
                              onChange={(e) => setInputs((p) => ({ ...p, [sj.type]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter' && inputs[sj.type]) handleRun(sj); }}
                              placeholder={sj.requiresInput.placeholder}
                              className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-400 placeholder-gray-400"
                            />
                            <p className="text-xs text-gray-400 mt-1">Press Enter or click Run</p>
                          </div>
                        )}

                        {/* Prerequisite notice */}
                        {!runnable && sj.requiresPrevious && (
                          <p className="mt-2 text-xs text-amber-600 flex items-center gap-1.5">
                            <AlertCircle className="w-3 h-3 flex-shrink-0" />
                            Complete <strong>{sj.requiresPrevious.replace(/_/g, ' ').toLowerCase()}</strong> first to unlock this step
                          </p>
                        )}

                        {/* Waiting approval message */}
                        {job?.status === 'WAITING_APPROVAL' && (
                          <p className="mt-2 text-xs text-orange-600 flex items-center gap-1.5">
                            <AlertCircle className="w-3 h-3 flex-shrink-0" />
                            Awaiting your review in <Link href="/approvals" className="underline font-medium">Approval Center</Link>
                          </p>
                        )}

                        {/* Error display */}
                        {job?.status === 'FAILED' && job.error && (
                          <p className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                            <span className="font-semibold">Error:</span> {job.error}
                          </p>
                        )}

                        {/* Live activity log — shown while RUNNING, collapsible when done */}
                        {job && (() => {
                          const logs = jobLogs[job.id];
                          if (!logs || logs.length === 0) return null;
                          const isRunning = job.status === 'RUNNING';
                          const logKey = `log-${job.id}`;
                          const logOpen = isRunning || expandedIds.has(logKey);
                          return (
                            <div className="mt-3">
                              {!isRunning && (
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
                                  {isRunning && (
                                    <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1.5">
                                      <Loader2 className="w-3 h-3 animate-spin text-green-500" />
                                      <span className="text-green-500 font-medium">Agent running</span>
                                    </p>
                                  )}
                                  {logs.map((entry, i) => {
                                    const isLast = i === logs.length - 1;
                                    return (
                                      <div key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                                        <span className={`flex-shrink-0 mt-0.5 ${isLast && isRunning ? 'text-green-400' : 'text-gray-600'}`}>
                                          {isLast && isRunning ? '▶' : '·'}
                                        </span>
                                        <span className={isLast && isRunning ? 'text-green-300' : 'text-gray-300'}>
                                          {entry.msg}
                                          {entry.detail && (
                                            <span className="text-gray-500 ml-2">— {entry.detail}</span>
                                          )}
                                        </span>
                                        {isLast && isRunning && (
                                          <span className="text-green-500 animate-pulse ml-0.5 flex-shrink-0">●</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Expanded result */}
                        {isExpanded && job && (
                          <div className="mt-3 bg-gray-50 border border-gray-100 rounded-xl p-4">
                            <ResultPreview job={job} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

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
              return (
                <div key={job.id} className="px-6 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">
                        {job.type}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(job.createdAt).toLocaleString()}
                        {job.completedAt && ` · ${Math.round((new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()) / 1000)}s`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
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
