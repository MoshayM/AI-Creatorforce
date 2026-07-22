'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, RefreshCw, Loader2, CalendarClock, Check, X, XCircle,
  TrendingUp, Clapperboard, Film, BarChart3, ListChecks, Target,
  ScrollText, Save, Settings2,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  api, apiClient,
  type CalendarEntry, type ChannelProfileRow,
  type GenerateCalendarResult, type ChannelAutomation,
} from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';
import { Banner, type BannerState } from '@/components/banner';
import { StatCard } from '@/components/stat-card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Channel { id: string; title: string; }

interface AuditLogEntry {
  id: string; action: string; meta: Record<string, unknown>; createdAt: string;
}

interface CrossChannelInsight {
  category: string; recommendation: string; priority: 'high' | 'medium' | 'low';
}
interface CrossChannelData { insights: CrossChannelInsight[]; summary?: string; }

type Tab = 'planner' | 'settings' | 'insights' | 'log';

const CHANNEL_LS_KEY = 'cf.autopilot.channelId';

const PUBLISH_INTERVAL_MIN = 15, PUBLISH_INTERVAL_MAX = 1440;
const PUBLISHES_PER_DAY_MIN = 1, PUBLISHES_PER_DAY_MAX = 10;
const IMPORTS_PER_DAY_MIN   = 1, IMPORTS_PER_DAY_MAX   = 10;
function clamp(v: number, mn: number, mx: number) { return Math.min(mx, Math.max(mn, v)); }

