'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, Loader2, Download, Wand2, CheckCircle2, XCircle, Clock, Film, Captions, Sparkles, ChevronDown, ChevronRight, Search, X, FolderDown } from 'lucide-react';
import { api, type LibraryVideosPage } from '@/lib/api';

interface Channel {
  id: string;
  title: string;
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

const CHANNEL_LS_KEY = 'cf.shorts.channelId';

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
        <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
          <Captions className="w-3 h-3" /> {status.counts.transcriptSegments} segments
        </span>
      )}
      {status.counts.scenes > 0 && (
        <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
          <Film className="w-3 h-3" /> {status.counts.scenes} scenes
        </span>
      )}
      {status.pipeline?.status === 'FAILED' && status.pipeline.error && (
        <span className="text-[11px] text-red-500 w-full">{status.pipeline.error}</span>
      )}
    </div>
  );
}

/**
 * Manual import picker: the user searches the channel's synced library and
 * imports only the videos they tick — nothing is imported automatically.
 */
function LibraryImportModal({
  channelId,
  importedYoutubeIds,
  onClose,
}: {
  channelId: string;
  importedYoutubeIds: Set<string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importedNow, setImportedNow] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const {
    data: libraryData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery({
    queryKey: ['shorts-library-videos', channelId, q],
    queryFn: ({ pageParam }) =>
      api.library
        .listVideos(channelId, { cursor: pageParam as string | undefined, q: q || undefined })
        .then((r) => r.data as LibraryVideosPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const videos = libraryData?.pages.flatMap((p) => p.data) ?? [];

  const isImported = (youtubeVideoId: string) =>
    importedYoutubeIds.has(youtubeVideoId) || importedNow.has(youtubeVideoId);

  const toggle = (youtubeVideoId: string) => {
    if (isImported(youtubeVideoId)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(youtubeVideoId)) next.delete(youtubeVideoId); else next.add(youtubeVideoId);
      return next;
    });
  };

  const importSelected = async () => {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    setImportError(null);
    const failed: string[] = [];
    // One at a time on purpose: each import is a user-visible row landing in
    // the studio, and sequential requests keep partial failures attributable.
    for (const youtubeVideoId of selected) {
      try {
        await api.shortsStudio.importVideo(channelId, youtubeVideoId);
        setImportedNow((prev) => new Set(prev).add(youtubeVideoId));
        setSelected((prev) => { const next = new Set(prev); next.delete(youtubeVideoId); return next; });
      } catch (err) {
        const title = videos.find((v) => v.youtubeVideoId === youtubeVideoId)?.title ?? youtubeVideoId;
        const msg = (err as { response?: { data?: { message?: string } } }).response?.data?.message;
        failed.push(msg ? `${title}: ${msg}` : title);
      }
    }
    void qc.invalidateQueries({ queryKey: ['shorts-imported', channelId] });
    setImporting(false);
    if (failed.length > 0) {
      setImportError(`Could not import ${failed.length} video${failed.length > 1 ? 's' : ''} — ${failed.join('; ')}`);
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Import videos from library"
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <FolderDown className="w-5 h-5 text-brand-600" />
          <h2 className="text-base font-semibold text-gray-900">Import from library</h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search library videos…"
              aria-label="Search library videos"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-500 py-10 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading library…
            </div>
          )}
          {!!error && (
            <div className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl p-4">
              Could not load the library — {(error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'run a channel sync from the Library page first.'}
            </div>
          )}
          {!isLoading && !error && videos.length === 0 && (
            <div className="text-center py-10 text-gray-500 text-sm">
              {q ? 'No library videos match your search.' : 'No videos in the library yet — sync this channel from the Library page.'}
            </div>
          )}
          {videos.map((v) => {
            const imported = isImported(v.youtubeVideoId);
            const checked = selected.has(v.youtubeVideoId);
            return (
              <label
                key={v.id}
                className={`flex items-center gap-3 px-3 py-2.5 border rounded-xl transition-colors ${
                  imported ? 'border-gray-100 bg-gray-50 opacity-70'
                  : checked ? 'border-brand-300 bg-brand-50/50 cursor-pointer'
                  : 'border-gray-100 hover:bg-gray-50 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={imported || importing}
                  onChange={() => toggle(v.youtubeVideoId)}
                  className="w-4 h-4 accent-brand-600 shrink-0"
                  aria-label={`Select ${v.title}`}
                />
                {v.thumbnailUrl && (
                  <img src={v.thumbnailUrl} alt="" className="w-16 h-9 object-cover rounded-md shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{v.title}</p>
                  <p className="text-[11px] text-gray-500">
                    {fmtDuration(v.durationMs)} · {fmtViews(v.viewCount)}
                    {v.kind === 'short' && <span className="ml-2 px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded-full font-medium">Short</span>}
                  </p>
                </div>
                {imported && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Imported
                  </span>
                )}
              </label>
            );
          })}
          {hasNextPage && (
            <button
              onClick={() => void fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full py-2.5 text-sm text-brand-600 border border-gray-100 rounded-xl hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin" />} Load more
            </button>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100">
          {importError && (
            <p className="text-xs text-red-500 mb-3">{importError}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              {importedNow.size > 0 ? 'Done' : 'Cancel'}
            </button>
            <button
              onClick={() => void importSelected()}
              disabled={selected.size === 0 || importing}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {importing ? 'Importing…' : `Import selected${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ShortsStudioPage() {
  const qc = useQueryClient();
  const [channelId, setChannelId] = useState('');
  // Imported videos accordion: section bar + per-video expansion (matches
  // the Approvals history / Recent Jobs pattern)
  const [importedOpen, setImportedOpen] = useState(true);
  const [openVideoIds, setOpenVideoIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  // Restore last channel, else auto-select the first one
  useEffect(() => {
    if (channelId || channels.length === 0) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem(CHANNEL_LS_KEY) : null;
    const restored = stored && channels.some((c) => c.id === stored) ? stored : channels[0]!.id;
    setChannelId(restored);
  }, [channelId, channels]);

  const selectChannel = (id: string) => {
    setChannelId(id);
    if (id) localStorage.setItem(CHANNEL_LS_KEY, id);
  };

  const { data: imported = [] } = useQuery<ImportedVideo[]>({
    queryKey: ['shorts-imported', channelId],
    queryFn: () => api.shortsStudio.listImported(channelId).then((r) => r.data as ImportedVideo[]),
    enabled: !!channelId,
  });
  const importedIds = new Set(imported.map((v) => v.youtubeVideoId));

  const analyzeMutation = useMutation({
    mutationFn: (importedVideoId: string) => api.shortsStudio.analyze(importedVideoId),
    onSuccess: (_res, importedVideoId) => {
      void qc.invalidateQueries({ queryKey: ['shorts-analysis', importedVideoId] });
      void qc.invalidateQueries({ queryKey: ['shorts-imported', channelId] });
    },
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clapperboard className="w-6 h-6 text-brand-600" /> Shorts Studio
          </h1>
          <p className="text-gray-500 mt-1">Turn a long-form video into publish-ready vertical Shorts</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={channelId}
            onChange={(e) => selectChannel(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            aria-label="Channel"
          >
            <option value="">Select a channel…</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          <button
            onClick={() => setPickerOpen(true)}
            disabled={!channelId}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-40"
          >
            <FolderDown className="w-4 h-4" /> Import from library
          </button>
        </div>
      </div>

      {!channelId && (
        <div className="text-center py-20 text-gray-500">
          <Clapperboard className="w-10 h-10 mx-auto mb-3 opacity-40" />
          Pick a channel above to get started.
        </div>
      )}

      {channelId && imported.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <FolderDown className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="mb-4">No videos in Shorts Studio yet.</p>
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700"
          >
            <FolderDown className="w-4 h-4" /> Import videos from library
          </button>
        </div>
      )}

      {/* Imported videos: section bar + per-video click-to-expand rows */}
      {channelId && imported.length > 0 && (
        <section>
          <div
            onClick={() => setImportedOpen((o) => !o)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setImportedOpen((o) => !o); } }}
            className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors shadow-sm"
          >
            {importedOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
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
                      {open ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />}
                      {v.thumbnailUrl && (
                        <img src={v.thumbnailUrl} alt="" className="w-16 h-9 object-cover rounded-md shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate text-sm">{v.title}</p>
                        <p className="text-[11px] text-gray-500">
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

      {pickerOpen && channelId && (
        <LibraryImportModal
          channelId={channelId}
          importedYoutubeIds={importedIds}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
