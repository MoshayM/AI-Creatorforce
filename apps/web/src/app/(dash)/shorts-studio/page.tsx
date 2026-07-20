'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clapperboard, Loader2, Download, Wand2, CheckCircle2, XCircle,
  Clock, Film, Captions, Sparkles, ChevronDown, ChevronRight,
  Search, X, FolderDown, ListVideo, Trash2,
} from 'lucide-react';
import { api, type LibraryVideo, type LibraryPlaylist, type LibraryVideosPage, type LibraryPlaylistsPage, type LibraryPlaylistItemsPage } from '@/lib/api';
import { JobErrorCard } from '@/components/job-error-card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Channel { id: string; title: string; }

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
  pipeline: { status: string; error: string | null; errorCode?: string | null; retryable?: boolean } | null;
  stages: Array<{ type: string; satisfied: boolean; job: { status: string; error: string | null; errorCode?: string | null; retryable?: boolean } | null }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const PROGRESS_LABELS: Record<string, string> = {
  VIDEO_IMPORT: 'Downloading video',
  TRANSCRIPT_ANALYSIS: 'Generating transcript',
  SCENE_DETECTION: 'Detecting scenes',
  TOPIC_SEGMENTATION: 'Generating embeddings',
  HIGHLIGHT_DETECTION: 'Creating shorts',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SendToEditorButton({ importedVideoId }: { importedVideoId: string }) {
  const router = useRouter();
  const create = useMutation({
    mutationFn: () => api.editor.createFromImported(importedVideoId).then((r) => r.data),
    onSuccess: (data) => router.push(`/editor/${data.id}?autoEdit=1`),
  });
  return (
    <button
      onClick={(e) => { e.stopPropagation(); create.mutate(); }}
      disabled={create.isPending}
      title="Open this video in the full Video Editor"
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all hover:border-[#6D4AE0]/40 disabled:opacity-50"
      style={{ border: '1.5px solid #e3ddf8', color: '#6D4AE0', background: 'white' }}
    >
      {create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />}
      Video Edit
    </button>
  );
}

function DeleteFromImportedButton({ video, channelId }: { video: ImportedVideo; channelId: string }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.shortsStudio.deleteImported(video.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['shorts-imported', channelId] }); },
  });
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (window.confirm(`Delete "${video.title}" from imported videos? Its transcript, scenes, topics and chapters will be removed. The library copy is not affected.`)) {
          del.mutate();
        }
      }}
      disabled={del.isPending}
      title="Delete this video from Shorts Studio"
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all hover:bg-red-50 disabled:opacity-50"
      style={{ border: '1.5px solid #fecaca', color: '#dc2626', background: 'white' }}
    >
      {del.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      Delete
    </button>
  );
}

