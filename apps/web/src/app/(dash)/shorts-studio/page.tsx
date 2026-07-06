'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, Loader2, Download, Wand2, CheckCircle2, XCircle, Clock, Film, Captions, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
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
  description: string | null;
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
  TOPIC_SEGMENTATION: 'Topics',
  HIGHLIGHT_DETECTION: 'Highlights',
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
  // Imported videos accordion: section bar + per-video expansion (matches
  // the Approvals history / Recent Jobs pattern)
  const [importedOpen, setImportedOpen] = useState(true);
  const [openVideoIds, setOpenVideoIds] = useState<Set<string>>(new Set());
  const [channelOpen, setChannelOpen] = useState(true);
  const [openChannelIds, setOpenChannelIds] = useState<Set<string>>(new Set());

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
          {/* Imported videos: section bar + per-video click-to-expand rows */}
          {imported.length > 0 && (
            <section className="mb-8">
              <div
                onClick={() => setImportedOpen((o) => !o)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setImportedOpen((o) => !o); } }}
                className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors shadow-sm"
              >
                {importedOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Imported videos</h2>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[11px] font-medium">{imported.length}</span>
                {importedOpen && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenVideoIds((prev) => prev.size === imported.length ? new Set() : new Set(imported.map((v) => v.id)));
                    }}
                    className="ml-auto text-xs text-brand-600 hover:underline"
                  >
                    {openVideoIds.size === imported.length ? 'Collapse all' : 'Expand all'}
                  </button>
                )}
              </div>
              {importedOpen && (
                <div className="space-y-2 mt-2">
                  {imported.map((v) => {
                    const open = openVideoIds.has(v.id);
                    return (
                      <div key={v.id} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                        <div
                          onClick={() => setOpenVideoIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
                            return next;
                          })}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenVideoIds((prev) => { const next = new Set(prev); if (next.has(v.id)) next.delete(v.id); else next.add(v.id); return next; }); } }}
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                        >
                          {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                          {v.thumbnailUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.thumbnailUrl} alt="" className="w-16 h-9 object-cover rounded-md shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900 truncate text-sm">{v.title}</p>
                            <p className="text-[11px] text-gray-400">
                              {fmtDuration(v.durationMs)}
                              {v._count.topicSegments > 0 ? ` · ${v._count.topicSegments} topics` : v._count.transcriptSegments > 0 ? ' · transcribed' : ''}
                            </p>
                          </div>
                          {v._count.topicSegments > 0 && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                        </div>
                        {open && (
                          <div className="px-4 pb-4 pt-1 border-t border-gray-50 flex items-start gap-4 flex-wrap">
                            <div className="flex-1 min-w-[240px]">
                              <AnalysisProgress importedVideoId={v.id} />
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); analyzeMutation.mutate(v.id); }}
                                disabled={analyzeMutation.isPending}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
                              >
                                {analyzeMutation.isPending && analyzeMutation.variables === v.id
                                  ? <Loader2 className="w-4 h-4 animate-spin" />
                                  : <Wand2 className="w-4 h-4" />}
                                Analyze
                              </button>
                              {v._count.topicSegments > 0 && (
                                <Link
                                  href={`/shorts-studio/videos/${v.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex items-center gap-1.5 px-3 py-1.5 border border-brand-200 text-brand-700 rounded-lg text-sm hover:bg-brand-50 justify-center"
                                >
                                  <Sparkles className="w-4 h-4" /> Results
                                </Link>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Channel library: section bar + per-video click-to-expand rows */}
          <section>
            <div
              onClick={() => setChannelOpen((o) => !o)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChannelOpen((o) => !o); } }}
              className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors shadow-sm"
            >
              {channelOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Channel videos</h2>
              {(channelVideos?.items?.length ?? 0) > 0 && (
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[11px] font-medium">{channelVideos!.items.length}</span>
              )}
              {channelOpen && (channelVideos?.items?.length ?? 0) > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const all = channelVideos!.items.map((v) => v.youtubeVideoId);
                    setOpenChannelIds((prev) => prev.size === all.length ? new Set() : new Set(all));
                  }}
                  className="ml-auto text-xs text-brand-600 hover:underline"
                >
                  {openChannelIds.size === (channelVideos?.items?.length ?? 0) ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>
            {channelOpen && (
              <div className="mt-2 space-y-2">
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
                {(channelVideos?.items ?? []).map((v) => {
                  const open = openChannelIds.has(v.youtubeVideoId);
                  const alreadyImported = importedIds.has(v.youtubeVideoId);
                  const toggle = () => setOpenChannelIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(v.youtubeVideoId)) next.delete(v.youtubeVideoId); else next.add(v.youtubeVideoId);
                    return next;
                  });
                  return (
                    <div key={v.youtubeVideoId} className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                      <div
                        onClick={toggle}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                        {v.thumbnailUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.thumbnailUrl} alt="" className="w-16 h-9 object-cover rounded-md shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{v.title}</p>
                          <p className="text-[11px] text-gray-400">{fmtDuration(v.durationMs)} · {fmtViews(v.viewCount)}</p>
                        </div>
                        {alreadyImported && <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />}
                      </div>
                      {open && (
                        <div className="px-4 pb-4 pt-2 border-t border-gray-50 flex items-start gap-4 flex-wrap">
                          {v.thumbnailUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.thumbnailUrl} alt="" className="w-48 rounded-lg shrink-0" />
                          )}
                          <div className="flex-1 min-w-[220px]">
                            {v.publishedAt && (
                              <p className="text-[11px] text-gray-400">Published {new Date(v.publishedAt).toLocaleDateString()}</p>
                            )}
                            {v.description && (
                              <p className="text-xs text-gray-600 mt-1 whitespace-pre-line line-clamp-5">{v.description}</p>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); importMutation.mutate(v.youtubeVideoId); }}
                              disabled={alreadyImported || importMutation.isPending}
                              className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
                            >
                              {alreadyImported ? <CheckCircle2 className="w-4 h-4" /> : importMutation.isPending && importMutation.variables === v.youtubeVideoId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                              {alreadyImported ? 'Imported' : 'Import for Shorts'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
