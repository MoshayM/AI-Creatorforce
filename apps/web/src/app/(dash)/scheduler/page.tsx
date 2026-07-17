'use client';
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  LayoutList,
  Loader2,
  MessageSquare,
  Search,
  ThumbsUp,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { api, type TrackedVideo, type TrackedVideoStatus, type PublishTrackingSummary, type CalendarEntry } from '@/lib/api';
import { StatCard } from '@/components/stat-card';

// ── Types & constants ────────────────────────────────────────────────────────

interface Channel {
  id: string;
  title: string;
}

type ViewMode = 'month' | 'list';
type StatusTab = 'all' | TrackedVideoStatus;

const CHANNEL_LS_KEY = 'cf.scheduler.channelId';
const LIST_PAGE_SIZE = 30;
const WEEK_OPTS = { weekStartsOn: 1 as const };

const STATUS_BADGE: Record<TrackedVideoStatus, string> = {
  SCHEDULED: 'bg-amber-100 text-amber-700',
  PUBLISHED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

const STATUS_CHIP: Record<TrackedVideoStatus, string> = {
  SCHEDULED: 'bg-amber-50 text-amber-800 border-amber-200',
  PUBLISHED: 'bg-green-50 text-green-800 border-green-200',
  FAILED: 'bg-red-50 text-red-800 border-red-200',
};

const STATUS_LABEL: Record<TrackedVideoStatus, string> = {
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
};

/** Effective tracking date: when it went live, else when it will. */
function effectiveDate(v: TrackedVideo): Date | null {
  const d = v.publishedAt ?? v.scheduledAt;
  return d ? new Date(d) : null;
}

function StatusBadge({ status }: { status: TrackedVideoStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

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

export default function SchedulerPage() {
  const [view, setView] = useState<ViewMode>('month');
  const [selected, setSelected] = useState<TrackedVideo | null>(null);

  // Channel selector ('' = all channels)
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

  function handleChannelChange(id: string) {
    setChannelId(id);
    localStorage.setItem(CHANNEL_LS_KEY, id);
  }

  // Summary cards
  const { data: summary } = useQuery<PublishTrackingSummary>({
    queryKey: ['scheduler-summary', channelId],
    queryFn: () => api.publishing.summary(channelId || undefined).then((r) => r.data),
  });

  return (
    <div className="flex flex-col h-full px-8 py-6 max-w-7xl mx-auto w-full">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-brand-600" />
            Scheduler
          </h1>
          <p className="text-gray-500 mt-1 text-sm">Track scheduled and published videos across your channels</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={channelId}
            onChange={(e) => { handleChannelChange(e.target.value); }}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            aria-label="Select channel"
          >
            <option value="">All channels</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          {/* View toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => { setView('month'); }}
              className={`px-3 py-2 flex items-center gap-1.5 transition-colors ${
                view === 'month' ? 'bg-brand-600 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <CalendarDays className="w-4 h-4" /> Month
            </button>
            <button
              type="button"
              onClick={() => { setView('list'); }}
              className={`px-3 py-2 flex items-center gap-1.5 transition-colors ${
                view === 'list' ? 'bg-brand-600 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              <LayoutList className="w-4 h-4" /> List
            </button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          tone="lilac"
          icon={<CalendarClock className="w-5 h-5" />}
          label="Scheduled"
          value={summary?.scheduled ?? '—'}
          sub={summary ? `${summary.upcoming7d} in the next 7 days` : undefined}
          subClassName="text-gray-600"
        />
        <StatCard
          tone="periwinkle"
          icon={<Clock className="w-5 h-5" />}
          label="Next 7 days"
          value={summary?.upcoming7d ?? '—'}
        />
        <StatCard
          tone="pink"
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="Published"
          value={summary?.published ?? '—'}
          sub={summary ? `${summary.publishedThisMonth} this month` : undefined}
          subClassName="text-gray-600"
        />
        <StatCard
          tone="cream"
          icon={<AlertTriangle className="w-5 h-5" />}
          label="Failed"
          value={summary?.failed ?? '—'}
          subClassName="text-red-700"
        />
      </div>

      {view === 'month'
        ? <MonthView channelId={channelId} onSelect={setSelected} />
        : <ListView channelId={channelId} onSelect={setSelected} />}

      {selected && <VideoDetailModal video={selected} onClose={() => { setSelected(null); }} />}
    </div>
  );
}

// ── Month (calendar) view ────────────────────────────────────────────────────

function MonthView({ channelId, onSelect }: { channelId: string; onSelect: (v: TrackedVideo) => void }) {
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));

  const gridStart = startOfWeek(startOfMonth(month), WEEK_OPTS);
  const gridEnd = endOfWeek(endOfMonth(month), WEEK_OPTS);
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const { data: videos = [], isLoading } = useQuery<TrackedVideo[]>({
    queryKey: ['scheduler-month', channelId, format(month, 'yyyy-MM')],
    queryFn: () =>
      api.publishing
        .listVideos({
          channelId: channelId || undefined,
          from: gridStart.toISOString(),
          to: gridEnd.toISOString(),
          take: 200,
        })
        .then((r) => r.data.data),
  });

  // AI-planned slots (Autonomy) — channel-scoped, so only when one channel is selected
  const { data: planned = [] } = useQuery<CalendarEntry[]>({
    queryKey: ['scheduler-planned', channelId, format(month, 'yyyy-MM')],
    queryFn: () =>
      api.autonomy
        .listCalendar(channelId, { from: gridStart.toISOString(), to: gridEnd.toISOString() })
        .then((r) => r.data.filter((e) => e.status === 'PROPOSED' || e.status === 'APPROVED')),
    enabled: !!channelId,
  });

  const plannedByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of planned) {
      const key = format(new Date(e.plannedAt), 'yyyy-MM-dd');
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [planned]);

  const byDay = useMemo(() => {
    const map = new Map<string, TrackedVideo[]>();
    for (const v of videos) {
      const d = effectiveDate(v);
      if (!d) continue;
      const key = format(d, 'yyyy-MM-dd');
      const arr = map.get(key) ?? [];
      arr.push(v);
      map.set(key, arr);
    }
    return map;
  }, [videos]);

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 flex flex-col flex-1 min-h-0">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setMonth((m) => subMonths(m, 1)); }}
            className="p-2 rounded-lg hover:bg-gray-50 text-gray-600"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h2 className="text-lg font-semibold text-gray-900 w-40 text-center">{format(month, 'MMMM yyyy')}</h2>
          <button
            type="button"
            onClick={() => { setMonth((m) => addMonths(m, 1)); }}
            className="p-2 rounded-lg hover:bg-gray-50 text-gray-600"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-4">
          {/* Legend */}
          <div className="hidden md:flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Scheduled</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Published</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Failed</span>
            {planned.length > 0 && (
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-indigo-400" /> AI planned</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setMonth(startOfMonth(new Date())); }}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
          >
            Today
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-16 justify-center text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading calendar…
        </div>
      )}

      {!isLoading && (
        <>
          {/* Weekday headers */}
          <div className="grid grid-cols-7 text-xs font-medium text-gray-500 border-b border-gray-100 pb-2 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="px-2">{d}</div>
            ))}
          </div>
          {/* Day cells */}
          <div className="grid grid-cols-7 flex-1 auto-rows-fr">
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const dayVideos = byDay.get(key) ?? [];
              const inMonth = isSameMonth(day, month);
              return (
                <div
                  key={key}
                  className={`border-b border-r border-gray-50 p-1.5 min-h-[92px] flex flex-col gap-1 ${inMonth ? '' : 'bg-gray-50/50'}`}
                >
                  <span
                    className={`text-xs w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday(day)
                        ? 'bg-brand-600 text-white font-semibold'
                        : inMonth ? 'text-gray-700' : 'text-gray-400'
                    }`}
                  >
                    {format(day, 'd')}
                  </span>
                  {dayVideos.slice(0, 3).map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => { onSelect(v); }}
                      title={`${STATUS_LABEL[v.status]}: ${v.title}`}
                      className={`text-left text-[11px] leading-tight px-1.5 py-1 rounded border truncate hover:opacity-80 transition-opacity ${STATUS_CHIP[v.status]}`}
                    >
                      {v.title}
                    </button>
                  ))}
                  {dayVideos.length > 3 && (
                    <span className="text-[10px] text-gray-500 px-1.5">+{dayVideos.length - 3} more</span>
                  )}
                  {(plannedByDay.get(key) ?? []).slice(0, Math.max(0, 3 - dayVideos.length)).map((e) => (
                    <span
                      key={e.id}
                      title={`AI planned (${e.status.toLowerCase()}): ${e.title}`}
                      className="text-left text-[11px] leading-tight px-1.5 py-1 rounded border border-dashed truncate bg-indigo-50/60 text-indigo-800 border-indigo-300"
                    >
                      {e.title}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ── List view ────────────────────────────────────────────────────────────────

function ListView({ channelId, onSelect }: { channelId: string; onSelect: (v: TrackedVideo) => void }) {
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [searchInput, setSearchInput] = useState('');
  const q = useDebounced(searchInput, 300);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['scheduler-list', channelId, statusTab, q],
    queryFn: ({ pageParam }) =>
      api.publishing
        .listVideos({
          channelId: channelId || undefined,
          status: statusTab === 'all' ? undefined : [statusTab],
          q: q || undefined,
          take: LIST_PAGE_SIZE,
          skip: pageParam,
        })
        .then((r) => r.data),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.skip + last.data.length < last.total ? last.skip + last.take : undefined,
  });

  const videos = data?.pages.flatMap((p) => p.data) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['all', 'SCHEDULED', 'PUBLISHED', 'FAILED'] as StatusTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setStatusTab(t); }}
              className={`px-3 py-2 transition-colors ${
                statusTab === t ? 'bg-brand-600 text-white font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'all' ? 'All' : STATUS_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); }}
            placeholder="Search videos…"
            aria-label="Search videos"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
        </div>
        {!isLoading && <span className="text-sm text-gray-500 ml-auto">{total} video{total === 1 ? '' : 's'}</span>}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-20 justify-center text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading videos…
        </div>
      )}

      {!isLoading && videos.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3 py-20">
          <CalendarClock className="w-12 h-12 opacity-30" />
          <p className="text-sm">No {statusTab === 'all' ? 'tracked' : STATUS_LABEL[statusTab as TrackedVideoStatus].toLowerCase()} videos yet.</p>
          <p className="text-xs text-gray-400">Videos appear here once they are scheduled or published.</p>
        </div>
      )}

      {!isLoading && videos.length > 0 && (
        <div className="flex-1 overflow-y-auto min-h-0 bg-white border border-gray-100 rounded-2xl shadow-sm divide-y divide-gray-50">
          {videos.map((v) => {
            const d = effectiveDate(v);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => { onSelect(v); }}
                className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                {/* Thumbnail */}
                {v.thumbnailUrl ? (
                  <img src={v.thumbnailUrl} alt="" className="w-24 h-14 object-cover rounded-lg bg-gray-100 shrink-0" />
                ) : (
                  <div className="w-24 h-14 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <CalendarClock className="w-5 h-5 text-gray-300" />
                  </div>
                )}
                {/* Title + meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{v.title}</p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {v.channel.title} · {v.project.title}
                  </p>
                </div>
                {/* Stats (published only) */}
                {v.status === 'PUBLISHED' && (
                  <div className="hidden md:flex items-center gap-4 text-xs text-gray-500 tabular-nums shrink-0">
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {v.viewCount.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5" /> {v.likeCount.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {v.commentCount.toLocaleString()}</span>
                  </div>
                )}
                {/* Date + status */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusBadge status={v.status} />
                  <span className="text-xs text-gray-500 tabular-nums">
                    {d ? format(d, 'd MMM yyyy, HH:mm') : '—'}
                  </span>
                </div>
              </button>
            );
          })}
          {hasNextPage && (
            <div className="p-3 flex justify-center">
              <button
                type="button"
                onClick={() => { void fetchNextPage(); }}
                disabled={isFetchingNextPage}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
              >
                {isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin" />}
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Detail modal ─────────────────────────────────────────────────────────────

function VideoDetailModal({ video, onClose }: { video: TrackedVideo; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const youtubeUrl = video.youtubeVideoId ? `https://youtu.be/${video.youtubeVideoId}` : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={video.title}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
      >
        {video.thumbnailUrl && (
          <img src={video.thumbnailUrl} alt="" className="w-full aspect-video object-cover bg-gray-100" />
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold text-gray-900">{video.title}</h3>
            <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-50 text-gray-400 shrink-0" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">{video.channel.title} · {video.project.title}</p>

          <div className="mt-4 space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Status</span>
              <StatusBadge status={video.status} />
            </div>
            {video.scheduledAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Scheduled for</span>
                <span className="text-gray-900 tabular-nums">{format(new Date(video.scheduledAt), 'd MMM yyyy, HH:mm')}</span>
              </div>
            )}
            {video.publishedAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Published on</span>
                <span className="text-gray-900 tabular-nums">{format(new Date(video.publishedAt), 'd MMM yyyy, HH:mm')}</span>
              </div>
            )}
            {video.status === 'PUBLISHED' && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Performance</span>
                <span className="flex items-center gap-3 text-gray-900 text-xs tabular-nums">
                  <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5 text-gray-400" /> {video.viewCount.toLocaleString()}</span>
                  <span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5 text-gray-400" /> {video.likeCount.toLocaleString()}</span>
                  <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5 text-gray-400" /> {video.commentCount.toLocaleString()}</span>
                </span>
              </div>
            )}
          </div>

          {youtubeUrl && (
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[#9d6ff0] to-[#7c4fd8] text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <ExternalLink className="w-4 h-4" /> Open on YouTube
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