function AnalysisProgress({ importedVideoId, onRetry }: { importedVideoId: string; onRetry?: () => void }) {
  const { data: status } = useQuery<AnalysisStatus>({
    queryKey: ['shorts-analysis', importedVideoId],
    queryFn: () => api.shortsStudio.analysisStatus(importedVideoId).then((r) => r.data as AnalysisStatus),
    refetchInterval: (q) => {
      const s = q.state.data?.pipeline?.status;
      return s === 'RUNNING' || s === 'QUEUED' || s === 'PENDING' ? 4000 : false;
    },
  });
  if (!status) return null;

  const runningStage = status.stages.find(({ job }) => job?.status === 'RUNNING');
  const progressLabel = runningStage ? (PROGRESS_LABELS[runningStage.type] ?? STAGE_LABELS[runningStage.type] ?? runningStage.type) : null;
  const pipelineFailed = status.pipeline?.status === 'FAILED';

  const stagePill = (satisfied: boolean, failed: boolean, running: boolean) => {
    if (satisfied) return { bg: '#ecfdf5', color: '#065f46', dot: <CheckCircle2 className="w-3 h-3" /> };
    if (failed)    return { bg: '#fff5f5', color: '#dc2626', dot: <XCircle className="w-3 h-3" /> };
    if (running)   return { bg: '#eff6ff', color: '#3b82f6', dot: <Loader2 className="w-3 h-3 animate-spin" /> };
    return         { bg: '#f3f4f6', color: '#6b7280', dot: <Clock className="w-3 h-3" /> };
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {status.stages.map(({ type, satisfied, job }) => {
          const failed  = job?.status === 'FAILED';
          const running = job?.status === 'RUNNING';
          const pill = stagePill(satisfied, failed, running);
          return (
            <span
              key={type}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
              style={{ background: pill.bg, color: pill.color }}
            >
              {pill.dot}
              {STAGE_LABELS[type] ?? type}
            </span>
          );
        })}
        {status.counts.transcriptSegments > 0 && (
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
            <Captions className="w-3 h-3" /> {status.counts.transcriptSegments} segs
          </span>
        )}
        {status.counts.scenes > 0 && (
          <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
            <Film className="w-3 h-3" /> {status.counts.scenes} scenes
          </span>
        )}
        {progressLabel && (
          <span className="text-[11px] inline-flex items-center gap-1" style={{ color: '#6D4AE0' }}>
            <Loader2 className="w-3 h-3 animate-spin" /> {progressLabel}
          </span>
        )}
      </div>
      {pipelineFailed && (
        <JobErrorCard
          error={status.pipeline?.error}
          errorCode={status.pipeline?.errorCode}
          retryable={status.pipeline?.retryable}
          onRetry={onRetry}
          className="mt-1"
        />
      )}
    </div>
  );
}

// ── Library picker sub-components ─────────────────────────────────────────────

interface VideoRowProps {
  video: LibraryVideo;
  imported: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: (youtubeVideoId: string) => void;
}

function VideoRow({ video: v, imported, checked, disabled, onToggle }: VideoRowProps) {
  return (
    <label
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer"
      style={
        imported ? { border: '1.5px solid #f3f4f6', background: '#fafafa', opacity: 0.7, cursor: 'not-allowed' }
        : checked  ? { border: '2px solid #6D4AE0', background: '#f5f2fd' }
        : { border: '1.5px solid #e3ddf8', background: 'white' }
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={imported || disabled}
        onChange={() => onToggle(v.youtubeVideoId)}
        className="w-4 h-4 shrink-0"
        style={{ accentColor: '#6D4AE0' }}
        aria-label={`Select ${v.title}`}
      />
      {v.thumbnailUrl && (
        <img src={v.thumbnailUrl} alt="" className="w-16 h-9 object-cover rounded-lg shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900 truncate">{v.title}</p>
        <p className="text-[11px] text-gray-400">
          {fmtDuration(v.durationMs)} · {fmtViews(v.viewCount)}
          {v.kind === 'short' && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full font-semibold text-[10px]" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>Short</span>
          )}
        </p>
      </div>
      {imported && (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold shrink-0" style={{ color: '#10b981' }}>
          <CheckCircle2 className="w-3.5 h-3.5" /> Imported
        </span>
      )}
    </label>
  );
}

function GroupBar({ open, onToggle, icon, title, count }: {
  open: boolean; onToggle: () => void;
  icon: React.ReactNode; title: string; count?: number;
}) {
  return (
    <div
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      className="flex items-center gap-2 rounded-xl px-3 py-2.5 cursor-pointer transition-all hover:border-[#6D4AE0]/30"
      style={{ border: '1.5px solid #e3ddf8', background: 'white' }}
    >
      {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
      {icon}
      <p className="text-sm font-semibold text-gray-800 truncate flex-1">{title}</p>
      {count != null && (
        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>{count}</span>
      )}
    </div>
  );
}

function LoadMoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full py-2 text-sm font-semibold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 hover:border-[#6D4AE0]/30"
      style={{ border: '1.5px solid #e3ddf8', color: '#6D4AE0', background: 'white' }}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />} Load more
    </button>
  );
}

function PlaylistGroup({ channelId, playlist, renderVideo }: {
  channelId: string; playlist: LibraryPlaylist;
  renderVideo: (v: LibraryVideo) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['shorts-playlist-items', channelId, playlist.id],
    queryFn: ({ pageParam }) =>
      api.library.listPlaylistItems(channelId, playlist.id, pageParam as string | undefined)
        .then((r) => r.data as LibraryPlaylistItemsPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
  });
  const items = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div>
      <GroupBar open={open} onToggle={() => setOpen((o) => !o)}
        icon={<ListVideo className="w-4 h-4 shrink-0" style={{ color: '#6D4AE0' }} />}
        title={playlist.title} count={playlist.itemCount} />
      {open && (
        <div className="mt-1.5 ml-4 space-y-1.5">
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-400 py-4 justify-center text-sm">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#6D4AE0' }} /> Loading playlist…
            </div>
          )}
          {!isLoading && items.length === 0 && <p className="text-center py-4 text-gray-400 text-sm">This playlist has no videos.</p>}
          {items.map((item) => renderVideo(item.video))}
          {hasNextPage && <LoadMoreButton onClick={() => void fetchNextPage()} loading={isFetchingNextPage} />}
        </div>
      )}
    </div>
  );
}

