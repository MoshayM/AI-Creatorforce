'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Loader2, AlertCircle, CheckCircle2, Clock, RefreshCw, Filter, X, Zap, Play } from 'lucide-react';
import Link from 'next/link';
import { StatCard } from '@/components/stat-card';
import { apiClient } from '@/lib/api';

interface MonitorJob {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  project?: { id: string; title: string } | null;
}

interface MonitorData {
  jobs: MonitorJob[];
  counts: Record<string, number>;
  todayCounts: Record<string, number>;
}

const JOB_TYPE_COLORS: Record<string, string> = {
  SCRIPT: 'bg-blue-100 text-blue-700',
  RESEARCH: 'bg-cyan-100 text-cyan-700',
  FACT_CHECK: 'bg-teal-100 text-teal-700',
  COMPLIANCE: 'bg-emerald-100 text-emerald-700',
  METADATA: 'bg-sky-100 text-sky-700',
  THUMBNAIL: 'bg-amber-100 text-amber-700',
  TREND_ANALYSIS: 'bg-yellow-100 text-yellow-700',
  AUDIENCE_ANALYSIS: 'bg-indigo-100 text-indigo-700',
  VOICE: 'bg-purple-100 text-purple-700',
  MUSIC_BRIEF: 'bg-orange-100 text-orange-700',
  VIDEO_SCENE_PLAN: 'bg-violet-100 text-violet-700',
  FULL_PRODUCTION: 'bg-gray-800 text-white',
  CALENDAR_PROPOSAL: 'bg-green-100 text-green-700',
};

const STATUS_FILTER_OPTIONS = ['all', 'running', 'pending', 'completed', 'failed'] as const;
type StatusFilter = (typeof STATUS_FILTER_OPTIONS)[number];

function elapsed(from: string | null | undefined, to?: string | null): string {
  if (!from) return '';
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  const secs = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function timeAgo(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function StatusDot({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === 'running')
    return <span className="flex items-center gap-1 text-blue-600 text-xs font-medium"><Loader2 className="w-3 h-3 animate-spin" />Running</span>;
  if (s === 'pending' || s === 'queued')
    return <span className="flex items-center gap-1 text-amber-600 text-xs font-medium"><Clock className="w-3 h-3" />Queued</span>;
  if (s === 'completed')
    return <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle2 className="w-3 h-3" />Done</span>;
  if (s === 'failed')
    return <span className="flex items-center gap-1 text-red-600 text-xs font-medium"><AlertCircle className="w-3 h-3" />Failed</span>;
  if (s === 'cancelled')
    return <span className="flex items-center gap-1 text-gray-500 text-xs font-medium"><X className="w-3 h-3" />Cancelled</span>;
  return <span className="text-gray-400 text-xs">{status}</span>;
}

export default function MonitorPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<MonitorData>({
    queryKey: ['monitor-jobs', statusFilter, typeFilter],
    refetchInterval: autoRefresh ? 5000 : false,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '150' });
      if (statusFilter !== 'all') params.set('status', statusFilter.toUpperCase());
      if (typeFilter !== 'all') params.set('type', typeFilter);
      const res = await apiClient.get(`/jobs?${params.toString()}`);
      return res.data as MonitorData;
    },
  });

  const jobs = data?.jobs ?? [];
  const counts = data?.counts ?? {};
  const todayCounts = data?.todayCounts ?? {};

  const running = (counts['RUNNING'] ?? 0);
  const queued = (counts['QUEUED'] ?? 0) + (counts['PENDING'] ?? 0);
  const doneToday = todayCounts['COMPLETED'] ?? 0;
  const failedToday = todayCounts['FAILED'] ?? 0;

  const uniqueTypes = Array.from(new Set(jobs.map((j) => j.type))).sort();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[#9d6ff0] to-[#7c4fd8] rounded-xl flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">AI Job Monitor</h1>
            <p className="text-sm text-gray-500">Real-time view of all pipeline jobs across your projects</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-gray-400">Updated {timeAgo(new Date(dataUpdatedAt).toISOString())}</span>
          )}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${autoRefresh ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
          >
            <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={() => void refetch()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          tone="periwinkle"
          icon={<Play className="w-5 h-5" />}
          label="Running"
          value={running}
          sub={running > 0 ? 'Active now' : 'Idle'}
          subClassName={running > 0 ? 'text-blue-700' : 'text-gray-500'}
        />
        <StatCard
          tone="cream"
          icon={<Clock className="w-5 h-5" />}
          label="Queued"
          value={queued}
          sub="Pending dispatch"
          subClassName="text-yellow-700"
        />
        <StatCard
          tone="lilac"
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="Done Today"
          value={doneToday}
          sub="Completed since midnight"
          subClassName="text-green-700"
        />
        <StatCard
          tone="pink"
          icon={<AlertCircle className="w-5 h-5" />}
          label="Failed Today"
          value={failedToday}
          sub={failedToday > 0 ? 'Needs attention' : 'All clear'}
          subClassName={failedToday > 0 ? 'text-red-700' : 'text-green-700'}
        />
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-gray-400 shrink-0" />
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          {STATUS_FILTER_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs font-medium rounded-lg capitalize transition-colors ${statusFilter === s ? 'bg-white shadow text-violet-700' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
        >
          <option value="all">All types</option>
          {uniqueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {(statusFilter !== 'all' || typeFilter !== 'all') && (
          <button
            onClick={() => { setStatusFilter('all'); setTypeFilter('all'); }}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{jobs.length} jobs</span>
      </div>

      {/* Jobs list */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {isLoading && jobs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span className="text-sm">Loading jobs…</span>
          </div>
        ) : jobs.length === 0 ? (
          <div className="py-16 text-center">
            <Activity className="w-10 h-10 mx-auto mb-3 text-gray-200" />
            <p className="text-sm text-gray-500">No jobs match the current filter.</p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 px-5 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <span>Status</span>
              <span>Job / Project</span>
              <span className="text-right">Duration</span>
              <span className="text-right">Started</span>
            </div>
            {jobs.map((job) => (
              <div
                key={job.id}
                className="grid grid-cols-[auto_1fr_auto_auto] gap-4 items-center px-5 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors last:border-0"
              >
                <StatusDot status={job.status} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${JOB_TYPE_COLORS[job.type] ?? 'bg-gray-100 text-gray-600'}`}>
                      {job.type.replace(/_/g, ' ')}
                    </span>
                    {job.error && (
                      <span className="text-xs text-red-500 truncate max-w-xs" title={job.error}>{job.error}</span>
                    )}
                  </div>
                  {job.project ? (
                    <Link
                      href={`/projects/${job.project.id}`}
                      className="text-xs text-gray-500 hover:text-violet-600 hover:underline truncate block mt-0.5"
                    >
                      {job.project.title}
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400 mt-0.5 block">No project</span>
                  )}
                </div>
                <span className="text-xs text-gray-500 text-right tabular-nums">
                  {job.status === 'COMPLETED' && job.startedAt && job.completedAt
                    ? elapsed(job.startedAt, job.completedAt)
                    : job.status === 'RUNNING' && job.startedAt
                    ? elapsed(job.startedAt)
                    : '—'}
                </span>
                <span className="text-xs text-gray-400 text-right tabular-nums whitespace-nowrap">
                  {job.startedAt ? timeAgo(job.startedAt) : timeAgo(job.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
