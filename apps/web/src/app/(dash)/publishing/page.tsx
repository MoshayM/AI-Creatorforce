'use client';
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Upload, Calendar, CheckCircle, AlertCircle, Film,
  Search, ExternalLink, Loader2, RefreshCw, ChevronDown,
} from 'lucide-react';
import { api, type TrackedVideo, type TrackedVideoStatus } from '@/lib/api';

const CHANNEL_LS_KEY = 'cf.publishing.channelId';
const PAGE_SIZE = 30;

type StatusFilter = 'ALL' | TrackedVideoStatus;

interface Channel {
  id: string;
  title: string;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'just now';
  if (abs < 3600) {
    const m = Math.round(abs / 60);
    return diff < 0 ? `${m}m ago` : `in ${m}m`;
  }
  if (abs < 86400) {
    const h = Math.round(abs / 3600);
    return diff < 0 ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.round(abs / 86400);
  return diff < 0 ? `${d}d ago` : `in ${d}d`;
}

const STATUS_BADGE: Record<TrackedVideoStatus, string> = {
  SCHEDULED: 'bg-blue-100 text-blue-700',
  PUBLISHED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

function VideoRow({ video }: { video: TrackedVideo }) {
  const dateStr = video.status === 'SCHEDULED'
    ? relativeTime(video.scheduledAt)
    : video.status === 'PUBLISHED'
      ? relativeTime(video.publishedAt)
      : relativeTime(video.scheduledAt ?? video.createdAt);

  return (
    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
      {/* Thumbnail */}
      <div className="w-16 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Film className="w-5 h-5 text-gray-300" />
        )}
      </div>

      {/* Title + channel */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{video.title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{video.channel.title}</p>
      </div>

      {/* Stats (published only) */}
      {video.status === 'PUBLISHED' && (
        <div className="hidden md:flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
          <span>{video.viewCount.toLocaleString()} views</span>
          <span>{video.likeCount.toLocaleString()} likes</span>
        </div>
      )}

      {/* Date */}
      <div className="text-xs text-gray-500 flex-shrink-0 min-w-[72px] text-right">
        {dateStr}
      </div>

      {/* Status badge */}
      <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${STATUS_BADGE[video.status]}`}>
        {video.status === 'SCHEDULED' ? 'Scheduled' : video.status === 'PUBLISHED' ? 'Published' : 'Failed'}
      </span>

      {/* YouTube link */}
      {video.youtubeVideoId && (
        <a
          href={`https://www.youtube.com/watch?v=${video.youtubeVideoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
          title="View on YouTube"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-100 last:border-0 animate-pulse">
      <div className="w-16 h-10 bg-gray-200 rounded-lg flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-gray-200 rounded w-2/3" />
        <div className="h-3 bg-gray-100 rounded w-1/3" />
      </div>
      <div className="h-3 bg-gray-200 rounded w-16 flex-shrink-0" />
      <div className="h-6 bg-gray-200 rounded-full w-20 flex-shrink-0" />
    </div>
  );
}

const EMPTY_MESSAGES: Record<StatusFilter, string> = {
  ALL: 'No videos tracked yet. Publish a video from the Approvals page to get started.',
  SCHEDULED: 'No videos currently scheduled.',
  PUBLISHED: 'No published videos yet.',
  FAILED: 'No failed uploads — great!',
};

export default function PublishingPage() {
  const [channelId, setChannelId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [skip, setSkip] = useState(0);
  const [allVideos, setAllVideos] = useState<TrackedVideo[]>([]);

  // Load saved channel
  useEffect(() => {
    const saved = localStorage.getItem(CHANNEL_LS_KEY);
    if (saved) setChannelId(saved);
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  // Reset list on filter/channel/search change
  useEffect(() => {
    setSkip(0);
    setAllVideos([]);
  }, [channelId, statusFilter, debouncedQ]);

  const { data: channels } = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then(r => r.data as Channel[]),
  });

  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ['publishing-summary', channelId],
    queryFn: () => api.publishing.summary(channelId || undefined).then(r => r.data),
  });

  const statusParam: TrackedVideoStatus[] | undefined =
    statusFilter === 'ALL' ? undefined : [statusFilter];

  const { data: page, isFetching, refetch: refetchVideos } = useQuery({
    queryKey: ['publishing-videos', channelId, statusFilter, debouncedQ, skip],
    queryFn: () =>
      api.publishing.listVideos({
        channelId: channelId || undefined,
        status: statusParam,
        q: debouncedQ || undefined,
        take: PAGE_SIZE,
        skip,
      }).then(r => r.data),
    placeholderData: (prev) => prev,
  });

  // Accumulate pages
  useEffect(() => {
    if (!page?.data) return;
    if (skip === 0) {
      setAllVideos(page.data);
    } else {
      setAllVideos(prev => [...prev, ...page.data]);
    }
  }, [page, skip]);

  const handleRefresh = useCallback(() => {
    setSkip(0);
    setAllVideos([]);
    void refetchSummary();
    void refetchVideos();
  }, [refetchSummary, refetchVideos]);

  const canLoadMore = page ? allVideos.length < page.total : false;

  const TABS: { id: StatusFilter; label: string }[] = [
    { id: 'ALL', label: 'All' },
    { id: 'SCHEDULED', label: 'Scheduled' },
    { id: 'PUBLISHED', label: 'Published' },
    { id: 'FAILED', label: 'Failed' },
  ];

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-violet-100 rounded-xl flex items-center justify-center">
            <Upload className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Publishing</h1>
            <p className="text-sm text-gray-500">Track scheduled and published YouTube videos</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-gray-500">Scheduled</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{summary?.scheduled ?? '—'}</p>
          {summary?.upcoming7d !== undefined && (
            <p className="text-xs text-gray-400 mt-1">{summary.upcoming7d} in next 7d</p>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-gray-500">Published</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{summary?.published ?? '—'}</p>
          {summary?.publishedThisMonth !== undefined && (
            <p className="text-xs text-gray-400 mt-1">{summary.publishedThisMonth} this month</p>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-gray-500">Failed</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{summary?.failed ?? '—'}</p>
          <p className="text-xs text-gray-400 mt-1">need attention</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Film className="w-4 h-4 text-gray-400" />
            <span className="text-xs font-medium text-gray-500">Total</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {summary ? (summary.scheduled + summary.published + summary.failed) : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-1">tracked videos</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Channel selector */}
        <div className="relative">
          <select
            value={channelId}
            onChange={e => {
              setChannelId(e.target.value);
              localStorage.setItem(CHANNEL_LS_KEY, e.target.value);
            }}
            className="appearance-none bg-white border border-gray-200 rounded-xl pl-3 pr-8 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
          >
            <option value="">All channels</option>
            {(channels ?? []).map((ch: Channel) => (
              <option key={ch.id} value={ch.id}>{ch.title}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search videos…"
            value={q}
            onChange={e => setQ(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === tab.id
                ? 'bg-white shadow text-violet-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.id === 'FAILED' && summary && summary.failed > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full text-xs">
                {summary.failed}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Video list */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {isFetching && allVideos.length === 0 ? (
          <div>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : allVideos.length === 0 ? (
          <div className="py-16 text-center">
            <Upload className="w-10 h-10 mx-auto mb-3 text-gray-200" />
            <p className="text-gray-500 text-sm">{EMPTY_MESSAGES[statusFilter]}</p>
          </div>
        ) : (
          <div>
            {allVideos.map(video => (
              <VideoRow key={video.id} video={video} />
            ))}
          </div>
        )}
      </div>

      {/* Load more */}
      {canLoadMore && (
        <div className="text-center">
          <button
            onClick={() => setSkip(prev => prev + PAGE_SIZE)}
            disabled={isFetching}
            className="px-6 py-2 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2 mx-auto"
          >
            {isFetching && <Loader2 className="w-4 h-4 animate-spin" />}
            Load more ({page!.total - allVideos.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