function KindVideosGroup({ channelId, kind, title, icon, renderVideo }: {
  channelId: string; kind: 'video' | 'short'; title: string;
  icon: React.ReactNode; renderVideo: (v: LibraryVideo) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error } = useInfiniteQuery({
    queryKey: ['shorts-library-videos', channelId, kind],
    queryFn: ({ pageParam }) =>
      api.library.listVideos(channelId, { cursor: pageParam as string | undefined, type: kind })
        .then((r) => r.data as LibraryVideosPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: open,
  });
  const videos = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div>
      <GroupBar open={open} onToggle={() => setOpen((o) => !o)} icon={icon} title={title} />
      {open && (
        <div className="mt-1.5 ml-4 space-y-1.5">
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-400 py-4 justify-center text-sm">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#6D4AE0' }} /> Loading…
            </div>
          )}
          {!!error && (
            <div className="text-sm rounded-2xl p-4" style={{ background: '#fff5f5', border: '1.5px solid #fecaca', color: '#dc2626' }}>
              Could not load the library — {(error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'run a channel sync from the Library page first.'}
            </div>
          )}
          {!isLoading && !error && videos.length === 0 && (
            <p className="text-center py-4 text-gray-400 text-sm">Nothing here yet — sync this channel from the Library page.</p>
          )}
          {videos.map(renderVideo)}
          {hasNextPage && <LoadMoreButton onClick={() => void fetchNextPage()} loading={isFetchingNextPage} />}
        </div>
      )}
    </div>
  );
}

