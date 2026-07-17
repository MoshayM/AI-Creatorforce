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
  const styles: Record<BannerType, string> = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  const icons: Record<BannerType, React.ReactNode> = {
    success: <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />,
    error: <XCircle className="w-4 h-4 text-red-600 shrink-0" />,
    info: <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />,
  };
  return (
    <div className={`flex items-start gap-2 border rounded-xl px-4 py-3 text-sm ${styles[type]}`}>
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
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50 ${
        checked ? 'bg-brand-600' : 'bg-gray-200'
      }`}
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
    key: keyof Pick<typeof form, 'autoImport' | 'autoAnalyze' | 'autoPublish' | 'chapterSyncEnabled' | 'autoPlan'>;
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
  ];

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Workflow className="w-6 h-6 text-brand-600" />
            Automation
          </h1>
          <p className="text-gray-500 mt-1">Configure automatic import, analysis, and publishing per channel.</p>
        </div>
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
      </div>

      {/* Banner */}
      {banner && (
        <Banner type={banner.type} message={banner.message} onDismiss={() => setBanner(null)} />
      )}

      {/* No channel selected */}
      {!channelId && (
        <div className="text-center py-20 text-gray-500">
          <Workflow className="w-10 h-10 mx-auto mb-3 opacity-30" />
          Pick a channel above to configure automation.
        </div>
      )}

      {/* Loading */}
      {channelId && loadingAutomation && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-brand-600" />
        </div>
      )}

      {/* Settings card */}
      {channelId && !loadingAutomation && (
        <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 shadow-sm">
          {/* Master toggle */}
          <div className="flex items-center justify-between gap-4 px-6 py-5">
            <div>
              <p className="font-semibold text-gray-900">Enable automation for this channel</p>
              <p className="text-sm text-gray-500 mt-0.5">When off, all automated tasks are paused for this channel.</p>
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
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
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
            <p className="text-sm font-semibold text-gray-700">Publishing &amp; import limits</p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Publish interval */}
              <div>
                <label htmlFor="publishInterval" className="block text-xs font-medium text-gray-600 mb-1">
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
                />
                <p className="text-[11px] text-gray-400 mt-1">15 – 1440 min</p>
              </div>

              {/* Max publishes/day */}
              <div>
                <label htmlFor="maxPublishes" className="block text-xs font-medium text-gray-600 mb-1">
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
                />
                <p className="text-[11px] text-gray-400 mt-1">1 – 10</p>
              </div>

              {/* Max imports/day */}
              <div>
                <label htmlFor="maxImports" className="block text-xs font-medium text-gray-600 mb-1">
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
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
                />
                <p className="text-[11px] text-gray-400 mt-1">1 – 10</p>
              </div>
            </div>
          </div>

          {/* AI suggestion source note */}
          {aiSuggestionSource && (
            <div className="px-6 py-3 bg-purple-50 border-t border-purple-100">
              <p className="text-xs text-purple-700 flex items-center gap-1.5">
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
              className="flex items-center gap-2 px-4 py-2 border border-brand-300 text-brand-700 text-sm rounded-lg hover:bg-brand-50 disabled:opacity-50 transition-colors"
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
              className="flex items-center gap-2 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
  );
}
