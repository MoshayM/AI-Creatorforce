'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Workflow, Loader2, Save, Sparkles, CheckCircle, XCircle, AlertCircle, X,
} from 'lucide-react';
import { api, type ChannelAutomation } from '@/lib/api';

interface Channel {
  id: string;
  title: string;
}

const CHANNEL_LS_KEY = 'cf.automation.channelId';

const PUBLISH_INTERVAL_MIN = 15;
const PUBLISH_INTERVAL_MAX = 1440;
const PUBLISHES_PER_DAY_MIN = 1;
const PUBLISHES_PER_DAY_MAX = 10;
const IMPORTS_PER_DAY_MIN = 1;
const IMPORTS_PER_DAY_MAX = 10;

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

type BannerType = 'success' | 'error' | 'info';

function Banner({
  type,
  message,
  onDismiss,
}: {
  type: BannerType;
  message: string;
  onDismiss: () => void;
}) {
  const styles: Record<BannerType, React.CSSProperties> = {
    success: { background: '#ecfdf5', color: '#065f46', border: '1.5px solid #a7f3d0' },
    error: { background: '#fef2f2', color: '#dc2626', border: '1.5px solid #fca5a5' },
    info: { background: '#f5f2fd', color: '#6D4AE0', border: '1.5px solid #c4b5fd' },
  };
  const icons: Record<BannerType, React.ReactNode> = {
    success: <CheckCircle className="w-4 h-4 shrink-0" style={{ color: '#065f46' }} />,
    error: <XCircle className="w-4 h-4 shrink-0" style={{ color: '#dc2626' }} />,
    info: <AlertCircle className="w-4 h-4 shrink-0" style={{ color: '#6D4AE0' }} />,
  };
  return (
    <div className="flex items-start gap-2 rounded-2xl px-4 py-3 text-sm" style={styles[type]}>
      {icons[type]}
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6D4AE0] disabled:opacity-50"
      style={{ background: checked ? '#6D4AE0' : '#e5e7eb' }}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

const DEFAULT_FORM: Omit<ChannelAutomation, 'aiSuggestion' | 'lastTickAt'> = {
  enabled: false,
  autoImport: false,
  autoAnalyze: false,
  autoPublish: false,
  chapterSyncEnabled: false,
  autoPlan: false,
  autoResearch: false,
  publishIntervalMinutes: 60,
  maxPublishesPerDay: 3,
  maxImportsPerDay: 5,
};

export default function AutomationPage() {
  const qc = useQueryClient();
  const [channelId, setChannelId] = useState('');
  const [form, setForm] = useState<Omit<ChannelAutomation, 'aiSuggestion' | 'lastTickAt'>>(DEFAULT_FORM);
  const [aiSuggestionSource, setAiSuggestionSource] = useState<'ai' | 'heuristic' | null>(null);
  const [banner, setBanner] = useState<{ type: BannerType; message: string } | null>(null);

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  // Restore last channel, else auto-select the first one
  useEffect(() => {
    if (channelId || channels.length === 0) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem(CHANNEL_LS_KEY) : null;
    const restored = stored && channels.some((c) => c.id === stored) ? stored : channels[0]?.id ?? '';
    setChannelId(restored);
  }, [channelId, channels]);

  const selectChannel = (id: string) => {
    setChannelId(id);
    setAiSuggestionSource(null);
    if (id) localStorage.setItem(CHANNEL_LS_KEY, id);
  };

  const { data: automationData, isLoading: loadingAutomation } = useQuery<ChannelAutomation>({
    queryKey: ['automation', channelId],
    queryFn: () => api.automation.get(channelId).then((r) => r.data),
    enabled: !!channelId,
  });

  // Sync loaded data into form
  useEffect(() => {
    if (!automationData) return;
    setForm({
      enabled: automationData.enabled,
      autoImport: automationData.autoImport,
      autoAnalyze: automationData.autoAnalyze,
      autoPublish: automationData.autoPublish,
      chapterSyncEnabled: automationData.chapterSyncEnabled,
      autoPlan: automationData.autoPlan,
      autoResearch: automationData.autoResearch,
      publishIntervalMinutes: automationData.publishIntervalMinutes,
      maxPublishesPerDay: automationData.maxPublishesPerDay,
      maxImportsPerDay: automationData.maxImportsPerDay,
    });
    setAiSuggestionSource(null);
  }, [automationData]);

  const updateMutation = useMutation({
    mutationFn: () => api.automation.update(channelId, form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['automation', channelId] });
      setBanner({ type: 'success', message: 'Automation settings saved.' });
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Failed to save settings. Please try again.' });
    },
  });

  const suggestMutation = useMutation({
    mutationFn: () => api.automation.suggest(channelId),
    onSuccess: (res) => {
      const { suggestion, source } = res.data;
      setForm({
        enabled: suggestion.enabled,
        autoImport: suggestion.autoImport,
        autoAnalyze: suggestion.autoAnalyze,
        autoPublish: suggestion.autoPublish,
        chapterSyncEnabled: suggestion.chapterSyncEnabled,
        autoPlan: suggestion.autoPlan,
        autoResearch: suggestion.autoResearch,
        publishIntervalMinutes: clamp(suggestion.publishIntervalMinutes, PUBLISH_INTERVAL_MIN, PUBLISH_INTERVAL_MAX),
        maxPublishesPerDay: clamp(suggestion.maxPublishesPerDay, PUBLISHES_PER_DAY_MIN, PUBLISHES_PER_DAY_MAX),
        maxImportsPerDay: clamp(suggestion.maxImportsPerDay, IMPORTS_PER_DAY_MIN, IMPORTS_PER_DAY_MAX),
      });
      setAiSuggestionSource(source);
      setBanner({ type: 'info', message: 'Review the suggested settings below, then save when ready.' });
    },
    onError: () => {
      setBanner({ type: 'error', message: 'Could not generate a suggestion. Please try again.' });
    },
  });

  function setField<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setAiSuggestionSource(null);
  }

  const featureToggles: Array<{
    key: keyof Pick<typeof form, 'autoImport' | 'autoAnalyze' | 'autoPublish' | 'chapterSyncEnabled' | 'autoPlan' | 'autoResearch'>;
    label: string;
    description: string;
  }> = [
    {
      key: 'autoImport',
      label: 'Auto-import new uploads',
      description: 'Imports recent long-form uploads into Shorts Studio automatically.',
    },
    {
      key: 'autoAnalyze',
      label: 'Auto-analyze imported videos',
      description: 'Runs transcript, scene, and highlight analysis as soon as a video is imported.',
    },
    {
      key: 'autoPublish',
      label: 'Auto-publish approved Shorts',
      description: 'Publishes clips YOU approved, paced by the limits below — nothing is published without compliance + approval.',
    },
    {
      key: 'chapterSyncEnabled',
      label: 'Keep chapters synced',
      description: 'Automatically syncs YouTube chapter markers from source videos.',
    },
    {
      key: 'autoPlan',
      label: 'Auto-plan content calendar',
      description: 'Once a day, refreshes the channel profile and tops up the AI content calendar when future slots run low. Proposals only — you still approve every slot in Autonomy.',
    },
    {
      key: 'autoResearch',
      label: 'Auto-research on approve',
      description: 'When you approve a calendar slot, automatically starts a RESEARCH job for the draft video so the pipeline is ready when you open it.',
    },
  ];

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight flex items-center gap-2">
              <Workflow className="w-6 h-6" style={{ color: '#6D4AE0' }} />
              Automation
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">Configure automatic import, analysis, and publishing per channel.</p>
          </div>
          <select
            value={channelId}
            onChange={(e) => selectChannel(e.target.value)}
            className="bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all"
            style={{ border: '1.5px solid #e3e0f0' }}
            aria-label="Channel"
          >
            <option value="">Select a channel…</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>

        {/* Banner */}
        {banner && (
          <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
        )}

        {/* No channel selected */}
        {!channelId && (
          <div className="bg-white rounded-3xl p-12 flex flex-col items-center text-center" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
              <Workflow className="w-7 h-7" style={{ color: '#6D4AE0' }} />
            </div>
            <p className="text-sm font-semibold text-gray-700">Pick a channel above to configure automation</p>
          </div>
        )}

        {/* Loading */}
        {channelId && loadingAutomation && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#6D4AE0' }} />
          </div>
        )}

        {/* Settings card */}
        {channelId && !loadingAutomation && (
          <div className="bg-white rounded-2xl divide-y" style={{ border: '1.5px solid #e3ddf8', divideColor: '#f3f0fd' } as React.CSSProperties}>
            {/* Master toggle */}
            <div className="flex items-center justify-between gap-4 px-6 py-5">
              <div>
                <p className="font-semibold text-gray-900">Enable automation for this channel</p>
                <p className="text-sm text-gray-400 mt-0.5">When off, all automated tasks are paused for this channel.</p>
              </div>
              <Toggle
                checked={form.enabled}
                onChange={(v) => setField('enabled', v)}
              />
            </div>

            {/* Feature toggles */}
            {featureToggles.map(({ key, label, description }) => (
              <div key={key} className="flex items-center justify-between gap-4 px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-gray-800">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{description}</p>
                </div>
                <Toggle
                  checked={form[key]}
                  onChange={(v) => setField(key, v)}
                  disabled={!form.enabled}
                />
              </div>
            ))}

            {/* Numeric limits */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400">Publishing &amp; import limits</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Publish interval */}
                <div>
                  <label htmlFor="publishInterval" className="block text-xs font-medium text-gray-500 mb-1">
                    Interval between publishes (minutes)
                  </label>
                  <input
                    id="publishInterval"
                    type="number"
                    min={PUBLISH_INTERVAL_MIN}
                    max={PUBLISH_INTERVAL_MAX}
                    value={form.publishIntervalMinutes}
                    disabled={!form.enabled}
                    onChange={(e) =>
                      setField(
                        'publishIntervalMinutes',
                        clamp(Number(e.target.value), PUBLISH_INTERVAL_MIN, PUBLISH_INTERVAL_MAX),
                      )
                    }
                    className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all disabled:opacity-50"
                    style={{ border: '1.5px solid #e3e0f0' }}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">15 – 1440 min</p>
                </div>

                {/* Max publishes/day */}
                <div>
                  <label htmlFor="maxPublishes" className="block text-xs font-medium text-gray-500 mb-1">
                    Max publishes / day
                  </label>
                  <input
                    id="maxPublishes"
                    type="number"
                    min={PUBLISHES_PER_DAY_MIN}
                    max={PUBLISHES_PER_DAY_MAX}
                    value={form.maxPublishesPerDay}
                    disabled={!form.enabled}
                    onChange={(e) =>
                      setField(
                        'maxPublishesPerDay',
                        clamp(Number(e.target.value), PUBLISHES_PER_DAY_MIN, PUBLISHES_PER_DAY_MAX),
                      )
                    }
                    className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all disabled:opacity-50"
                    style={{ border: '1.5px solid #e3e0f0' }}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">1 – 10</p>
                </div>

                {/* Max imports/day */}
                <div>
                  <label htmlFor="maxImports" className="block text-xs font-medium text-gray-500 mb-1">
                    Max imports / day
                  </label>
                  <input
                    id="maxImports"
                    type="number"
                    min={IMPORTS_PER_DAY_MIN}
                    max={IMPORTS_PER_DAY_MAX}
                    value={form.maxImportsPerDay}
                    disabled={!form.enabled}
                    onChange={(e) =>
                      setField(
                        'maxImportsPerDay',
                        clamp(Number(e.target.value), IMPORTS_PER_DAY_MIN, IMPORTS_PER_DAY_MAX),
                      )
                    }
                    className="w-full bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all disabled:opacity-50"
                    style={{ border: '1.5px solid #e3e0f0' }}
                  />
                  <p className="text-[11px] text-gray-400 mt-1">1 – 10</p>
                </div>
              </div>
            </div>

            {/* AI suggestion source note */}
            {aiSuggestionSource && (
              <div className="px-6 py-3" style={{ background: '#f5f2fd', borderTop: '1.5px solid #e3ddf8' }}>
                <p className="text-xs flex items-center gap-1.5" style={{ color: '#6D4AE0' }}>
                  <Sparkles className="w-3.5 h-3.5" />
                  {aiSuggestionSource === 'ai' ? 'AI suggestion — review and save when ready.' : 'Based on your upload cadence — review and save when ready.'}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between gap-3 px-6 py-4">
              <button
                type="button"
                onClick={() => suggestMutation.mutate()}
                disabled={!channelId || suggestMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 rounded-2xl font-semibold text-sm disabled:opacity-50 transition-all hover:bg-gray-50"
                style={{ border: '1.5px solid #e3ddf8', color: '#6D4AE0' }}
              >
                {suggestMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Sparkles className="w-4 h-4" />}
                Suggest with AI
              </button>

              <button
                type="button"
                onClick={() => updateMutation.mutate()}
                disabled={!channelId || updateMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 rounded-2xl font-bold text-white text-sm hover:opacity-90 active:scale-[0.98] disabled:opacity-50 transition-all"
                style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)', boxShadow: '0 4px 20px rgba(109,74,224,0.35)' }}
              >
                {updateMutation.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : <><Save className="w-4 h-4" /> Save settings</>}
              </button>
            </div>
          </div>
        )}

        {/* Compliance footnote */}
        {channelId && !loadingAutomation && (
          <p className="text-xs text-gray-400 text-center">
            Auto-publish never bypasses review: only approved, compliance-passed Shorts are published.
          </p>
        )}
      </div>
    </div>
  );
}
