'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Plus,
  Scissors,
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

const STATUS_CHIP_STYLE: Record<TrackedVideoStatus, React.CSSProperties> = {
  SCHEDULED: { background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' },
  PUBLISHED: { background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' },
  FAILED: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
};

const STATUS_BADGE_STYLE: Record<TrackedVideoStatus, React.CSSProperties> = {
  SCHEDULED: { background: '#fff7ed', color: '#c2410c' },
  PUBLISHED: { background: '#ecfdf5', color: '#065f46' },
  FAILED: { background: '#fef2f2', color: '#b91c1c' },
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
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
      style={STATUS_BADGE_STYLE[status]}
    >
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
  const { data: summary, isLoading: summaryLoading } = useQuery<PublishTrackingSummary>({
    queryKey: ['scheduler-summary', channelId],
    queryFn: () => api.publishing.summary(channelId || undefined).then((r) => r.data),
  });

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Page header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight flex items-center gap-2">
              <CalendarClock className="w-6 h-6" style={{ color: '#6D4AE0' }} />
              Scheduler
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">Track scheduled and published videos across your channels</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={channelId}
              onChange={(e) => { handleChannelChange(e.target.value); }}
              className="bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
              style={{ border: '1.5px solid #e3e0f0' }}
              aria-label="Select channel"
            >
              <option value="">All channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            {/* View toggle */}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => { setView('month'); }}
                className="px-3 py-2.5 flex items-center gap-1.5 text-sm font-semibold rounded-2xl transition-all"
                style={
                  view === 'month'
                    ? { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', color: '#fff', border: '1.5px solid transparent', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }
                    : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }
                }
              >
                <CalendarDays className="w-4 h-4" /> Month
              </button>
              <button
                type="button"
                onClick={() => { setView('list'); }}
                className="px-3 py-2.5 flex items-center gap-1.5 text-sm font-semibold rounded-2xl transition-all"
                style={
                  view === 'list'
                    ? { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', color: '#fff', border: '1.5px solid transparent', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }
                    : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }
                }
              >
                <LayoutList className="w-4 h-4" /> List
              </button>
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            tone="lilac"
            icon={<CalendarClock className="w-5 h-5" />}
            label="Scheduled"
            value={summaryLoading ? <div className="h-8 w-12 bg-gray-100 rounded-xl animate-pulse mt-0.5" /> : (summary?.scheduled ?? 0)}
            sub={summary ? `${summary.upcoming7d} in the next 7 days` : undefined}
            subClassName="text-gray-600"
          />
          <StatCard
            tone="periwinkle"
            icon={<Clock className="w-5 h-5" />}
            label="Next 7 days"
            value={summaryLoading ? <div className="h-8 w-12 bg-gray-100 rounded-xl animate-pulse mt-0.5" /> : (summary?.upcoming7d ?? 0)}
          />
          <StatCard
            tone="pink"
            icon={<CheckCircle2 className="w-5 h-5" />}
            label="Published"
            value={summaryLoading ? <div className="h-8 w-12 bg-gray-100 rounded-xl animate-pulse mt-0.5" /> : (summary?.published ?? 0)}
            sub={summary ? `${summary.publishedThisMonth} this month` : undefined}
            subClassName="text-gray-600"
          />
          <StatCard
            tone="cream"
            icon={<AlertTriangle className="w-5 h-5" />}
            label="Failed"
            value={summaryLoading ? <div className="h-8 w-12 bg-gray-100 rounded-xl animate-pulse mt-0.5" /> : (summary?.failed ?? 0)}
            subClassName="text-red-700"
          />
        </div>

        {view === 'month'
          ? <MonthView channelId={channelId} onSelect={setSelected} />
          : <ListView channelId={channelId} onSelect={setSelected} />}

        {selected && <VideoDetailModal video={selected} onClose={() => { setSelected(null); }} />}
      </div>
    </div>
  );
}

// ── Plan Content modal ───────────────────────────────────────────────────────