const DEFAULT_FORM: Omit<ChannelAutomation, 'aiSuggestion' | 'lastTickAt'> = {
  enabled: false, autoImport: false, autoAnalyze: false, autoPublish: false,
  chapterSyncEnabled: false, autoPlan: false, autoResearch: false,
  publishIntervalMinutes: 60, maxPublishesPerDay: 3, maxImportsPerDay: 5,
};

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AE0] disabled:opacity-50"
      style={{ background: checked ? '#6D4AE0' : '#e5e7eb' }}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AutopilotPage() {
  const qc = useQueryClient();
  const [banner, setBanner]   = useState<BannerState | null>(null);
  const [tab, setTab]         = useState<Tab>('planner');

  // channel
  const [channelId, setChannelId] = useState('');
  const [hydrated,  setHydrated]  = useState(false);
  useEffect(() => { setChannelId(localStorage.getItem(CHANNEL_LS_KEY) ?? ''); setHydrated(true); }, []);

  function selectChannel(id: string) {
    setChannelId(id);
    if (id) localStorage.setItem(CHANNEL_LS_KEY, id);
  }

  // reset derived state when channel changes
  useEffect(() => {
    setPreview(null); setCritique(null);
    setAiSuggestionSource(null); setSelected(new Set());
  }, [channelId]);

  // ── Planner state ─────────────────────────────────────────────────────────
  const [weeks,   setWeeks]   = useState(2);
  const [perWeek, setPerWeek] = useState(3);
  const [preview,  setPreview]  = useState<GenerateCalendarResult | null>(null);
  const [critique, setCritique] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Feedback form state ───────────────────────────────────────────────────
  const [fbVideoId,  setFbVideoId]  = useState('');
  const [fbViews,    setFbViews]    = useState('');
  const [fbLikes,    setFbLikes]    = useState('');
  const [fbCtr,      setFbCtr]      = useState('');
  const [fbDuration, setFbDuration] = useState('');
  const [fbLoading,  setFbLoading]  = useState(false);

  // ── Settings (Automation) form state ─────────────────────────────────────
  const [form, setForm] = useState<Omit<ChannelAutomation, 'aiSuggestion' | 'lastTickAt'>>(DEFAULT_FORM);
  const [aiSuggestionSource, setAiSuggestionSource] = useState<'ai' | 'heuristic' | null>(null);

  function setField<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setAiSuggestionSource(null);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  useEffect(() => {
    if (hydrated && !channelId && channels.length > 0 && channels[0])
      selectChannel(channels[0].id);
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

  const { data: crossChannel } = useQuery<CrossChannelData>({
    queryKey: ['cross-channel-insights'],
    queryFn: () => apiClient.get('/autonomy/insights/cross-channel').then((r) => r.data as CrossChannelData),
    enabled: channels.length > 1 && tab === 'insights',
  });

  const { data: auditLog = [], isFetching: auditLogLoading } = useQuery({
    queryKey: ['autonomy-audit-log', channelId],
    queryFn: () => api.autonomy.auditLog(channelId, 30).then((r) => r.data as AuditLogEntry[]),
    enabled: !!channelId && tab === 'log',
  });

  // Load automation data eagerly so the ON/OFF pill is always accurate
  const { data: automationData, isLoading: loadingAutomation } = useQuery<ChannelAutomation>({
    queryKey: ['automation', channelId],
    queryFn: () => api.automation.get(channelId).then((r) => r.data),
    enabled: !!channelId,
  });
  useEffect(() => {
    if (!automationData) return;
    setForm({
      enabled: automationData.enabled, autoImport: automationData.autoImport,
      autoAnalyze: automationData.autoAnalyze, autoPublish: automationData.autoPublish,
      chapterSyncEnabled: automationData.chapterSyncEnabled, autoPlan: automationData.autoPlan,
      autoResearch: automationData.autoResearch,
      publishIntervalMinutes: automationData.publishIntervalMinutes,
      maxPublishesPerDay: automationData.maxPublishesPerDay,
      maxImportsPerDay: automationData.maxImportsPerDay,
    });
    setAiSuggestionSource(null);
  }, [automationData]);

  // ── Mutations ─────────────────────────────────────────────────────────────

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
        setBanner({ type: 'info', message: `Dry run: ${result.entries.length} slots simulated (${result.source}). Nothing saved.` });
      } else {
        setPreview(null);
        void qc.invalidateQueries({ queryKey: ['autonomy-calendar', channelId] });
        void qc.invalidateQueries({ queryKey: ['autonomy-stats', channelId] });
        setBanner({
          type: result.source === 'ai' ? 'success' : 'warning',
          message: result.source === 'ai'
            ? `AI proposed ${result.entries.length} calendar slots.`
            : `AI was unavailable — ${result.entries.length} heuristic slots generated.`,
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
      setBanner({ type: 'success', message: 'Slot approved — draft video created.' });
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

  const setTitle = useMutation({
    mutationFn: ({ entryId, title }: { entryId: string; title: string }) =>
      api.autonomy.updateEntryTitle(entryId, title),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['autonomy-calendar', channelId] }); },
    onError: (err: unknown) => { setBanner({ type: 'error', message: getErrorMessage(err) }); },
  });

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

  const saveMutation = useMutation({
    mutationFn: () => api.automation.update(channelId, form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['automation', channelId] });
      setBanner({ type: 'success', message: 'Settings saved.' });
    },
    onError: () => { setBanner({ type: 'error', message: 'Failed to save. Try again.' }); },
  });

  const suggestMutation = useMutation({
    mutationFn: () => api.automation.suggest(channelId),
    onSuccess: (res) => {
      const { suggestion, source } = res.data;
      setForm({
        enabled: suggestion.enabled, autoImport: suggestion.autoImport,
        autoAnalyze: suggestion.autoAnalyze, autoPublish: suggestion.autoPublish,
        chapterSyncEnabled: suggestion.chapterSyncEnabled, autoPlan: suggestion.autoPlan,
        autoResearch: suggestion.autoResearch,
        publishIntervalMinutes: clamp(suggestion.publishIntervalMinutes, PUBLISH_INTERVAL_MIN, PUBLISH_INTERVAL_MAX),
        maxPublishesPerDay:     clamp(suggestion.maxPublishesPerDay,     PUBLISHES_PER_DAY_MIN, PUBLISHES_PER_DAY_MAX),
        maxImportsPerDay:       clamp(suggestion.maxImportsPerDay,       IMPORTS_PER_DAY_MIN,   IMPORTS_PER_DAY_MAX),
      });
      setAiSuggestionSource(source);
      setBanner({ type: 'info', message: 'Review the suggested settings below, then save when ready.' });
    },
    onError: () => { setBanner({ type: 'error', message: 'Could not generate suggestion. Try again.' }); },
  });

  async function submitFeedback() {
    if (!fbVideoId || !fbViews || !channelId) return;
    setFbLoading(true);
    try {
      await apiClient.post(`/autonomy/channels/${channelId}/profile/feedback`, {
        ytVideoId: fbVideoId, views: Number(fbViews),
        likeCount: fbLikes    ? Number(fbLikes)    : undefined,
        ctr:       fbCtr      ? Number(fbCtr) / 100 : undefined,
        avgViewDurationSecs: fbDuration ? Number(fbDuration) : undefined,
      });
      setBanner({ type: 'success', message: 'Performance recorded — profile improves on next generation.' });
      setFbVideoId(''); setFbViews(''); setFbLikes(''); setFbCtr(''); setFbDuration('');
    } catch {
      setBanner({ type: 'error', message: 'Failed to record feedback.' });
    } finally {
      setFbLoading(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const proposed = entries.filter((e) => e.status === 'PROPOSED');
  const approved  = entries.filter((e) => e.status === 'APPROVED');

  const healthScore = stats
    ? Math.round(((stats.approvalRate ?? 0) / 100 * 0.5
        + Math.min((stats.upcoming7d ?? 0) / 7, 1) * 0.3
        + Math.min((stats.total ?? 0) / 10, 1) * 0.2) * 100)
    : null;

  const TABS: { id: Tab; icon: React.ElementType; label: string; badge?: string }[] = [
    { id: 'planner',  icon: CalendarClock, label: 'Planner',  badge: proposed.length > 0 ? String(proposed.length) : undefined },
    { id: 'settings', icon: Settings2,     label: 'Settings' },
    { id: 'insights', icon: BarChart3,     label: 'Insights' },
    { id: 'log',      icon: ScrollText,    label: 'Log'      },
  ];

  const featureToggles: Array<{
    key: keyof Pick<typeof form, 'autoImport'|'autoAnalyze'|'autoPublish'|'chapterSyncEnabled'|'autoPlan'|'autoResearch'>;
    label: string; description: string;
  }> = [
    { key: 'autoImport',         label: 'Auto-import new uploads',      description: 'Imports recent long-form uploads into Shorts Studio automatically.' },
    { key: 'autoAnalyze',        label: 'Auto-analyze imported videos', description: 'Runs transcript, scene, and highlight analysis as soon as a video is imported.' },
    { key: 'autoPublish',        label: 'Auto-publish approved Shorts', description: 'Publishes clips you approved, paced by the limits below — never bypasses compliance.' },
    { key: 'chapterSyncEnabled', label: 'Keep chapters synced',         description: 'Automatically syncs YouTube chapter markers from source videos.' },
    { key: 'autoPlan',           label: 'Auto-plan content calendar',   description: 'Daily: refreshes the channel profile and tops up the AI content calendar. Proposals only — you approve every slot in Planner.' },
    { key: 'autoResearch',       label: 'Auto-research on approve',     description: 'When you approve a calendar slot, automatically starts a Research job for the draft video.' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg,#6D4AE0,#7c5ae8)', boxShadow: '0 4px 14px -4px rgba(109,74,224,.45)' }}>
                <Sparkles className="w-[18px] h-[18px] text-white" />
              </span>
              Autopilot
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">AI runs your pipeline — you stay in control of every approval</p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Live ON/OFF pill — always visible when a channel is loaded */}
            {channelId && !loadingAutomation && (
              <button
                type="button"
                title={form.enabled ? 'Click to pause autopilot' : 'Click to activate autopilot'}
                onClick={() => { setField('enabled', !form.enabled); void saveMutation.mutateAsync(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={form.enabled
                  ? { background: '#ecfdf5', color: '#065f46', border: '1.5px solid #a7f3d0' }
                  : { background: '#f3f4f6', color: '#6b7280', border: '1.5px solid #e5e7eb' }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
                  style={{ background: form.enabled ? '#22c55e' : '#9ca3af' }} />
                {form.enabled ? 'Autopilot ON' : 'Autopilot OFF'}
              </button>
            )}

            <select
              value={channelId}
              onChange={(e) => selectChannel(e.target.value)}
              className="bg-white rounded-2xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
              style={{ border: '1.5px solid #e3e0f0' }}
              aria-label="Select channel"
            >
              <option value="">Select a channel…</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        </div>

        {banner && <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />}

        {/* Empty state */}
        {!channelId && (
          <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'linear-gradient(135deg,#f0edf9,#e3ddf8)' }}>
              <Sparkles className="w-8 h-8" style={{ color: '#6D4AE0' }} />
            </div>
            <p className="font-semibold text-gray-700">Select a channel to get started</p>
            <p className="text-sm text-gray-400 mt-1">Configure automation and let AI plan your content calendar.</p>
          </div>
        )}

        {channelId && (
          <>
            {/* ── Tabs ──────────────────────────────────────────────────── */}
            <div className="flex bg-gray-100 rounded-2xl p-1">
              {TABS.map(({ id, icon: Icon, label, badge }) => (
                <button
                  key={id} type="button"
                  onClick={() => setTab(id)}
                  className={`flex-1 relative flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-xl transition-colors
                    ${tab === id ? 'bg-white shadow text-[#6D4AE0]' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {badge && (
                    <span className="absolute -top-1.5 -right-1 min-w-[20px] h-5 px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                      style={{ background: '#6D4AE0' }}>
                      {badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* PLANNER TAB                                                 */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {tab === 'planner' && (
              <div className="space-y-5">
                {/* Channel profile */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5" style={{ color: '#6D4AE0' }} /> Channel Profile
                    </h2>
                    <button type="button" onClick={() => refreshProfile.mutate()}
                      disabled={refreshProfile.isPending || profileLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 text-sm rounded-2xl hover:bg-gray-50 disabled:opacity-50"
                      style={{ border: '1.5px solid #e3ddf8' }}>
                      {refreshProfile.isPending || profileLoading
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <RefreshCw className="w-4 h-4" />}
                      Rebuild profile
                    </button>
                  </div>
                  {profile ? (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <StatCard tone="lilac"      icon={<TrendingUp   className="w-5 h-5" />} label="Uploads / week (90d)" value={profile.uploadsPerWeek90d} sub={`${profile.niche} · ${profile.subscriberCount.toLocaleString()} subs`} subClassName="text-gray-600" />
                      <StatCard tone="periwinkle" icon={<BarChart3    className="w-5 h-5" />} label="Avg views (90d)"      value={profile.avgViews90d.toLocaleString()} />
                      <StatCard tone="pink"       icon={<CalendarClock className="w-5 h-5" />} label="Best slots"          value={profile.bestWeekdays.map((d) => d.slice(0, 3)).join(', ') || '—'} sub={`around ${String(profile.bestHourUtc).padStart(2,'0')}:00 UTC`} subClassName="text-gray-600" />
                      <StatCard tone="cream"      icon={<Clapperboard  className="w-5 h-5" />} label="Format mix (90d)"    value={`${profile.formatMix.videos}v / ${profile.formatMix.shorts}s`} sub="videos / shorts" subClassName="text-gray-600" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
                      <Loader2 className="w-4 h-4 animate-spin" /> Building profile…
                    </div>
                  )}
                </section>

                {/* Calendar stats bar */}
                {stats && stats.total > 0 && (
                  <section className="bg-white rounded-2xl px-5 py-4" style={{ border: '1.5px solid #e3ddf8' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <ListChecks className="w-4 h-4" style={{ color: '#6D4AE0' }} />
                      <span className="text-sm font-semibold text-gray-800">Calendar overview</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {stats.proposed   > 0          && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100"><span className="font-bold">{stats.proposed}</span> pending review</span>}
                      {stats.approved   > 0          && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background:'#ecfdf5',color:'#065f46',border:'1px solid #a7f3d0' }}><Check className="w-3 h-3" /><span className="font-bold">{stats.approved}</span> approved</span>}
                      {stats.dismissed  > 0          && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background:'#f3f4f6',color:'#4b5563',border:'1px solid #e5e7eb' }}><X className="w-3 h-3" /><span className="font-bold">{stats.dismissed}</span> dismissed</span>}
                      {stats.upcoming7d > 0          && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background:'#f5f2fd',color:'#6D4AE0',border:'1px solid #e3ddf8' }}><CalendarClock className="w-3 h-3" /><span className="font-bold">{stats.upcoming7d}</span> due this week</span>}
                      {stats.approvalRate !== null   && <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium" style={{ background:'#f5f2fd',color:'#6D4AE0',border:'1px solid #e3ddf8' }}><TrendingUp className="w-3 h-3" /><span className="font-bold">{stats.approvalRate}%</span> approval rate</span>}
                    </div>
                  </section>
                )}

                {/* Generate controls */}
                <section className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
                    <CalendarClock className="w-5 h-5" style={{ color: '#6D4AE0' }} /> Generate calendar
                  </h2>
                  <p className="text-sm text-gray-400 mb-4">
                    AI reads your profile and current trends, then proposes publish slots. Approve to create a draft; dismiss what doesn&apos;t fit.
                  </p>
                  <div className="flex items-end gap-4 flex-wrap">
                    <label className="text-sm text-gray-600">
                      Weeks
                      <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}
                        className="block mt-1 bg-white rounded-2xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                        style={{ border: '1.5px solid #e3e0f0' }}>
                        {[1,2,3,4].map((w) => <option key={w} value={w}>{w}</option>)}
                      </select>
                    </label>
                    <label className="text-sm text-gray-600">
                      Slots per week
                      <select value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))}
                        className="block mt-1 bg-white rounded-2xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                        style={{ border: '1.5px solid #e3e0f0' }}>
                        {[1,2,3,4,5,6,7].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => generate.mutate(true)} disabled={generate.isPending}
                      className="px-4 py-2 rounded-2xl text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      style={{ border: '1.5px solid #e3ddf8' }}>
                      Dry run
                    </button>
                    <button type="button" onClick={() => generate.mutate(false)} disabled={generate.isPending}
                      className="flex items-center gap-2 px-5 py-2 rounded-2xl font-bold text-white disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg,#6D4AE0 0%,#7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,.35)' }}>
                      {generate.isPending
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Planning…</>
                        : <><Sparkles className="w-4 h-4" /> Generate calendar</>}
                    </button>
                  </div>
                  {critique && (
                    <div className="mt-4 flex items-start gap-2 text-sm text-gray-600 rounded-2xl px-4 py-3"
                      style={{ background: '#f5f2fd', border: '1.5px solid #e3ddf8' }}>
                      <Sparkles className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#6D4AE0' }} />
                      <p><span className="font-medium text-gray-700">Self-critique:</span> {critique}</p>
                    </div>
                  )}
                  {preview && (
                    <div className="mt-5 rounded-2xl p-4" style={{ border: '1.5px dashed #e3ddf8', background: '#faf9ff' }}>
                      <p className="text-sm font-medium text-gray-700 mb-2">
                        Simulation preview ({preview.source}) — not saved
                      </p>
                      <ul className="space-y-1">
                        {preview.entries.map((e, i) => (
                          <li key={i} className="text-sm text-gray-600 flex items-center gap-2">
                            <span className="text-xs text-gray-500 tabular-nums w-32 shrink-0">
                              {format(new Date(e.plannedAt), 'EEE d MMM, HH:mm')}
                            </span>
                            {e.format === 'SHORT'
                              ? <Clapperboard className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              : <Film         className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                            <span className="truncate">{e.title}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>

                {/* Proposed slots */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-3">
                      Proposed slots
                      {proposed.length > 0 && <span className="text-sm font-normal text-gray-500">({proposed.length} awaiting review)</span>}
                    </h2>
                    {proposed.length > 0 && (
                      <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer select-none">
                        <input type="checkbox"
                          checked={proposed.every((e) => selected.has(e.id))}
                          onChange={(ev) => { if (ev.target.checked) setSelected(new Set(proposed.map((e) => e.id))); else setSelected(new Set()); }}
                          className="w-4 h-4 rounded border-gray-300 text-[#6D4AE0] cursor-pointer" />
                        Select all
                      </label>
                    )}
                  </div>
                  {entriesLoading && <div className="flex items-center gap-2 text-gray-500 text-sm py-6"><Loader2 className="w-4 h-4 animate-spin" /> Loading calendar…</div>}
                  {!entriesLoading && proposed.length === 0 && <p className="text-sm text-gray-500 py-4">Nothing awaiting review. Generate a calendar to get proposals.</p>}
                  <div className="space-y-2">
                    {proposed.map((e) => (
                      <div key={e.id} className="bg-white rounded-2xl p-4 flex items-center gap-4"
                        style={{ border: selected.has(e.id) ? '1.5px solid #6D4AE0' : '1.5px solid #e3ddf8', background: selected.has(e.id) ? '#faf9ff' : '#fff' }}>
                        <input type="checkbox" checked={selected.has(e.id)}
                          onChange={(ev) => { setSelected((prev) => { const next = new Set(prev); ev.target.checked ? next.add(e.id) : next.delete(e.id); return next; }); }}
                          className="w-4 h-4 rounded border-gray-300 text-[#6D4AE0] cursor-pointer flex-shrink-0" />
                        <div className="w-14 text-center shrink-0">
                          <p className="text-xs text-gray-500">{format(new Date(e.plannedAt), 'EEE')}</p>
                          <p className="text-lg font-bold text-gray-900 leading-tight">{format(new Date(e.plannedAt), 'd')}</p>
                          <p className="text-xs text-gray-500">{format(new Date(e.plannedAt), 'MMM')}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate flex items-center gap-2">
                            {e.format === 'SHORT'
                              ? <Clapperboard className="w-4 h-4 text-gray-400 shrink-0" />
                              : <Film         className="w-4 h-4 text-gray-400 shrink-0" />}
                            {e.title}
                          </p>
                          {e.angle && <p className="text-sm text-gray-500 truncate mt-0.5">{e.angle}</p>}
                          {e.titleVariants && e.titleVariants.length > 0 && (
                            <div className="mt-1.5">
                              <p className="text-xs text-gray-400 mb-0.5">Alt titles:</p>
                              <div className="flex flex-col gap-0.5">
                                {e.titleVariants.map((v, ti) => (
                                  <button key={ti} type="button" onClick={() => setTitle.mutate({ entryId: e.id, title: v })}
                                    className="text-xs text-left text-gray-500 hover:text-[#6D4AE0] px-2 py-0.5 rounded-xl border border-transparent hover:border-[#e3ddf8] hover:bg-[#f5f2fd] transition-colors">
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
                        <span className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full shrink-0"
                          title="Opportunity score"
                          style={e.priority >= 70
                            ? { background: '#ecfdf5', color: '#065f46' }
                            : e.priority >= 40
                            ? { background: '#fff7ed', color: '#c2410c' }
                            : { background: '#f3f4f6', color: '#4b5563' }}>
                          {e.priority}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <button type="button" onClick={() => approve.mutate(e.id)}
                            disabled={approve.isPending || dismiss.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-2xl hover:bg-green-700 disabled:opacity-50">
                            <Check className="w-4 h-4" /> Approve
                          </button>
                          <button type="button" onClick={() => dismiss.mutate(e.id)}
                            disabled={approve.isPending || dismiss.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-gray-600 text-sm rounded-2xl hover:border-red-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                            style={{ border: '1.5px solid #e3ddf8' }}>
                            <X className="w-4 h-4" /> Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {approved.length > 0 && (
                    <>
                      <h3 className="text-sm font-semibold text-gray-700 mt-6 mb-2">
                        Approved ({approved.length}) — draft videos created, visible in Scheduler
                      </h3>
                      <div className="space-y-1.5">
                        {approved.map((e) => (
                          <div key={e.id} className="flex items-center gap-3 text-sm text-gray-600 rounded-2xl px-3 py-2"
                            style={{ background: '#ecfdf5', border: '1.5px solid #a7f3d0' }}>
                            <Check className="w-4 h-4 text-green-600 shrink-0" />
                            <span className="tabular-nums text-xs text-gray-500 w-32 shrink-0">{format(new Date(e.plannedAt), 'EEE d MMM, HH:mm')}</span>
                            <span className="truncate">{e.title}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* SETTINGS TAB                                                */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {tab === 'settings' && (
              <div className="space-y-4">
                {loadingAutomation ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#6D4AE0' }} />
                  </div>
                ) : (
                  <>
                    <div className="bg-white rounded-2xl divide-y" style={{ border: '1.5px solid #e3ddf8' }}>
                      {/* Master toggle */}
                      <div className="flex items-center justify-between gap-4 px-6 py-5">
                        <div>
                          <p className="font-semibold text-gray-900">Enable Autopilot for this channel</p>
                          <p className="text-sm text-gray-400 mt-0.5">When off, all automated tasks are paused.</p>
                        </div>
                        <Toggle checked={form.enabled} onChange={(v) => setField('enabled', v)} />
                      </div>

                      {/* Feature toggles */}
                      {featureToggles.map(({ key, label, description }) => (
                        <div key={key} className="flex items-center justify-between gap-4 px-6 py-4">
                          <div>
                            <p className="text-sm font-medium text-gray-800">{label}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{description}</p>
                          </div>
                          <Toggle checked={form[key]} onChange={(v) => setField(key, v)} disabled={!form.enabled} />
                        </div>
                      ))}

                      {/* Rate limits */}
                      <div className="px-6 py-5 space-y-4">
                        <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400">Publishing &amp; import limits</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label htmlFor="publishInterval" className="block text-xs font-medium text-gray-500 mb-1">Interval between publishes (min)</label>
                            <input id="publishInterval" type="number" min={PUBLISH_INTERVAL_MIN} max={PUBLISH_INTERVAL_MAX}
                              value={form.publishIntervalMinutes} disabled={!form.enabled}
                              onChange={(e) => setField('publishIntervalMinutes', clamp(Number(e.target.value), PUBLISH_INTERVAL_MIN, PUBLISH_INTERVAL_MAX))}
                              className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 disabled:opacity-50"
                              style={{ border: '1.5px solid #e3e0f0' }} />
                            <p className="text-[11px] text-gray-400 mt-1">15 – 1440 min</p>
                          </div>
                          <div>
                            <label htmlFor="maxPublishes" className="block text-xs font-medium text-gray-500 mb-1">Max publishes / day</label>
                            <input id="maxPublishes" type="number" min={PUBLISHES_PER_DAY_MIN} max={PUBLISHES_PER_DAY_MAX}
                              value={form.maxPublishesPerDay} disabled={!form.enabled}
                              onChange={(e) => setField('maxPublishesPerDay', clamp(Number(e.target.value), PUBLISHES_PER_DAY_MIN, PUBLISHES_PER_DAY_MAX))}
                              className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 disabled:opacity-50"
                              style={{ border: '1.5px solid #e3e0f0' }} />
                            <p className="text-[11px] text-gray-400 mt-1">1 – 10</p>
                          </div>
                          <div>
                            <label htmlFor="maxImports" className="block text-xs font-medium text-gray-500 mb-1">Max imports / day</label>
                            <input id="maxImports" type="number" min={IMPORTS_PER_DAY_MIN} max={IMPORTS_PER_DAY_MAX}
                              value={form.maxImportsPerDay} disabled={!form.enabled}
                              onChange={(e) => setField('maxImportsPerDay', clamp(Number(e.target.value), IMPORTS_PER_DAY_MIN, IMPORTS_PER_DAY_MAX))}
                              className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 disabled:opacity-50"
                              style={{ border: '1.5px solid #e3e0f0' }} />
                            <p className="text-[11px] text-gray-400 mt-1">1 – 10</p>
                          </div>
                        </div>
                      </div>

                      {/* AI suggestion note */}
                      {aiSuggestionSource && (
                        <div className="px-6 py-3" style={{ background: '#f5f2fd', borderTop: '1.5px solid #e3ddf8' }}>
                          <p className="text-xs flex items-center gap-1.5" style={{ color: '#6D4AE0' }}>
                            <Sparkles className="w-3.5 h-3.5" />
                            {aiSuggestionSource === 'ai'
                              ? 'AI suggestion — review and save when ready.'
                              : 'Based on your upload cadence — review and save when ready.'}
                          </p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center justify-between gap-3 px-6 py-4">
                        <button type="button" onClick={() => suggestMutation.mutate()} disabled={suggestMutation.isPending}
                          className="flex items-center gap-2 px-4 py-2 rounded-2xl font-semibold text-sm disabled:opacity-50 hover:bg-gray-50"
                          style={{ border: '1.5px solid #e3ddf8', color: '#6D4AE0' }}>
                          {suggestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                          Suggest with AI
                        </button>
                        <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
                          className="flex items-center gap-2 px-5 py-2 rounded-2xl font-bold text-white text-sm disabled:opacity-50"
                          style={{ background: 'linear-gradient(135deg,#6D4AE0 0%,#7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,.35)' }}>
                          {saveMutation.isPending
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                            : <><Save className="w-4 h-4" /> Save settings</>}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 text-center">
                      Auto-publish never bypasses review: only approved, compliance-passed Shorts are published.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* INSIGHTS TAB                                                */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {tab === 'insights' && (
              <div className="space-y-5">
                {/* Calendar health metrics */}
                {stats && (
                  <section className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <ListChecks className="w-5 h-5" style={{ color: '#6D4AE0' }} /> Calendar Health
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Approval Rate',   value: `${stats.approvalRate ?? 0}%`, color: (stats.approvalRate ?? 0) >= 60 ? 'text-green-700 bg-green-50' : (stats.approvalRate ?? 0) >= 30 ? 'text-amber-700 bg-amber-50' : 'text-red-700 bg-red-50' },
                        { label: 'Upcoming (7d)',   value: stats.upcoming7d,  color: 'text-blue-700 bg-blue-50' },
                        { label: 'Total Proposals', value: stats.total,       color: 'text-gray-700 bg-gray-50' },
                        { label: 'Approved',        value: stats.approved,    color: 'text-green-700 bg-green-50' },
                        { label: 'Dismissed',       value: stats.dismissed,   color: 'text-red-700 bg-red-50' },
                        { label: 'Scheduled',       value: stats.scheduled,   color: 'text-[#6D4AE0] bg-[#f5f2fd]' },
                      ].map((m) => (
                        <div key={m.label} className={`rounded-2xl p-3 ${m.color}`}>
                          <p className="text-xs font-medium opacity-70">{m.label}</p>
                          <p className="text-2xl font-bold mt-0.5">{m.value}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Health score */}
                {healthScore !== null && (
                  <section className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <Target className="w-5 h-5" style={{ color: '#6D4AE0' }} /> Autopilot Health Score
                    </h2>
                    <div className="flex items-end gap-2 mb-2">
                      <span className={`text-5xl font-bold ${healthScore >= 70 ? 'text-green-600' : healthScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{healthScore}</span>
                      <span className="text-gray-400 text-xl mb-1">/ 100</span>
                    </div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden mb-3">
                      <div className={`h-full rounded-full transition-all ${healthScore >= 70 ? 'bg-green-500' : healthScore >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                        style={{ width: `${healthScore}%` }} />
                    </div>
                    <p className="text-sm text-gray-600">
                      {healthScore >= 70 ? "Good — your AI pipeline is running smoothly."
                        : healthScore >= 40 ? "Fair — consider approving more proposals or generating new ones."
                        : "Needs attention — generate proposals and review pending slots."}
                    </p>
                  </section>
                )}

                {/* Cross-channel insights */}
                <section className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
                    <TrendingUp className="w-5 h-5" style={{ color: '#6D4AE0' }} /> Cross-Channel Insights
                  </h2>
                  {channels.length <= 1 ? (
                    <div className="text-center py-6 text-gray-500">
                      <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Connect more channels to unlock cross-channel recommendations.</p>
                    </div>
                  ) : crossChannel?.insights?.length ? (
                    <div className="space-y-3">
                      {crossChannel.summary && <p className="text-sm text-gray-600 mb-3">{crossChannel.summary}</p>}
                      {crossChannel.insights.map((ins, i) => (
                        <div key={i} className="flex items-start gap-3 p-4 rounded-2xl"
                          style={ins.priority === 'high'   ? { border: '1.5px solid #e3ddf8', background: '#f5f2fd' }
                               : ins.priority === 'medium' ? { border: '1.5px solid #bfdbfe', background: '#eff6ff' }
                               :                            { border: '1.5px solid #e5e7eb',  background: '#f9fafb' }}>
                          <span className="text-xs px-2 py-0.5 rounded-full font-semibold shrink-0 mt-0.5"
                            style={ins.priority === 'high'   ? { background: '#e3ddf8', color: '#6D4AE0' }
                                 : ins.priority === 'medium' ? { background: '#bfdbfe', color: '#1e40af' }
                                 :                            { background: '#e5e7eb',  color: '#374151' }}>
                            {ins.category}
                          </span>
                          <p className="text-sm text-gray-700">{ins.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading cross-channel analysis…
                    </div>
                  )}
                </section>

                {/* Performance feedback */}
                <section className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
                    <BarChart3 className="w-5 h-5" style={{ color: '#6D4AE0' }} /> Record Video Performance
                  </h2>
                  <p className="text-sm text-gray-400 mb-4">
                    Improve future AI predictions by reporting actual video results.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label htmlFor="fb-video-id" className="block text-xs font-medium text-gray-600 mb-1">YouTube Video ID *</label>
                      <input id="fb-video-id" type="text" value={fbVideoId} onChange={(e) => setFbVideoId(e.target.value)} placeholder="e.g. dQw4w9WgXcQ"
                        className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                        style={{ border: '1.5px solid #e3e0f0' }} />
                    </div>
                    <div>
                      <label htmlFor="fb-views" className="block text-xs font-medium text-gray-600 mb-1">Views *</label>
                      <input id="fb-views" type="number" value={fbViews} onChange={(e) => setFbViews(e.target.value)} placeholder="e.g. 12500" min="0"
                        className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                        style={{ border: '1.5px solid #e3e0f0' }} />
                    </div>
                    <div>
                      <label htmlFor="fb-likes" className="block text-xs font-medium text-gray-600 mb-1">Likes (optional)</label>
                      <input id="fb-likes" type="number" value={fbLikes} onChange={(e) => setFbLikes(e.target.value)} placeholder="e.g. 430" min="0"
                        className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                        style={{ border: '1.5px solid #e3e0f0' }} />
                    </div>
                    <div>
                      <label htmlFor="fb-ctr" className="block text-xs font-medium text-gray-600 mb-1">CTR % (optional)</label>
                      <input id="fb-ctr" type="number" value={fbCtr} onChange={(e) => setFbCtr(e.target.value)} placeholder="e.g. 4.2" min="0" max="100" step="0.1"
                        className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                        style={{ border: '1.5px solid #e3e0f0' }} />
                    </div>
                    <div>
                      <label htmlFor="fb-duration" className="block text-xs font-medium text-gray-600 mb-1">Avg Watch Duration secs (optional)</label>
                      <input id="fb-duration" type="number" value={fbDuration} onChange={(e) => setFbDuration(e.target.value)} placeholder="e.g. 180" min="0"
                        className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20"
                        style={{ border: '1.5px solid #e3e0f0' }} />
                    </div>
                  </div>
                  <button type="button" onClick={() => void submitFeedback()} disabled={fbLoading || !fbVideoId || !fbViews}
                    className="flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-white disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#6D4AE0 0%,#7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,.35)' }}>
                    {fbLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Submit Feedback
                  </button>
                </section>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* LOG TAB                                                     */}
            {/* ═══════════════════════════════════════════════════════════ */}
            {tab === 'log' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <ScrollText className="w-5 h-5" style={{ color: '#6D4AE0' }} />
                  <h2 className="text-lg font-semibold text-gray-900">Activity Log</h2>
                  <span className="text-sm text-gray-400">(last 30 autopilot actions)</span>
                </div>
                {auditLogLoading ? (
                  <div className="flex items-center gap-2 text-gray-500 text-sm py-8">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading activity…
                  </div>
                ) : auditLog.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 bg-white rounded-3xl" style={{ border: '1.5px solid #e3ddf8' }}>
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg,#f0edf9,#e3ddf8)' }}>
                      <ScrollText className="w-8 h-8" style={{ color: '#6D4AE0' }} />
                    </div>
                    <p className="text-sm text-gray-500">No activity logged yet.</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl divide-y divide-gray-100" style={{ border: '1.5px solid #e3ddf8' }}>
                    {auditLog.map((entry) => {
                      const dotColor =
                        entry.action.includes('approve')  ? 'bg-green-500' :
                        entry.action.includes('dismiss')  ||
                        entry.action.includes('failure')  ? 'bg-red-500'   :
                        entry.action.includes('generate') ||
                        entry.action.includes('calendar') ? 'bg-blue-500'  :
                        entry.action.includes('escalat')  ? 'bg-yellow-500': 'bg-gray-400';

                      const ACTION_LABELS: Record<string, string> = {
                        'autonomy.entry.approve':         'Entry approved',
                        'autonomy.entry.dismiss':         'Entry dismissed',
                        'autonomy.entry.bulk_approve':    'Bulk approve',
                        'autonomy.entry.bulk_dismiss':    'Bulk dismiss',
                        'autonomy.calendar.generate':     'Calendar generated',
                        'autonomy.feedback.record':       'Performance feedback recorded',
                        'autonomy.escalation.stale':      'Stale escalation',
                        'autonomy.job.failure_escalated': 'Job failure escalated',
                      };
                      const label = ACTION_LABELS[entry.action] ?? entry.action;

                      const metaDetail = (() => {
                        const m = entry.meta;
                        if (entry.action === 'autonomy.entry.approve' || entry.action === 'autonomy.entry.dismiss')
                          return typeof m['title'] === 'string' ? m['title'] : null;
                        if (entry.action === 'autonomy.calendar.generate') {
                          const count = typeof m['entryCount'] === 'number' ? m['entryCount'] : null;
                          const src   = typeof m['source']     === 'string'  ? m['source']     : null;
                          return count !== null ? `${count} entries, source: ${src ?? 'unknown'}` : null;
                        }
                        if (entry.action === 'autonomy.entry.bulk_approve' || entry.action === 'autonomy.entry.bulk_dismiss')
                          return typeof m['count'] === 'number' ? `${m['count']} entries` : null;
                        if (entry.action === 'autonomy.job.failure_escalated') {
                          const jt  = typeof m['jobType'] === 'string' ? m['jobType'] : '';
                          const err = typeof m['error']   === 'string' ? m['error'].slice(0, 80) : '';
                          return jt ? `${jt}: ${err}` : err || null;
                        }
                        return null;
                      })();

                      return (
                        <div key={entry.id} className="flex items-start gap-4 px-5 py-4">
                          <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{label}</p>
                            {metaDetail && <p className="text-xs text-gray-500 mt-0.5 truncate">{metaDetail}</p>}
                          </div>
                          <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                            {format(new Date(entry.createdAt), 'MMM d, HH:mm')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Floating bulk action bar */}
        {selected.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white rounded-full px-5 py-3 shadow-xl"
            style={{ border: '1.5px solid #e3ddf8' }}>
            <span className="text-sm font-medium text-gray-700">{selected.size} selected</span>
            <button type="button" onClick={() => bulkApprove.mutate(Array.from(selected))}
              disabled={bulkApprove.isPending || bulkDismiss.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 text-white rounded-full text-sm font-semibold hover:bg-green-700 disabled:opacity-50">
              {bulkApprove.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Approve all
            </button>
            <button type="button" onClick={() => bulkDismiss.mutate(Array.from(selected))}
              disabled={bulkApprove.isPending || bulkDismiss.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-gray-200 text-gray-700 rounded-full text-sm font-semibold hover:bg-gray-300 disabled:opacity-50">
              {bulkDismiss.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Dismiss all
            </button>
            <button type="button" onClick={() => setSelected(new Set())}
              className="p-1 text-gray-400 hover:text-gray-600" aria-label="Clear selection">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
