'use client';
import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ListVideo, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { VirtualVideoGrid } from '@/components/library/VirtualVideoGrid';
import { PlaylistsTab } from '@/components/library/PlaylistsTab';
import { SyncBadge } from '@/components/library/SyncBadge';

// ── Types ────────────────────────────────────────────────────────────────────

interface Channel {
  id: string;
  title: string;
}

type TabId = 'videos' | 'playlists';
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
    <div className="flex flex-col h-full px-8 py-6 max-w-7xl mx-auto w-full">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ListVideo className="w-6 h-6 text-brand-600" />
            Library
          </h1>
          <p className="text-gray-500 mt-1 text-sm">All videos, shorts and playlists for your channel</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Channel selector */}
          <select
            value={channelId}
            onChange={(e) => { handleChannelChange(e.target.value); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
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
      </div>

      {!channelId && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
          <ListVideo className="w-12 h-12 mb-3 opacity-30" />
          <p>Select a channel above to browse its library.</p>
        </div>
      )}

      {channelId && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-5 border-b border-gray-100">
            {(['videos', 'playlists'] as TabId[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); }}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg capitalize transition-colors ${
                  tab === t
                    ? 'bg-white border border-b-white border-gray-100 text-gray-900 shadow-sm -mb-px'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Videos tab */}
          {tab === 'videos' && (
            <div className="flex flex-col flex-1 min-h-0 gap-4">
              {/* Filter bar */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Search */}
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
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
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
                  />
                </div>

                {/* Type toggle */}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                  {(['all', 'video', 'short'] as VideoType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => { setVideoType(t); }}
                      className={`px-3 py-2 capitalize transition-colors ${
                        videoType === t
                          ? 'bg-brand-600 text-white font-medium'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
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
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="recent">Recent</option>
                  <option value="title">Title</option>
                </select>
              </div>

              {/* Grid / empty state */}
              {videosLoading && (
                <div className="flex items-center gap-2 py-20 justify-center text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Loading library…
                </div>
              )}

              {!videosLoading && allVideos.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4 py-20">
                  <ListVideo className="w-12 h-12 opacity-30" />
                  <p className="text-sm">No videos synced yet.</p>
                  <SyncBadge channelId={channelId} />
                </div>
              )}

              {!videosLoading && allVideos.length > 0 && (
                <div className="flex-1 min-h-0">
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
            <div className="flex-1 overflow-y-auto min-h-0">
              <PlaylistsTab channelId={channelId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