function PlanContentModal({
  channelId,
  initialDate,
  onClose,
  onCreated,
}: {
  channelId: string;
  initialDate: Date;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [fmt, setFmt] = useState<'VIDEO' | 'SHORT'>('VIDEO');
  const [angle, setAngle] = useState('');
  // pre-fill to noon on the clicked day in local time
  const localNoon = new Date(initialDate);
  localNoon.setHours(12, 0, 0, 0);
  const localIso = new Date(localNoon.getTime() - localNoon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [plannedAt, setPlannedAt] = useState(localIso);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { mutate, isPending, error } = useMutation({
    mutationFn: () => api.autonomy.createEntry(channelId, {
      title: title.trim(),
      plannedAt: new Date(plannedAt).toISOString(),
      format: fmt,
      angle: angle.trim() || undefined,
    }),
    onSuccess: () => { onCreated(); onClose(); },
  });

  const errMsg = error instanceof Error
    ? (error as { response?: { data?: { message?: string } } }).response?.data?.message ?? error.message
    : null;

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
        aria-label="Plan content"
        className="bg-white rounded-3xl w-full max-w-md p-6"
        style={{ border: '1.5px solid #e3ddf8' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Plus className="w-4 h-4" style={{ color: '#6D4AE0' }} />
            Plan new content
          </h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-2xl hover:bg-gray-50 text-gray-400" style={{ border: '1.5px solid #e3ddf8' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Title *</label>
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. How to grow on YouTube in 2026"
              className="w-full px-4 py-3 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
              style={{ border: '1.5px solid #e3e0f0' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Format</label>
              <div className="flex gap-2">
                {(['VIDEO', 'SHORT'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFmt(f)}
                    className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                    style={fmt === f
                      ? { background: 'linear-gradient(135deg, #6D4AE0, #7c5ae8)', color: '#fff', border: '1.5px solid transparent' }
                      : { background: '#faf9ff', color: '#374151', border: '1.5px solid #e3ddf8' }}
                  >
                    {f === 'SHORT' ? <><Scissors className="w-3 h-3 inline mr-1" />Short</> : 'Video'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Planned date</label>
              <input
                type="datetime-local"
                value={plannedAt}
                onChange={(e) => setPlannedAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
                style={{ border: '1.5px solid #e3e0f0' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Angle / hook <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
              placeholder="A compelling hook that stops viewers mid-scroll"
              className="w-full px-4 py-3 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
              style={{ border: '1.5px solid #e3e0f0' }}
            />
          </div>

          {errMsg && <p className="text-xs text-red-600">{errMsg}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => mutate()}
              disabled={isPending || !title.trim()}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl text-sm font-bold text-white disabled:opacity-50 transition-all"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add to calendar
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-2xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              style={{ border: '1.5px solid #e3ddf8' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Month (calendar) view ────────────────────────────────────────────────────

function MonthView({ channelId, onSelect }: { channelId: string; onSelect: (v: TrackedVideo) => void }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [planDay, setPlanDay] = useState<Date | null>(null);

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

  // AI-planned slots — channel-scoped; require a specific channel selection
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
    <>
      <div className="bg-white rounded-2xl p-4 flex flex-col" style={{ border: '1.5px solid #e3ddf8' }}>
        {/* Month nav */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setMonth((m) => subMonths(m, 1)); }}
              className="p-2 rounded-2xl hover:bg-[#faf9ff] text-gray-600 transition-colors"
              style={{ border: '1.5px solid #e3ddf8' }}
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2 className="text-lg font-bold text-gray-900 w-40 text-center">{format(month, 'MMMM yyyy')}</h2>
            <button
              type="button"
              onClick={() => { setMonth((m) => addMonths(m, 1)); }}
              className="p-2 rounded-2xl hover:bg-[#faf9ff] text-gray-600 transition-colors"
              style={{ border: '1.5px solid #e3ddf8' }}
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-4">
            {/* Legend */}
            <div className="hidden md:flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> Scheduled</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> Published</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Failed</span>
              {channelId && (
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-indigo-400" /> AI planned</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setMonth(startOfMonth(new Date())); }}
              className="px-3 py-1.5 text-sm font-semibold rounded-2xl text-gray-600 hover:bg-[#faf9ff] transition-colors"
              style={{ border: '1.5px solid #e3ddf8' }}
            >
              Today
            </button>
          </div>
        </div>

        {/* Channel hint for planned slots */}
        {!channelId && (
          <p className="text-xs text-gray-400 mb-3 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            Select a specific channel above to see AI-planned slots and plan new content.
          </p>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 py-16 justify-center text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} /> Loading calendar…
          </div>
        )}

        {!isLoading && (
          <>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 text-[10px] font-extrabold uppercase tracking-widest text-gray-400 pb-2 mb-1" style={{ borderBottom: '1px solid #f0edf9' }}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="px-2">{d}</div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7 flex-1 auto-rows-fr">
              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const dayVideos = byDay.get(key) ?? [];
                const dayPlanned = plannedByDay.get(key) ?? [];
                const inMonth = isSameMonth(day, month);
                const visibleVideos = dayVideos.slice(0, 3);
                const remainingSlots = Math.max(0, 3 - visibleVideos.length);
                return (
                  <div
                    key={key}
                    className={`group p-1.5 min-h-[100px] flex flex-col gap-1 ${inMonth ? '' : 'bg-[#faf9ff]/60'}`}
                    style={{ borderBottom: '1px solid #f0edf9', borderRight: '1px solid #f0edf9' }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs w-6 h-6 flex items-center justify-center rounded-full font-semibold ${
                          isToday(day)
                            ? 'text-white'
                            : inMonth ? 'text-gray-700' : 'text-gray-400'
                        }`}
                        style={isToday(day) ? { background: '#6D4AE0' } : {}}
                      >
                        {format(day, 'd')}
                      </span>
                      {/* Plan content button — only when channel selected, visible on hover */}
                      {channelId && inMonth && (
                        <button
                          type="button"
                          onClick={() => setPlanDay(day)}
                          title="Plan content for this day"
                          className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded-full flex items-center justify-center transition-opacity hover:bg-[#6D4AE0]/10"
                          style={{ color: '#6D4AE0' }}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {visibleVideos.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => { onSelect(v); }}
                        title={`${v.source === 'SHORT' ? 'Short · ' : ''}${STATUS_LABEL[v.status]}: ${v.title}`}
                        className="text-left text-[11px] leading-tight px-1.5 py-1 rounded-lg truncate hover:opacity-80 transition-opacity flex items-center gap-1"
                        style={STATUS_CHIP_STYLE[v.status]}
                      >
                        {v.source === 'SHORT' && <Scissors className="w-2.5 h-2.5 shrink-0" />}
                        <span className="truncate">{v.title}</span>
                      </button>
                    ))}
                    {dayVideos.length > 3 && (
                      <span className="text-[10px] text-gray-400 px-1.5">+{dayVideos.length - 3} more</span>
                    )}
                    {dayPlanned.slice(0, remainingSlots).map((e) => (
                      <span
                        key={e.id}
                        title={`${e.source === 'manual' ? 'Manual plan' : 'AI planned'} (${e.status.toLowerCase()}): ${e.title}`}
                        className="text-left text-[11px] leading-tight px-1.5 py-1 rounded-lg border border-dashed truncate"
                        style={e.source === 'manual'
                          ? { background: '#fdf4ff', color: '#7c3aed', borderColor: '#e9d5ff' }
                          : { background: '#eef2ff', color: '#4338ca', borderColor: '#c7d2fe' }}
                      >
                        {e.title}
                      </span>
                    ))}
                    {dayPlanned.length > remainingSlots && remainingSlots > 0 && (
                      <span className="text-[10px] text-gray-400 px-1.5">+{dayPlanned.length - remainingSlots} planned</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {planDay && channelId && (
        <PlanContentModal
          channelId={channelId}
          initialDate={planDay}
          onClose={() => setPlanDay(null)}
          onCreated={() => {
            void qc.invalidateQueries({ queryKey: ['scheduler-planned', channelId, format(month, 'yyyy-MM')] });
          }}
        />
      )}
    </>
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
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {(['all', 'SCHEDULED', 'PUBLISHED', 'FAILED'] as StatusTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setStatusTab(t); }}
              className="px-3 py-2 text-sm font-semibold rounded-2xl transition-all"
              style={
                statusTab === t
                  ? { background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', color: '#fff', border: '1.5px solid transparent', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }
                  : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }
              }
            >
              {t === 'all' ? 'All' : STATUS_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" aria-hidden="true" />
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
        {!isLoading && (
          <span
            className="rounded-full text-[11px] font-bold px-2.5 py-0.5 ml-auto"
            style={{ background: '#f5f2fd', color: '#6D4AE0' }}
          >
            {total} video{total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-20 justify-center text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#6D4AE0' }} /> Loading videos…
        </div>
      )}

      {!isLoading && videos.length === 0 && (
        <div className="bg-white rounded-3xl p-16 flex flex-col items-center justify-center text-center" style={{ border: '1.5px solid #e3ddf8' }}>
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
            <CalendarClock className="w-8 h-8" style={{ color: '#6D4AE0' }} />
          </div>
          <p className="text-base font-extrabold text-gray-900 mb-1">No {statusTab === 'all' ? 'tracked' : STATUS_LABEL[statusTab as TrackedVideoStatus].toLowerCase()} videos yet</p>
          <p className="text-sm text-gray-400">Videos appear here once they are scheduled or published.</p>
        </div>
      )}

      {!isLoading && videos.length > 0 && (
        <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
          {videos.map((v) => {
            const d = effectiveDate(v);
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => { onSelect(v); }}
                className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-[#faf9ff] transition-colors"
                style={{ borderBottom: '1px solid #f0edf9' }}
              >
                {/* Thumbnail */}
                {v.thumbnailUrl ? (
                  <img src={v.thumbnailUrl} alt="" className="w-24 h-14 object-cover rounded-2xl bg-gray-100 shrink-0" />
                ) : (
                  <div className="w-24 h-14 rounded-2xl bg-gray-100 flex items-center justify-center shrink-0">
                    <CalendarClock className="w-5 h-5 text-gray-300" />
                  </div>
                )}
                {/* Title + meta */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
                    {v.source === 'SHORT' && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0"
                        style={{ background: '#fdf4ff', color: '#7c3aed', border: '1px solid #e9d5ff' }}
                      >
                        <Scissors className="w-2.5 h-2.5" />Short
                      </span>
                    )}
                    <span className="truncate">{v.title}</span>
                  </p>
                  <p className="text-xs text-gray-400 truncate mt-0.5">
                    {v.channel.title} · {v.project.title}
                  </p>
                </div>
                {/* Stats (published only) */}
                {v.status === 'PUBLISHED' && (
                  <div className="hidden md:flex items-center gap-4 text-xs text-gray-400 tabular-nums shrink-0">
                    <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {v.viewCount.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><ThumbsUp className="w-3.5 h-3.5" /> {v.likeCount.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> {v.commentCount.toLocaleString()}</span>
                  </div>
                )}
                {/* Date + status */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusBadge status={v.status} />
                  <span className="text-xs text-gray-400 tabular-nums">
                    {d ? format(d, 'd MMM yyyy, HH:mm') : '—'}
                  </span>
                </div>
              </button>
            );
          })}
          {hasNextPage && (
            <div className="p-3 flex justify-center" style={{ borderTop: '1px solid #f0edf9' }}>
              <button
                type="button"
                onClick={() => { void fetchNextPage(); }}
                disabled={isFetchingNextPage}
                className="px-4 py-2 text-sm font-semibold rounded-2xl text-gray-600 hover:bg-[#faf9ff] disabled:opacity-50 flex items-center gap-2 transition-colors"
                style={{ border: '1.5px solid #e3ddf8' }}
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,10,40,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={video.title}
        className="bg-white rounded-3xl w-full max-w-md overflow-hidden"
        style={{ border: '1.5px solid #e3ddf8' }}
      >
        {video.thumbnailUrl && (
          <img src={video.thumbnailUrl} alt="" className="w-full aspect-video object-cover bg-gray-100" />
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-bold text-gray-900">{video.title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-2xl hover:bg-[#faf9ff] text-gray-400 shrink-0 transition-colors"
              style={{ border: '1.5px solid #e3ddf8' }}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">{video.channel.title} · {video.project.title}</p>

          <div className="mt-4 space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Status</span>
              <StatusBadge status={video.status} />
            </div>
            {video.scheduledAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Scheduled for</span>
                <span className="text-gray-900 tabular-nums">{format(new Date(video.scheduledAt), 'd MMM yyyy, HH:mm')}</span>
              </div>
            )}
            {video.publishedAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Published on</span>
                <span className="text-gray-900 tabular-nums">{format(new Date(video.publishedAt), 'd MMM yyyy, HH:mm')}</span>
              </div>
            )}
            {video.status === 'PUBLISHED' && (
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Performance</span>
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
              className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-white text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
            >
              <ExternalLink className="w-4 h-4" /> Open on YouTube
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
