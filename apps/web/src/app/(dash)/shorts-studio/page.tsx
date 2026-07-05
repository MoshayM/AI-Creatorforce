'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, Loader2, Download, Wand2, CheckCircle2, XCircle, Clock, Film, Captions } from 'lucide-react';
import { api } from '@/lib/api';

interface Project {
  id: string;
  title: string;
  channelId: string;
  channel: { title: string };
}

interface ChannelVideo {
  youtubeVideoId: string;
  title: string;
  durationMs: number;
  thumbnailUrl: string | null;
  viewCount: number | null;
  publishedAt: string | null;
}

interface ImportedVideo {
  id: string;
  youtubeVideoId: string;
  title: string;
  durationMs: number;
  thumbnailUrl: string | null;
  transcriptStatus: 'PENDING' | 'YOUTUBE_CAPTIONS' | 'ASR_GENERATED' | 'FAILED';
  sourceAssetId: string | null;
  _count: { transcriptSegments: number; scenes: number; topicSegments: number };
}

interface AnalysisStatus {
  sourceDownloaded: boolean;
  counts: { transcriptSegments: number; scenes: number };
  pipeline: { status: string; error: string | null } | null;
  stages: Array<{ type: string; satisfied: boolean; job: { status: string; error: string | null } | null }>;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtViews(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`;
  return `${n} views`;
}

const STAGE_LABELS: Record<string, string> = {
  VIDEO_IMPORT: 'Import',
  TRANSCRIPT_ANALYSIS: 'Transcript',
  SCENE_DETECTION: 'Scenes',
};

function AnalysisProgress({ importedVideoId }: { importedVideoId: string }) {
  const { data: status } = useQuery<AnalysisStatus>({
    queryKey: ['shorts-analysis', importedVideoId],
    queryFn: () => api.shortsStudio.analysisStatus(importedVideoId).then((r) => r.data as AnalysisStatus),
    refetchInterval: (q) => {
      const s = q.state.data?.pipeline?.status;
      return s === 'RUNNING' || s === 'QUEUED' || s === 'PENDING' ? 4000 : false;
    },
  });
  if (!status) return null;

  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      {status.stages.map(({ type, satisfied, job }) => {
        const failed = job?.status === 'FAILED';
        const running = job?.status === 'RUNNING';
        return (
          <span
            key={type}
            title={failed ? job?.error ?? 'Failed' : undefined}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
              satisfied ? 'bg-green-100 text-green-700'
              : failed ? 'bg-red-100 text-red-700'
              : running ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-500'
            }`}
          >
            {satisfied ? <CheckCircle2 className="w-3 h-3" />
              : failed ? <XCircle className="w-3 h-3" />
              : running ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Clock className="w-3 h-3" />}
            {STAGE_LABELS[type] ?? type}
          </span>
        );
      })}
      {status.counts.transcriptSegments > 0 && (
        <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
          <Captions className="w-3 h-3" /> {status.counts.transcriptSegments} segments
        </span>
      )}
      {status.counts.scenes > 0 && (
        <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
          <Film className="w-3 h-3" /> {status.counts.scenes} scenes
        </span>
      )}
      {status.pipeline?.status === 'FAILED' && status.pipeline.error && (
        <span className="text-[11px] text-red-500 w-full">{status.pipeline.error}</span>
      )}
    </div>
  );
}

export default function ShortsStudioPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState('');

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.projects.list().then((r) => r.data as Project[]),
  });
  const project = projects.find((p) => p.id === projectId) ?? null;

  const { data: channelVideos, isLoading: loadingChannel, error: channelError } = useQuery<{ items: ChannelVideo[] }>({
    queryKey: ['shorts-channel-videos', project?.channelId],
    queryFn: () => api.shortsStudio.listChannelVideos(project!.channelId).then((r) => r.data as { items: ChannelVideo[] }),
    enabled: !!project,
    retry: false,
  });

  const { data: imported = [] } = useQuery<ImportedVideo[]>({
    queryKey: ['shorts-imported', projectId],
    queryFn: () => api.shortsStudio.listImported(projectId).then((r) => r.data as ImportedVideo[]),
    enabled: !!projectId,
  });
  const importedIds = new Set(imported.map((v) => v.youtubeVideoId));

  const importMutation = useMutation({
    mutationFn: (youtubeVideoId: string) => api.shortsStudio.importVideo(projectId, youtubeVideoId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['shorts-imported', projectId] }),
  });

  const analyzeMutation = useMutation({
    mutationFn: (importedVideoId: string) => api.shortsStudio.analyze(importedVideoId),
    onSuccess: (_res, importedVideoId) => {
      void qc.invalidateQueries({ queryKey: ['shorts-analysis', importedVideoId] });
      void qc.invalidateQueries({ queryKey: ['shorts-imported', projectId] });
    },
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clapperboard className="w-6 h-6 text-brand-600" /> Shorts Studio
          </h1>
          <p className="text-gray-500 mt-1">Turn a long-form video into publish-ready vertical Shorts</p>
        </div>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">Select a project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.title} — {p.channel?.title}</option>
          ))}
        </select>
      </div>

      {!projectId && (
        <div className="text-center py-20 text-gray-400">
          <Clapperboard className="w-10 h-10 mx-auto mb-3 opacity-40" />
          Pick a project above to browse its channel&apos;s videos.
        </div>
      )}

      {projectId && (
        <>
          {/* Imported videos + pipeline status */}
          {imported.length > 0 && (
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Imported videos</h2>
              <div className="space-y-3">
                {imported.map((v) => (
                  <div key={v.id} className="flex items-start gap-4 bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                    {v.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.thumbnailUrl} alt="" className="w-28 h-16 object-cover rounded-lg shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{v.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{fmtDuration(v.durationMs)}</p>
                      <AnalysisProgress importedVideoId={v.id} />
                    </div>
                    <button
                      onClick={() => analyzeMutation.mutate(v.id)}
                      disabled={analyzeMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 shrink-0"
                    >
                      {analyzeMutation.isPending && analyzeMutation.variables === v.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Wand2 className="w-4 h-4" />}
                      Analyze
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Channel library */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Channel videos</h2>
            {loadingChannel && (
              <div className="flex items-center gap-2 text-gray-400 py-10 justify-center">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading channel videos…
              </div>
            )}
            {!!channelError && (
              <div className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl p-4">
                Could not load channel videos — {(channelError as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'check that the channel is connected with YouTube access.'}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(channelVideos?.items ?? []).map((v) => (
                <div key={v.youtubeVideoId} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
                  {v.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.thumbnailUrl} alt="" className="w-24 h-14 object-cover rounded-lg shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 line-clamp-2">{v.title}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{fmtDuration(v.durationMs)} · {fmtViews(v.viewCount)}</p>
                  </div>
                  <button
                    onClick={() => importMutation.mutate(v.youtubeVideoId)}
                    disabled={importedIds.has(v.youtubeVideoId) || importMutation.isPending}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs shrink-0 border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {importedIds.has(v.youtubeVideoId) ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                    {importedIds.has(v.youtubeVideoId) ? 'Imported' : 'Import'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
