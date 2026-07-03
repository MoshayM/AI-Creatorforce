'use client';
import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle, XCircle, Clock, Play, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useProjectJobEvents } from '@/hooks/use-job-events';
import { ElapsedBadge, formatDuration } from '@/components/ai-activity';
import { useSearchParams } from 'next/navigation';

interface AgentJob {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  project?: { title: string; id: string };
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
  COMPLETED:        { icon: <CheckCircle className="w-4 h-4" />,   cls: 'bg-green-100 text-green-700',  label: 'Completed' },
  FAILED:           { icon: <XCircle className="w-4 h-4" />,       cls: 'bg-red-100 text-red-700',      label: 'Failed' },
  RUNNING:          { icon: <Loader2 className="w-4 h-4 animate-spin" />, cls: 'bg-blue-100 text-blue-700', label: 'Running' },
  WAITING_APPROVAL: { icon: <Clock className="w-4 h-4" />,         cls: 'bg-orange-100 text-orange-700', label: 'Awaiting Approval' },
  QUEUED:           { icon: <Clock className="w-4 h-4" />,         cls: 'bg-gray-100 text-gray-600',    label: 'Queued' },
  PENDING:          { icon: <Clock className="w-4 h-4" />,         cls: 'bg-gray-100 text-gray-400',    label: 'Pending' },
  CANCELLED:        { icon: <AlertCircle className="w-4 h-4" />,   cls: 'bg-gray-100 text-gray-500',    label: 'Cancelled' },
};

function JobRow({ job }: { job: AgentJob }) {
  const cfg = STATUS_CONFIG[job.status] ?? { icon: <Play className="w-4 h-4" />, cls: 'bg-gray-100 text-gray-600', label: job.status };

  const durationMs = job.startedAt && job.completedAt
    ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
    : null;

  return (
    <div className="px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-gray-900 text-sm">{job.type}</p>
            {job.project && (
              <span className="text-xs text-gray-400 truncate">· {job.project.title}</span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{new Date(job.createdAt).toLocaleString()}</p>
          {job.error && (
            <p className="text-xs text-red-500 mt-1 truncate max-w-md" title={job.error}>{job.error}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {job.status === 'RUNNING' && (
            <ElapsedBadge since={job.startedAt ?? job.createdAt} />
          )}
          {durationMs !== null && (
            <span className="text-xs text-gray-400">{formatDuration(durationMs)}</span>
          )}
          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.cls}`}>
            {cfg.icon}
            {cfg.label}
          </span>
        </div>
      </div>
    </div>
  );
}

function JobsForProject({ projectId }: { projectId: string }) {
  useProjectJobEvents(projectId);

  const { data: jobs = [], isLoading } = useQuery<AgentJob[]>({
    queryKey: ['jobs', 'project', projectId],
    queryFn: () => api.jobs.listByProject(projectId).then((r) => r.data as AgentJob[]),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>;
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-10 text-gray-400">
        <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No jobs for this project yet.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {jobs.map((job) => <JobRow key={job.id} job={job} />)}
    </div>
  );
}

function JobsContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');

  return (
    <>
      {projectId ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-medium text-gray-600">Jobs for project</p>
          </div>
          <JobsForProject projectId={projectId} />
        </div>
      ) : (
        <div className="text-center py-20 text-gray-400">
          <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-sm">Select a project to view its jobs.</p>
          <p className="text-xs mt-1 text-gray-300">Navigate here from the Projects page to monitor running agents.</p>
        </div>
      )}
    </>
  );
}

export default function JobsPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Agent Jobs</h1>
        <p className="text-gray-500 mt-1">Monitor AI processing tasks in real time</p>
      </div>
      <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-brand-600" /></div>}>
        <JobsContent />
      </Suspense>
    </div>
  );
}
