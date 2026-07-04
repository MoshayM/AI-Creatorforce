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

const PRESETS = [
  { value: 'LANDSCAPE', label: 'Landscape 16:9' },
  { value: 'VERTICAL',  label: 'Vertical 9:16' },
  { value: 'SQUARE',    label: 'Square 1:1' },
] as const;

export function FullProductionCard({ projectId, runningJob, progress }: Props) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<(typeof SCOPES)[number]['value']>('FULL');
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['value']>('LANDSCAPE');
  const [refreshMedia, setRefreshMedia] = useState(false);
  const [error, setError] = useState('');

  const { data: exportFiles = [] } = useQuery({
    queryKey: ['exports', projectId],
    queryFn: () => api.media.listExports(projectId).then((r) => r.data),
    refetchInterval: runningJob ? 15_000 : false,
  });

  const generate = useMutation({
    mutationFn: () => api.jobs.enqueue(projectId, 'FULL_PRODUCTION', {
      scope,
      preset,
      // Re-run media + render stages with the currently configured providers
      // (e.g. after adding a real voice key in Settings), keeping the script
      // pipeline cached
      ...(refreshMedia ? { regenerate: ['VOICE_GENERATE', 'IMAGE_GENERATE', 'MUSIC_GENERATE', 'VIDEO_GENERATE', 'EDIT_PLAN', 'RENDER'] } : {}),
    }),
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
    <div className="bg-gradient-to-r from-[#7c4fd8] to-[#9d6ff0] rounded-2xl p-6 mb-5 text-white shadow-lg shadow-[#9d6ff0]/30">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shrink-0">
            <Clapperboard className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <p className="font-semibold">AI Video Production Studio</p>
            <p className="text-sm text-white/80 mt-0.5 max-w-xl">{scopeMeta.hint}</p>
            <p className="text-xs text-white/60 mt-1 flex items-center gap-1">
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
              className="bg-white/15 border border-white/25 rounded-full px-3 py-2 text-sm text-white [&>option]:text-gray-800"
            >
              {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as typeof preset)}
              className="bg-white/15 border border-white/25 rounded-full px-3 py-2 text-sm text-white [&>option]:text-gray-800"
            >
              {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <button
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="flex items-center gap-2 px-6 py-2 bg-white text-brand-700 hover:bg-brand-50 rounded-full text-sm font-bold disabled:opacity-50 shadow-md"
            >
              {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Generate
            </button>
          </div>
        )}
      </div>

      {!runningJob && (
        <label className="mt-3 flex items-center gap-2 text-xs text-white/70 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={refreshMedia}
            onChange={(e) => setRefreshMedia(e.target.checked)}
            className="rounded border-white/40 bg-white/15"
          />
          Regenerate media with current providers (ignores cached voice/music/images and re-renders)
        </label>
      )}

      {error && <p className="mt-3 text-sm text-red-100 bg-red-500/30 rounded-lg px-3 py-1.5 w-fit">{error}</p>}

      {runningJob && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
              {progress ? progress.stage : 'Starting pipeline…'}
            </span>
            <span className="flex items-center gap-3 text-white/70 text-xs tabular-nums">
              <ElapsedBadge since={runningJob.startedAt ?? runningJob.createdAt} className="!text-white/70" />
              {progress && progress.etaSecs > 0 && <span>~{formatElapsed(progress.etaSecs)} remaining</span>}
              {progress && <span>{progress.index}/{progress.count} stages</span>}
            </span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-700"
              style={{ width: `${Math.max(pct, 3)}%` }}
            />
          </div>
        </div>
      )}

      {exportFiles.length > 0 && (
        <div className="mt-4 border-t border-white/20 pt-4">
          <p className="text-xs font-semibold text-white/70 uppercase tracking-wide mb-2">Upload-Ready Package</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {exportFiles.map((f) => (
              <button
                key={f.name}
                onClick={() => void download(f.name)}
                className="flex items-center gap-2 px-3 py-2 bg-white/95 hover:bg-white rounded-xl text-left text-sm text-gray-800 shadow-sm transition-colors"
              >
                {fileIcon(f.name)}
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{formatSize(f.sizeBytes)}</span>
                <Download className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