function SearchResults({ channelId, q, renderVideo }: {
  channelId: string; q: string; renderVideo: (v: LibraryVideo) => React.ReactNode;
}) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error } = useInfiniteQuery({
    queryKey: ['shorts-library-search', channelId, q],
    queryFn: ({ pageParam }) =>
      api.library.listVideos(channelId, { cursor: pageParam as string | undefined, q })
        .then((r) => r.data as LibraryVideosPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const videos = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="space-y-1.5">
      {isLoading && (
        <div className="flex items-center gap-2 text-gray-400 py-4 justify-center text-sm">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#6D4AE0' }} /> Searching…
        </div>
      )}
      {!!error && (
        <div className="text-sm rounded-2xl p-4" style={{ background: '#fff5f5', border: '1.5px solid #fecaca', color: '#dc2626' }}>
          {(error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Search failed.'}
        </div>
      )}
      {!isLoading && !error && videos.length === 0 && (
        <p className="text-center py-4 text-gray-400 text-sm">No library videos match your search.</p>
      )}
      {videos.map(renderVideo)}
      {hasNextPage && <LoadMoreButton onClick={() => void fetchNextPage()} loading={isFetchingNextPage} />}
    </div>
  );
}

// ── Import modal ──────────────────────────────────────────────────────────────

function LibraryImportModal({
  channelId, importedYoutubeIds, onClose,
}: {
  channelId: string; importedYoutubeIds: Set<string>; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [importing, setImporting] = useState(false);
  const [importedNow, setImportedNow] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const {
    data: playlistsData, fetchNextPage: fetchMorePlaylists,
    hasNextPage: hasMorePlaylists, isFetchingNextPage: fetchingPlaylists, isLoading: loadingPlaylists,
  } = useInfiniteQuery({
    queryKey: ['shorts-library-playlists', channelId],
    queryFn: ({ pageParam }) =>
      api.library.listPlaylists(channelId, pageParam as string | undefined)
        .then((r) => r.data as LibraryPlaylistsPage),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !q,
  });
  const playlists = playlistsData?.pages.flatMap((p) => p.data) ?? [];

  const isImported = (youtubeVideoId: string) =>
    importedYoutubeIds.has(youtubeVideoId) || importedNow.has(youtubeVideoId);

  const renderVideo = (v: LibraryVideo) => (
    <VideoRow
      key={v.id} video={v} imported={isImported(v.youtubeVideoId)}
      checked={selected.has(v.youtubeVideoId)} disabled={importing}
      onToggle={(youtubeVideoId) => {
        if (isImported(youtubeVideoId)) return;
        setSelected((prev) => {
          const next = new Map(prev);
          if (next.has(youtubeVideoId)) next.delete(youtubeVideoId); else next.set(youtubeVideoId, v.title);
          return next;
        });
      }}
    />
  );

  const importSelected = async () => {
    if (selected.size === 0 || importing) return;
    setImporting(true);
    setImportError(null);
    const failed: string[] = [];
    for (const [youtubeVideoId, title] of selected) {
      try {
        await api.shortsStudio.importVideo(channelId, youtubeVideoId);
        setImportedNow((prev) => new Set(prev).add(youtubeVideoId));
        setSelected((prev) => { const next = new Map(prev); next.delete(youtubeVideoId); return next; });
      } catch (err) {
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,10,40,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import videos from library"
        className="bg-white rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden"
        style={{ border: '1.5px solid #e3ddf8' }}
      >
        {/* Modal header */}
        <div className="flex items-center gap-3 px-6 py-5" style={{ borderBottom: '1.5px solid #f0edf9' }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#f5f2fd' }}>
            <FolderDown className="w-4 h-4" style={{ color: '#6D4AE0' }} />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-extrabold text-gray-900">Import from library</h2>
            <p className="text-xs text-gray-400">Select videos to bring into Shorts Studio</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors text-lg leading-none">
            ×
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4 pb-2">
          <div
            className="flex items-center gap-2 bg-white rounded-2xl transition-all focus-within:ring-2 focus-within:ring-[#6D4AE0]/20 focus-within:border-[#6D4AE0]"
            style={{ border: '1.5px solid #e3e0f0' }}
          >
            <Search className="w-4 h-4 text-gray-400 ml-3.5 shrink-0" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search across all library videos…"
              aria-label="Search library videos"
              className="flex-1 bg-transparent px-2 py-3 text-sm text-gray-800 placeholder-gray-400 outline-none"
            />
            {q && (
              <button onClick={() => setQ('')} className="mr-2 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Video list */}
        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-2">
          {q ? (
            <SearchResults channelId={channelId} q={q} renderVideo={renderVideo} />
          ) : (
            <>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 px-1 pt-1">Shorts</p>
              <KindVideosGroup
                channelId={channelId} kind="short" title="All Shorts"
                icon={<Clapperboard className="w-4 h-4 shrink-0" style={{ color: '#6D4AE0' }} />}
                renderVideo={renderVideo}
              />
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 px-1 pt-2">Videos</p>
              {loadingPlaylists && (
                <div className="flex items-center gap-2 text-gray-400 py-4 justify-center text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#6D4AE0' }} /> Loading playlists…
                </div>
              )}
              {playlists.map((p) => (
                <PlaylistGroup key={p.id} channelId={channelId} playlist={p} renderVideo={renderVideo} />
              ))}
              {hasMorePlaylists && <LoadMoreButton onClick={() => void fetchMorePlaylists()} loading={fetchingPlaylists} />}
              <KindVideosGroup
                channelId={channelId} kind="video" title="All videos"
                icon={<Film className="w-4 h-4 shrink-0" style={{ color: '#6D4AE0' }} />}
                renderVideo={renderVideo}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-5" style={{ borderTop: '1.5px solid #f0edf9' }}>
          {importError && (
            <JobErrorCard error={importError} errorCode="VIDEO_IMPORT_FAILED" className="mb-3" />
          )}
          <div className="flex items-center justify-between gap-3">
            <button onClick={onClose}
              className="px-5 py-2.5 rounded-2xl text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
              {importedNow.size > 0 ? 'Done' : 'Cancel'}
            </button>
            <button
              onClick={() => void importSelected()}
              disabled={selected.size === 0 || importing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 16px rgba(109,74,224,0.30)' }}
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {importing ? 'Importing…' : `Import${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ShortsStudioPage() {
  const qc = useQueryClient();
  const [channelId, setChannelId]     = useState('');
  const [importedOpen, setImportedOpen] = useState(true);
  const [openVideoIds, setOpenVideoIds] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen]   = useState(false);

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

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
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight flex items-center gap-2">
              <span className="text-2xl">✂️</span> Shorts Studio
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">Turn long-form videos into publish-ready vertical Shorts</p>
          </div>

          {/* Channel selector */}
          <div className="relative">
            <select
              value={channelId}
              onChange={(e) => selectChannel(e.target.value)}
              aria-label="Channel"
              className="bg-white rounded-2xl pl-4 pr-10 py-2.5 text-sm font-semibold text-gray-700 outline-none appearance-none cursor-pointer transition-all focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0]"
              style={{ border: '1.5px solid #e3e0f0' }}
            >
              <option value="">Select a channel…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* ── No channel selected ──────────────────────────────────── */}
        {!channelId && (
          <div className="bg-white rounded-3xl flex flex-col items-center justify-center py-20 px-6 text-center" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
              ✂️
            </div>
            <h2 className="text-xl font-extrabold text-gray-900 mb-2">Pick a channel to start</h2>
            <p className="text-gray-400 text-sm max-w-xs leading-relaxed">Select a connected YouTube channel above to import long-form videos and clip them into Shorts.</p>
          </div>
        )}

        {/* ── Channel selected but no imports ─────────────────────── */}
        {channelId && imported.length === 0 && (
          <div className="bg-white rounded-3xl flex flex-col items-center justify-center py-20 px-6 text-center" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
              📥
            </div>
            <h2 className="text-xl font-extrabold text-gray-900 mb-2">No videos yet</h2>
            <p className="text-gray-400 text-sm max-w-xs mb-8 leading-relaxed">Import a long-form video from your library to start clipping Shorts.</p>
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.30)' }}
            >
              <FolderDown className="w-4 h-4" /> Import videos from library
            </button>
          </div>
        )}

        {/* ── Imported videos section ──────────────────────────────── */}
        {channelId && imported.length > 0 && (
          <section className="space-y-2">
            {/* Section bar */}
            <div
              onClick={() => setImportedOpen((o) => !o)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setImportedOpen((o) => !o); } }}
              className="flex items-center gap-2.5 bg-white rounded-2xl px-4 py-3.5 cursor-pointer transition-all hover:border-[#6D4AE0]/30"
              style={{ border: '1.5px solid #e3ddf8' }}
            >
              {importedOpen
                ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 flex-1">Imported videos</span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>
                {imported.length}
              </span>
              {importedOpen && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenVideoIds((prev) => prev.size === imported.length ? new Set() : new Set(imported.map((v) => v.id)));
                  }}
                  className="text-xs font-semibold transition-colors hover:text-[#6D4AE0]"
                  style={{ color: '#6D4AE0' }}
                >
                  {openVideoIds.size === imported.length ? 'Collapse all' : 'Expand all'}
                </button>
              )}
            </div>

            {importedOpen && (
              <>
                {imported.map((v) => {
                  const open = openVideoIds.has(v.id);
                  return (
                    <div key={v.id} className="bg-white rounded-2xl overflow-hidden transition-all hover:border-[#6D4AE0]/30"
                      style={{ border: `1.5px solid ${open ? '#6D4AE0' : '#e3ddf8'}` }}>
                      {/* Video row header */}
                      <div
                        onClick={() => setOpenVideoIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
                          return next;
                        })}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setOpenVideoIds((prev) => { const next = new Set(prev); if (next.has(v.id)) next.delete(v.id); else next.add(v.id); return next; });
                          }
                        }}
                        className="flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors hover:bg-[#faf9ff]"
                      >
                        {open
                          ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                          : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                        {v.thumbnailUrl && (
                          <img src={v.thumbnailUrl} alt="" className="w-16 h-9 object-cover rounded-lg shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-extrabold text-gray-900 truncate text-sm">{v.title}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {fmtDuration(v.durationMs)}
                            {v._count.topicSegments > 0 ? ` · ${v._count.topicSegments} topics` : v._count.transcriptSegments > 0 ? ' · transcribed' : ''}
                          </p>
                        </div>
                        {v._count.topicSegments > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0"
                            style={{ background: '#ecfdf5', color: '#065f46' }}>
                            <CheckCircle2 className="w-3 h-3" /> Ready
                          </span>
                        )}
                      </div>

                      {/* Expanded content */}
                      {open && (
                        <div className="px-5 pb-5 pt-3 flex items-start gap-4 flex-wrap" style={{ borderTop: '1.5px solid #f0edf9' }}>
                          <div className="flex-1 min-w-[240px]">
                            <AnalysisProgress importedVideoId={v.id} onRetry={() => analyzeMutation.mutate(v.id)} />
                          </div>
                          <div className="flex gap-2 shrink-0 flex-wrap">
                            <button
                              onClick={(e) => { e.stopPropagation(); analyzeMutation.mutate(v.id); }}
                              disabled={analyzeMutation.isPending}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 active:scale-[0.97]"
                              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 2px 10px rgba(109,74,224,0.25)' }}
                            >
                              {analyzeMutation.isPending && analyzeMutation.variables === v.id
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Wand2 className="w-4 h-4" />}
                              Analyze
                            </button>
                            <SendToEditorButton importedVideoId={v.id} />
                            {v._count.topicSegments > 0 && (
                              <Link
                                href={`/shorts-studio/videos/${v.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-all hover:border-[#6D4AE0]/40"
                                style={{ border: '1.5px solid #e3ddf8', color: '#6D4AE0', background: 'white' }}
                              >
                                <Sparkles className="w-4 h-4" /> Results
                              </Link>
                            )}
                            <DeleteFromImportedButton video={v} channelId={channelId} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Import more */}
                <button
                  onClick={() => setPickerOpen(true)}
                  className="w-full py-3 text-sm font-bold rounded-2xl transition-all flex items-center justify-center gap-2 hover:bg-[#f5f2fd]"
                  style={{ border: '1.5px dashed #c4b5fd', color: '#6D4AE0' }}
                >
                  <FolderDown className="w-4 h-4" /> Import more from library
                </button>
              </>
            )}
          </section>
        )}
      </div>

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
