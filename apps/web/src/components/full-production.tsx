'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, Play, Loader2, Download, FileVideo, FileAudio, FileImage, FileText, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { ElapsedBadge, formatElapsed } from '@/components/ai-activity';
import { getErrorMessage } from '@/lib/getErrorMessage';

export interface PipelineProgress {
  stage: string;
  index: number;
  count: number;
  etaSecs: number;
}

const SCOPES = [
  { value: 'FULL', label: 'Full Production', hint: 'Research → script → compliance → voice, music, images, video → rendered MP4 + upload-ready package' },
  { value: 'VOICE', label: 'Voice Only', hint: 'Script pipeline + voice-over narration' },
  { value: 'MUSIC', label: 'Music Only', hint: 'Script pipeline + background music track' },
  { value: 'IMAGES', label: 'Images Only', hint: 'Script pipeline + scene images' },
  { value: 'VIDEO', label: 'Video Only', hint: 'Storyboard + scene images + scene videos' },
] as const;

function fileIcon(name: string) {
  if (/\.(mp4|mov|webm)$/i.test(name)) return <FileVideo className="w-4 h-4 text-brand-600" />;
  if (/\.(mp3|wav)$/i.test(name)) return <FileAudio className="w-4 h-4 text-purple-600" />;
  if (/\.(png|jpg|jpeg)$/i.test(name)) return <FileImage className="w-4 h-4 text-green-600" />;
  return <FileText className="w-4 h-4 text-gray-400" />;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

interface Props {
  projectId: string;
  runningJob: { id: string; startedAt?: string | null; createdAt: string } | null;
  progress: PipelineProgress | null;
}

export function FullProductionCard({ projectId, runningJob, progress }: Props) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<(typeof SCOPES)[number]['value']>('FULL');
  const [error, setError] = useState('');

  const { data: exportFiles = [] } = useQuery({
    queryKey: ['exports', projectId],
    queryFn: () => api.media.listExports(projectId).then((r) => r.data),
    refetchInterval: runningJob ? 15_000 : false,
  });

  const generate = useMutation({
    mutationFn: () => api.jobs.enqueue(projectId, 'FULL_PRODUCTION', { scope }),
    onMutate: () => setError(''),
    onError: (err: unknown) => setError(getErrorMessage(err) || 'Failed to start production'),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  async function download(fileName: string) {
    const res = await api.media.downloadExport(projectId, fileName);
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  const pct = progress && progress.count > 0 ? Math.round((progress.index / progress.count) * 100) : 0;
  const scopeMeta = SCOPES.find((s) => s.value === scope)!;

  return (
    <div className="bg-gradient-to-r from-gray-900 to-gray-800 rounded-xl p-6 mb-5 text-white">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shrink-0">
            <Clapperboard className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold">AI Video Production Studio</p>
            <p className="text-sm text-gray-400 mt-0.5 max-w-xl">{scopeMeta.hint}</p>
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Compliance-gated · publishing always needs your approval
            </p>
          </div>
        </div>

        {!runningJob && (
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-700 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Generate
            </button>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {runningJob && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
              {progress ? progress.stage : 'Starting pipeline…'}
            </span>
            <span className="flex items-center gap-3 text-gray-400 text-xs tabular-nums">
              <ElapsedBadge since={runningJob.startedAt ?? runningJob.createdAt} className="!text-gray-400" />
              {progress && progress.etaSecs > 0 && <span>~{formatElapsed(progress.etaSecs)} remaining</span>}
              {progress && <span>{progress.index}/{progress.count} stages</span>}
            </span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-700"
              style={{ width: `${Math.max(pct, 3)}%` }}
            />
          </div>
        </div>
      )}

      {exportFiles.length > 0 && (
        <div className="mt-4 border-t border-gray-700 pt-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Upload-Ready Package</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {exportFiles.map((f) => (
              <button
                key={f.name}
                onClick={() => void download(f.name)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-left text-sm transition-colors"
              >
                {fileIcon(f.name)}
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-gray-500 shrink-0">{formatSize(f.sizeBytes)}</span>
                <Download className="w-3.5 h-3.5 text-gray-500 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
