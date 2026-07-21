'use client';
import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ListVideo, Loader2, Layers, Music, Video, Image, Mic, FileText, RefreshCw, CheckCircle, Clock, AlertCircle, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { VirtualVideoGrid } from '@/components/library/VirtualVideoGrid';
import { PlaylistsTab } from '@/components/library/PlaylistsTab';
import { SyncBadge } from '@/components/library/SyncBadge';
import { ChannelAccessPanel } from '@/components/channel-access-panel';

// ── Types ────────────────────────────────────────────────────────────────────

interface Channel {
  id: string;
  title: string;
}

interface AssetProject {
  id: string;
  title: string;
}

interface Asset {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  label: string | null;
  createdAt: string;
  versions: Array<{ id: string; version: number; provider?: string; durationMs?: number; sizeBytes?: string }>;
}

type TabId = 'videos' | 'playlists' | 'channels' | 'assets';

// ── Assets constants ─────────────────────────────────────────────────────────

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  MUSIC: Music, VIDEO: Video, THUMBNAIL: Image, VOICE: Mic,
  IMAGE: Image, SUBTITLE: FileText, UPLOAD: Layers, RENDER_SOURCE: Layers,
};

const STATUS_BADGE: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; style: React.CSSProperties }> = {
  BRIEFED:    { label: 'Brief ready', icon: Clock,        style: { background: '#f3f4f6', color: '#4b5563' } },
  GENERATING: { label: 'Generating',  icon: RefreshCw,    style: { background: '#eff6ff', color: '#1d4ed8' } },
  READY:      { label: 'Ready',       icon: CheckCircle,  style: { background: '#ecfdf5', color: '#065f46' } },
  ACCEPTED:   { label: 'Accepted',    icon: CheckCircle,  style: { background: '#f5f2fd', color: '#6D4AE0' } },
  FAILED:     { label: 'Failed',      icon: AlertCircle,  style: { background: '#fef2f2', color: '#dc2626' } },
};

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api';

async function fetchApi<T>(path: string): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('cf_token') : null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}
type VideoType = 'all' | 'video' | 'short';
type VideoSort = 'recent' | 'title';

const CHANNEL_LS_KEY = 'cf.library.channelId';

// ── Debounce hook ────────────────────────────────────────────────────────────

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(value); }, delay);
    return () => { clearTimeout(t); };
  }, [value, delay]);
  return debounced;
}

// ── Main page ────────────────────────────────────────────────────────────────

// useSearchParams() requires a Suspense boundary for static prerendering.
export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>}>
      <LibraryPageInner />
    </Suspense>
  );
}

function LibraryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── URL-synced filter state ──────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>(() => (searchParams.get('tab') as TabId | null) ?? 'videos');

  // ── Assets tab state ─────────────────────────────────────────────────────
  const [assetProjects, setAssetProjects] = useState<AssetProject[]>([]);
  const [selectedAssetProject, setSelectedAssetProject] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState('');

  useEffect(() => {
    fetchApi<{ data: AssetProject[] }>('/projects')
      .then((p) => setAssetProjects(p.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedAssetProject) return;
    setAssetsLoading(true);
    setAssetsError('');
    fetchApi<{ data: Asset[] }>(`/assets/project/${selectedAssetProject}`)
      .then((p) => setAssets(p.data))
      .catch((e: unknown) => setAssetsError(e instanceof Error ? e.message : 'Failed to load assets'))
      .finally(() => setAssetsLoading(false));
  }, [selectedAssetProject]);

  const groupedAssets = assets.reduce<Record<string, Asset[]>>((acc, a) => {
    acc[a.kind] = [...(acc[a.kind] ?? []), a];
    return acc;
  }, {});
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') ?? '');
  const [videoType, setVideoType] = useState<VideoType>(() => (searchParams.get('type') as VideoType | null) ?? 'all');
  const [videoSort, setVideoSort] = useState<VideoSort>(() => (searchParams.get('sort') as VideoSort | null) ?? 'recent');
  const q = useDebounced(searchInput, 300);

  // ── Channel selector ─────────────────────────────────────────────────────
  const [channelId, setChannelId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(CHANNEL_LS_KEY) ?? '';
    }
    return '';
  });

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  // Auto-select first channel if none stored
  useEffect(() => {
    if (!channelId && channels.length > 0) {
      const first = channels[0];
      if (first) {
        setChannelId(first.id);
        localStorage.setItem(CHANNEL_LS_KEY, first.id);
      }
    }
  }, [channels, channelId]);

  function handleChannelChange(id: string) {
    setChannelId(id);
    localStorage.setItem(CHANNEL_LS_KEY, id);
  }

  // ── URL sync (replace on filter change) ─────────────────────────────────
  const syncUrlRef = useRef(false);
  useEffect(() => {
    if (!syncUrlRef.current) {
      // skip first render — already initialized from URL
      syncUrlRef.current = true;
      return;
    }
    const params = new URLSearchParams();
    if (tab !== 'videos') params.set('tab', tab);
    if (q) params.set('q', q);
    if (videoType !== 'all') params.set('type', videoType);
    if (videoSort !== 'recent') params.set('sort', videoSort);
    const qs = params.toString();
    router.replace(qs ? `/library?${qs}` : '/library', { scroll: false });
  }, [tab, q, videoType, videoSort, router]);

  // ── Videos infinite query ────────────────────────────────────────────────
  const {
    data: videosData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: videosLoading,
  } = useInfiniteQuery({
    queryKey: ['library-videos', channelId, q, videoType, videoSort],
    queryFn: ({ pageParam }) =>
      api.library
        .listVideos(channelId, {
          cursor: pageParam as string | undefined,
          q: q || undefined,
          type: videoType === 'all' ? undefined : videoType,
          sort: videoSort,
        })
        .then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!channelId && tab === 'videos',
  });

  const allVideos = videosData?.pages.flatMap((p) => p.data) ?? [];

  const handleFetchNextPage = useCallback(() => {
    if (!isFetchingNextPage && hasNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Page header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight flex items-center gap-2">
              <ListVideo className="w-6 h-6" style={{ color: '#6D4AE0' }} />
              Media Control
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">All videos, shorts and playlists for your channel</p>
          </div>
          {tab !== 'channels' && (
            <div className="flex items-center gap-3 flex-wrap">
              {/* Channel selector */}
              <select
                value={channelId}
                onChange={(e) => { handleChannelChange(e.target.value); }}
                className="bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                style={{ border: '1.5px solid #e3e0f0' }}
                aria-label="Select channel"
              >
                <option value="">Select a channel…</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              {/* Sync controls */}
              {channelId && <SyncBadge channelId={channelId} />}
            </div>
          )}
        </div>

        {/* Tabs — Channel Access works without a selected channel */}
        <div className="flex gap-2 flex-wrap">
          {([['videos', 'Videos'], ['playlists', 'Playlists'], ['channels', 'Channel Access'], ['assets', 'Media Assets']] as Array<[TabId, string]>).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); }}
              className="px-4 py-2 text-sm font-semibold rounded-2xl transition-all"
              style={
                tab === t
                  ? { background: '#f5f2fd', border: '2px solid #6D4AE0', color: '#6D4AE0' }
                  : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* Assets tab */}
        {tab === 'assets' && (
          <div className="space-y-5">
            {/* Project selector */}
            <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
              <label htmlFor="assets-project" className="block text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-2">Select Project</label>
              <div className="relative">
                <select
                  id="assets-project"
                  value={selectedAssetProject}
                  onChange={(e) => setSelectedAssetProject(e.target.value)}
                  className="w-full bg-white rounded-2xl px-4 py-3 pr-10 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all appearance-none"
                  style={{ border: '1.5px solid #e3e0f0' }}
                >
                  <option value="">Choose a project…</option>
                  {assetProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {assetsLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#6D4AE0' }} />
              </div>
            )}
            {assetsError && <p className="text-sm text-red-500">{assetsError}</p>}

            {selectedAssetProject && !assetsLoading && assets.length === 0 && !assetsError && (
              <div className="bg-white rounded-3xl p-12 flex flex-col items-center text-center" style={{ border: '1.5px solid #e3ddf8' }}>
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
                  <Layers className="w-7 h-7" style={{ color: '#6D4AE0' }} />
                </div>
                <p className="text-sm font-semibold text-gray-700">No assets yet for this project</p>
                <p className="text-xs text-gray-400 mt-1">Run Voice Spec, Image Brief, or Music Brief from the project pipeline.</p>
              </div>
            )}

            {Object.entries(groupedAssets).map(([kind, kindAssets]) => {
              const Icon = KIND_ICONS[kind] ?? Layers;
              return (
                <div key={kind}>
                  <h2 className="flex items-center gap-2 mb-3">
                    <Icon className="w-4 h-4 text-[#6D4AE0]" />
                    <span className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400">{kind.replace('_', ' ')}</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>{kindAssets.length}</span>
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {kindAssets.map((asset) => {
                      const status = STATUS_BADGE[asset.status] ?? STATUS_BADGE['BRIEFED']!;
                      const StatusIcon = status.icon;
                      const latest = asset.versions[0];
                      return (
                        <div key={asset.id} className="bg-white rounded-2xl p-4" style={{ border: '1.5px solid #e3ddf8' }}>
                          <div className="flex items-start justify-between mb-2">
                            <p className="text-sm font-medium text-gray-900 truncate flex-1">
                              {asset.label ?? `${kind} — ${asset.id.slice(0, 8)}`}
                            </p>
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ml-2" style={status.style}>
                              <StatusIcon className={`w-3 h-3 ${asset.status === 'GENERATING' ? 'animate-spin' : ''}`} />
                              {status.label}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">
                            {asset.versions.length} version{asset.versions.length !== 1 ? 's' : ''}
                            {latest?.provider ? ` · ${latest.provider}` : ''}
                            {latest?.durationMs ? ` · ${Math.round(latest.durationMs / 1000)}s` : ''}
                          </p>
                          <p className="text-xs text-gray-300 mt-1">Created {new Date(asset.createdAt).toLocaleDateString()}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'channels' && (
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
            <ChannelAccessPanel />
          </div>
        )}

        {tab !== 'channels' && !channelId && (
          <div className="bg-white rounded-3xl p-16 flex flex-col items-center justify-center text-center" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
              <ListVideo className="w-8 h-8" style={{ color: '#6D4AE0' }} />
            </div>
            <p className="text-base font-extrabold text-gray-900 mb-1">No channel selected</p>
            <p className="text-sm text-gray-400">Select a channel above to browse its library.</p>
          </div>
        )}

        {tab !== 'channels' && channelId && (
          <>
            {/* Videos tab */}
            {tab === 'videos' && (
              <div className="flex flex-col gap-4">
                {/* Filter bar */}
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <svg
                      className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
                    </svg>
                    <input
                      type="search"
                      value={searchInput}
                      onChange={(e) => { setSearchInput(e.target.value); }}
                      placeholder="Search videos…"
                      aria-label="Search videos"
                      className="w-full pl-10 pr-4 bg-white rounded-2xl py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all placeholder:text-gray-400"
                      style={{ border: '1.5px solid #e3e0f0' }}
                    />
                  </div>

                  {/* Type toggle */}
                  <div className="flex gap-1.5">
                    {(['all', 'video', 'short'] as VideoType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setVideoType(t); }}
                        className="px-3 py-2 text-sm font-semibold rounded-2xl transition-all"
                        style={
                          videoType === t
                            ? { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', color: '#fff', border: '1.5px solid transparent', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }
                            : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }
                        }
                      >
                        {t === 'all' ? 'All' : t === 'video' ? 'Videos' : 'Shorts'}
                      </button>
                    ))}
                  </div>

                  {/* Sort */}
                  <select
                    value={videoSort}
                    onChange={(e) => { setVideoSort(e.target.value as VideoSort); }}
                    aria-label="Sort videos"
                    className="bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                    style={{ border: '1.5px solid #e3e0f0' }}
                  >
                    <option value="recent">Recent</option>
                    <option value="title">Title</option>
                  </select>
                </div>

                {/* Grid / empty state */}
                {videosLoading && (
                  <div className="flex items-center gap-2 py-20 justify-center text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} /> Loading library…
                  </div>
                )}

                {!videosLoading && allVideos.length === 0 && (
                  <div className="bg-white rounded-3xl p-16 flex flex-col items-center justify-center text-center" style={{ border: '1.5px solid #e3ddf8' }}>
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
                      <ListVideo className="w-8 h-8" style={{ color: '#6D4AE0' }} />
                    </div>
                    <p className="text-base font-extrabold text-gray-900 mb-1">No videos synced yet</p>
                    <p className="text-sm text-gray-400 mb-4">Sync your channel to see videos here.</p>
                    <SyncBadge channelId={channelId} />
                  </div>
                )}

                {!videosLoading && allVideos.length > 0 && (
                  <div>
                    <VirtualVideoGrid
                      videos={allVideos}
                      hasNextPage={!!hasNextPage}
                      isFetchingNextPage={isFetchingNextPage}
                      fetchNextPage={handleFetchNextPage}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Playlists tab */}
            {tab === 'playlists' && (
              <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
                <PlaylistsTab channelId={channelId} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
