'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  RefreshCw,
  Loader2,
  CalendarClock,
  Check,
  X,
  XCircle,
  TrendingUp,
  Clapperboard,
  Film,
  BarChart3,
  ListChecks,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  api,
  type CalendarEntry,
  type ChannelProfileRow,
  type GenerateCalendarResult,
} from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';
import { Banner, type BannerState } from '@/components/banner';
import { StatCard } from '@/components/stat-card';

interface Channel {
  id: string;
  title: string;
}

const CHANNEL_LS_KEY = 'cf.autonomy.channelId';

export default function AutonomyPage() {
  const qc = useQueryClient();
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [weeks, setWeeks] = useState(2);
  const [perWeek, setPerWeek] = useState(3);
  const [preview, setPreview] = useState<GenerateCalendarResult | null>(null);
  const [critique, setCritique] = useState<string | null>(null);

  // Start empty on both server and client, then hydrate from localStorage —
  // reading localStorage in the initializer causes a hydration mismatch.
  const [channelId, setChannelId] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setChannelId(localStorage.getItem(CHANNEL_LS_KEY) ?? '');
    setHydrated(true);
  }, []);

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  useEffect(() => {
    if (hydrated && !channelId && channels.length > 0 && channels[0]) {
      setChannelId(channels[0].id);
      localStorage.setItem(CHANNEL_LS_KEY, channels[0].id);
    }
  }, [channels, channelId, hydrated]);

  const { data: profileRow, isFetching: profileLoading } = useQuery<ChannelProfileRow>({
    queryKey: ['autonomy-profile', channelId],
    queryFn: () => api.autonomy.profile(channelId).then((r) => r.data),
    enabled: !!channelId,
  });
  const profile = profileRow?.profile;

  const { data: entries = [], isLoading: entriesLoading } = useQuery<CalendarEntry[]>({
    queryKey: ['autonomy-calendar', channelId],
    queryFn: () => api.autonomy.listCalendar(channelId).then((r) => r.data),
    enabled: !!channelId,
  });

  const { data: stats } = useQuery({
    queryKey: ['autonomy-stats', channelId],
    queryFn: () => api.autonomy.calendarStats(channelId).then((r) => r.data),
    enabled: !!channelId,
  });

  const refreshProfile = useMutation({
    mutationFn: () => api.autonomy.profile(channelId, true),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['autonomy-profile', channelId] }); },
  });

  const generate = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.autonomy.generateCalendar(channelId, { weeks, perWeek, dryRun }).then((r) => r.data),
    onSuccess: (result) => {
      setCritique(result.critique);
      if (result.dryRun) {
        setPreview(result);
        setBanner({ type: 'info', message: `Dry run: ${result.entries.length} slots simulated (${result.source}). Nothing was saved.` });
      } else {
        setPreview(null);
        void qc.invalidateQueries({ queryKey: ['autonomy-calendar', channelId] });
        void qc.invalidateQueries({ queryKey: ['autonomy-stats', channelId] });
        setBanner({
          type: result.source === 'ai' ? 'success' : 'warning',
          message: result.source === 'ai'
            ? `AI proposed ${result.entries.length} calendar slots.`
            : `AI was unavailable — generated ${result.entries.length} heuristic slots from your cadence.`,
        });
      }
    },
    onError: (err: unknown) => { setBanner({ type: 'error', message: getErrorMessage(err) }); },
  });

  const approve = useMutation({
    mutationFn: (entryId: string) => api.autonomy.approveEntry(entryId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['autonomy-calendar', channelId] });
      void qc.invalidateQueries({ queryKey: ['autonomy-stats', channelId] });
      setBanner({ type: 'success', message: 'Slot approved — a draft video was created and parked at the planned time.' });
    },
    onError: (err: unknown) => { setBanner({ type: 'error', message: getErrorMessage(err) }); },
  });

  const dismiss = useMutation({
    mutationFn: (entryId: string) => api.autonomy.dismissEntry(entryId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['autonomy-calendar', channelId] });
      void qc.invalidateQueries({ queryKey: ['autonomy-stats', channelId] });
    },
    onError: (err: unknown) => { setBanner({ type: 'error', message: getErrorMessage(err) }); },
  });

  useEffect(() => { setSelected(new Set()); }, [channelId]);

  const bulkApprove = useMutation({
    mutationFn: (ids: string[]) => api.autonomy.bulkApprove(channelId, ids),
    onSuccess: (res) => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['autonomy-calendar', channelId] });
      void qc.invalidateQueries({ queryKey: ['autonomy-stats', channelId] });
      setBanner({ type: 'success', message: `${(res.data as { updated: number }).updated} slot(s) approved.` });
    },
    onError: (err: unknown) => { setBanner({ type: 'error', message: getErrorMessage(err) }); },
  });

  const bulkDismiss = useMutation({
    mutationFn: (ids: string[]) => api.autonomy.bulkDismiss(channelId, ids),
    onSuccess: () => {
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['autonomy-calendar', channelId] });
      void qc.invalidateQueries({ queryKey: ['autonomy-stats', channelId] });
    },
    onError: (err: unknown) => { setBanner({ type: 'error', message: getErrorMessage(err) }); },
  });

  const setTitle = useMutation({
    mutationFn: ({ entryId, title }: { entryId: string; title: string }) =>
      api.autonomy.updateEntryTitle(entryId, title),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['autonomy-calendar', channelId] });
    },
    onError: (err: unknown) => { setBanner({ type: 'error', message: getErrorMessage(err) }); },
  });

  function handleChannelChange(id: string) {
    setChannelId(id);
    setPreview(null);
    setCritique(null);
    localStorage.setItem(CHANNEL_LS_KEY, id);
  }

  const proposed = entries.filter((e) => e.status === 'PROPOSED');
  const approved = entries.filter((e) => e.status === 'APPROVED');

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-brand-600" />
            Autonomy
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Phase 6 — AI plans your content calendar; you stay in control of every approval
          </p>
        </div>
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
      </div>

      {banner && <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />}

      {!channelId && (
        <div className="flex flex-col items-center justify-center text-gray-500 py-20">
          <Sparkles className="w-12 h-12 mb-3 opacity-30" />
          <p>Select a channel to see its AI profile and content calendar.</p>
        </div>
      )}

      {channelId && (
        <>
          {/* Channel profile — the planner's long-term memory */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-brand-600" />
                Channel Profile
              </h2>
              <button
                type="button"
                onClick={() => { refreshProfile.mutate(); }}
                disabled={refreshProfile.isPending || profileLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {refreshProfile.isPending || profileLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <RefreshCw className="w-4 h-4" />}
                Rebuild profile
              </button>
            </div>
            {profile ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  tone="lilac"
                  icon={<TrendingUp className="w-5 h-5" />}
                  label="Uploads / week (90d)"
                  value={profile.uploadsPerWeek90d}
                  sub={`${profile.niche} · ${profile.subscriberCount.toLocaleString()} subs`}
                  subClassName="text-gray-600"
                />
                <StatCard
                  tone="periwinkle"
                  icon={<BarChart3 className="w-5 h-5" />}
                  label="Avg views (90d)"
                  value={profile.avgViews90d.toLocaleString()}
                />
                <StatCard
                  tone="pink"
                  icon={<CalendarClock className="w-5 h-5" />}
                  label="Best slots"
                  value={profile.bestWeekdays.map((d) => d.slice(0, 3)).join(', ') || '—'}
                  sub={`around ${String(profile.bestHourUtc).padStart(2, '0')}:00 UTC`}
                  subClassName="text-gray-600"
                />
                <StatCard
                  tone="cream"
                  icon={<Clapperboard className="w-5 h-5" />}
                  label="Format mix (90d)"
                  value={`${profile.formatMix.videos}v / ${profile.formatMix.shorts}s`}
                  sub="videos / shorts"
                  subClassName="text-gray-600"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
                <Loader2 className="w-4 h-4 animate-spin" /> Building profile…
              </div>
            )}
          </section>

          {/* Calendar stats bar */}
          {stats && stats.total > 0 && (
            <section className="bg-white border border-gray-200 rounded-2xl px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <ListChecks className="w-4 h-4 text-brand-600" />
                <span className="text-sm font-semibold text-gray-800">Calendar overview</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {stats.proposed > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                    <span className="font-bold">{stats.proposed}</span> pending review
                  </span>
                )}
                {stats.approved > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-100">
                    <Check className="w-3 h-3" /><span className="font-bold">{stats.approved}</span> approved
                  </span>
                )}
                {stats.dismissed > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                    <X className="w-3 h-3" /><span className="font-bold">{stats.dismissed}</span> dismissed
                  </span>
                )}
                {stats.upcoming7d > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-violet-50 text-violet-700 border border-violet-100">
                    <CalendarClock className="w-3 h-3" /><span className="font-bold">{stats.upcoming7d}</span> due this week
                  </span>
                )}
                {stats.approvalRate !== null && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border border-brand-100">
                    <TrendingUp className="w-3 h-3" /><span className="font-bold">{stats.approvalRate}%</span> approval rate
                  </span>
                )}
                {stats.avgPriority !== null && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
                    <BarChart3 className="w-3 h-3" />avg priority <span className="font-bold">{stats.avgPriority}</span>
                  </span>
                )}
              </div>
            </section>
          )}

          {/* Generation controls */}
          <section className="bg-white border border-gray-200 rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
              <CalendarClock className="w-5 h-5 text-brand-600" />
              Auto content calendar
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              The AI reads the profile and current trends, then proposes publish slots. Approve a slot to create a draft video; dismiss what doesn&apos;t fit.
            </p>
            <div className="flex items-end gap-4 flex-wrap">
              <label className="text-sm text-gray-600">
                Weeks
                <select
                  value={weeks}
                  onChange={(e) => { setWeeks(Number(e.target.value)); }}
                  className="block mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
              <label className="text-sm text-gray-600">
                Slots per week
                <select
                  value={perWeek}
                  onChange={(e) => { setPerWeek(Number(e.target.value)); }}
                  className="block mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={() => { generate.mutate(true); }}
                disabled={generate.isPending}
                className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Dry run
              </button>
              <button
                type="button"
                onClick={() => { generate.mutate(false); }}
                disabled={generate.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-[#9d6ff0] to-[#7c4fd8] text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                {generate.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Planning…</>
                  : <><Sparkles className="w-4 h-4" /> Generate calendar</>}
              </button>
            </div>

            {/* Self-critique summary from the second reasoning pass */}
            {critique && (
              <div className="mt-4 flex items-start gap-2 text-sm text-gray-600 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                <Sparkles className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                <p><span className="font-medium text-gray-700">Self-critique:</span> {critique}</p>
              </div>
            )}

            {/* Dry-run preview */}
            {preview && (
              <div className="mt-5 border border-dashed border-brand-300 rounded-xl p-4 bg-brand-50/40">
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Simulation preview ({preview.source}) — not saved
                </p>
                <ul className="space-y-1">
                  {preview.entries.map((e, i) => (
                    <li key={i} className="text-sm text-gray-600 flex items-center gap-2">
                      <span className="text-xs text-gray-500 tabular-nums w-32 shrink-0">
                        {format(new Date(e.plannedAt), 'EEE d MMM, HH:mm')}
                      </span>
                      {e.format === 'SHORT' ? <Clapperboard className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <Film className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                      <span className="truncate">{e.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Proposals */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-3">
                Proposed slots
                {proposed.length > 0 && <span className="text-sm font-normal text-gray-500">({proposed.length} awaiting review)</span>}
              </h2>
              {proposed.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={proposed.every((e) => selected.has(e.id))}
                    onChange={(ev) => {
                      if (ev.target.checked) setSelected(new Set(proposed.map((e) => e.id)));
                      else setSelected(new Set());
                    }}
                    className="w-4 h-4 rounded border-gray-300 text-violet-600 cursor-pointer"
                  />
                  Select all
                </label>
              )}
            </div>
            {entriesLoading && (
              <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading calendar…
              </div>
            )}
            {!entriesLoading && proposed.length === 0 && (
              <p className="text-sm text-gray-500 py-4">Nothing awaiting review. Generate a calendar to get proposals.</p>
            )}
            <div className="space-y-2">
              {proposed.map((e) => (
                <div key={e.id} className={`bg-white border rounded-xl p-4 flex items-center gap-4 transition-colors ${selected.has(e.id) ? 'border-violet-300 bg-violet-50/30' : 'border-gray-200'}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={(ev) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        ev.target.checked ? next.add(e.id) : next.delete(e.id);
                        return next;
                      });
                    }}
                    className="w-4 h-4 rounded border-gray-300 text-violet-600 cursor-pointer flex-shrink-0"
                  />
                  <div className="w-14 text-center shrink-0">
                    <p className="text-xs text-gray-500">{format(new Date(e.plannedAt), 'EEE')}</p>
                    <p className="text-lg font-bold text-gray-900 leading-tight">{format(new Date(e.plannedAt), 'd')}</p>
                    <p className="text-xs text-gray-500">{format(new Date(e.plannedAt), 'MMM')}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate flex items-center gap-2">
                      {e.format === 'SHORT'
                        ? <Clapperboard className="w-4 h-4 text-gray-400 shrink-0" />
                        : <Film className="w-4 h-4 text-gray-400 shrink-0" />}
                      {e.title}
                    </p>
                    {e.angle && <p className="text-sm text-gray-500 truncate mt-0.5">{e.angle}</p>}
                    {e.titleVariants && e.titleVariants.length > 0 && (
                      <div className="mt-1.5">
                        <p className="text-xs text-gray-400 mb-0.5">Alt titles:</p>
                        <div className="flex flex-col gap-0.5">
                          {e.titleVariants.map((v, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => { setTitle.mutate({ entryId: e.id, title: v }); }}
                              title="Use this title"
                              className="text-xs text-left text-gray-500 hover:text-violet-700 hover:bg-violet-50 px-2 py-0.5 rounded border border-transparent hover:border-violet-200 transition-colors"
                            >
                              {v}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      {format(new Date(e.plannedAt), 'HH:mm')} UTC
                      {e.keywords.length > 0 && <> · {e.keywords.slice(0, 4).join(', ')}</>}
                      {e.source === 'heuristic' && <> · heuristic</>}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full shrink-0 ${
                      e.priority >= 70 ? 'bg-green-100 text-green-700' : e.priority >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                    }`}
                    title="Opportunity score"
                  >
                    {e.priority}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => { approve.mutate(e.id); }}
                      disabled={approve.isPending || dismiss.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => { dismiss.mutate(e.id); }}
                      disabled={approve.isPending || dismiss.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:border-red-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <X className="w-4 h-4" /> Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {approved.length > 0 && (
              <>
                <h3 className="text-sm font-semibold text-gray-700 mt-6 mb-2">
                  Approved ({approved.length}) — draft videos created, visible in the Scheduler
                </h3>
                <div className="space-y-1.5">
                  {approved.map((e) => (
                    <div key={e.id} className="flex items-center gap-3 text-sm text-gray-600 bg-green-50/50 border border-green-100 rounded-lg px-3 py-2">
                      <Check className="w-4 h-4 text-green-600 shrink-0" />
                      <span className="tabular-nums text-xs text-gray-500 w-32 shrink-0">{format(new Date(e.plannedAt), 'EEE d MMM, HH:mm')}</span>
                      <span className="truncate">{e.title}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white border border-gray-200 rounded-full px-5 py-3 shadow-xl">
          <span className="text-sm font-medium text-gray-700">{selected.size} selected</span>
          <button
            type="button"
            onClick={() => { bulkApprove.mutate(Array.from(selected)); }}
            disabled={bulkApprove.isPending || bulkDismiss.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 text-white rounded-full text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {bulkApprove.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Approve all
          </button>
          <button
            type="button"
            onClick={() => { bulkDismiss.mutate(Array.from(selected)); }}
            disabled={bulkApprove.isPending || bulkDismiss.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-200 text-gray-700 rounded-full text-sm font-semibold hover:bg-gray-300 disabled:opacity-50"
          >
            {bulkDismiss.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
            Dismiss all
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
