'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Loader2, CheckCircle2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { api, apiClient } from '@/lib/api';

interface CalendarEntry {
  id: string;
  title: string;
  titleVariants: string[];
  plannedAt: string;
  format: string;
  status: string;
  angle?: string;
  priority?: number;
}

interface Channel {
  id: string;
  title: string;
}

const FORMAT_COLORS: Record<string, string> = {
  tutorial: 'bg-blue-100 text-blue-700',
  story: 'bg-purple-100 text-purple-700',
  review: 'bg-amber-100 text-amber-700',
  interview: 'bg-green-100 text-green-700',
  documentary: 'bg-indigo-100 text-indigo-700',
  listicle: 'bg-pink-100 text-pink-700',
  shorts: 'bg-red-100 text-red-700',
  vlog: 'bg-orange-100 text-orange-700',
};

type FilterTab = 'all' | 'has_variants' | 'no_variants';

export default function AbTestingPage() {
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [swappedTitles, setSwappedTitles] = useState<Record<string, string>>({});
  const qc = useQueryClient();

  const { data: channels = [], isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  useEffect(() => {
    if (channels.length && !selectedChannelId) setSelectedChannelId(channels[0].id);
  }, [channels, selectedChannelId]);

  const channelId = selectedChannelId || (channels[0]?.id ?? '');

  const { data: entries = [], isLoading: entriesLoading, refetch } = useQuery<CalendarEntry[]>({
    queryKey: ['ab-calendar', channelId],
    enabled: !!channelId,
    queryFn: async () => {
      const res = await apiClient.get(`/autonomy/channels/${channelId}/calendar?status=APPROVED&status=PROPOSED`);
      const data = res.data as { items?: CalendarEntry[] } | CalendarEntry[];
      return Array.isArray(data) ? data : (data.items ?? []);
    },
  });

  const swapMutation = useMutation({
    mutationFn: ({ entryId, title }: { entryId: string; title: string }) =>
      apiClient.patch(`/autonomy/calendar/${entryId}/title`, { title }),
    onSuccess: (_data, vars) => {
      setSwappedTitles((prev) => ({ ...prev, [vars.entryId]: vars.title }));
      void qc.invalidateQueries({ queryKey: ['ab-calendar', channelId] });
    },
  });

  const filtered = entries.filter((e) => {
    if (activeTab === 'has_variants') return e.titleVariants?.length > 0;
    if (activeTab === 'no_variants') return !e.titleVariants?.length;
    return true;
  });

  const withVariants = entries.filter((e) => e.titleVariants?.length > 0).length;
  const total = entries.length;

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}>
              <FlaskConical className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">A/B Title Testing</h1>
              <p className="text-sm text-gray-400 mt-0.5">Compare AI-generated title variants for your content calendar</p>
            </div>
          </div>
          <button
            onClick={() => void refetch()}
            disabled={entriesLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-semibold text-gray-600 disabled:opacity-50"
            style={{ border: '1.5px solid #e3ddf8' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${entriesLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Channel selector */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 shrink-0">Channel:</label>
          {channelsLoading ? (
            <div className="w-40 h-9 bg-gray-100 animate-pulse rounded-2xl" />
          ) : (
            <select
              value={channelId}
              onChange={(e) => setSelectedChannelId(e.target.value)}
              className="bg-white rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 min-w-[200px]"
              style={{ border: '1.5px solid #e3e0f0' }}
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          )}
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl p-4" style={{ border: '1.5px solid #e3ddf8' }}>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">Total Entries</p>
            <p className="text-2xl font-bold text-gray-900">{total}</p>
          </div>
          <div className="bg-white rounded-2xl p-4" style={{ border: '1.5px solid #e3ddf8' }}>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">Have Variants</p>
            <p className="text-2xl font-bold" style={{ color: '#6D4AE0' }}>{withVariants}</p>
          </div>
          <div className="bg-white rounded-2xl p-4" style={{ border: '1.5px solid #e3ddf8' }}>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">Coverage</p>
            <p className="text-2xl font-bold text-gray-900">{total ? Math.round(withVariants / total * 100) : 0}%</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 w-fit">
          {([['all', 'All'], ['has_variants', 'Has Variants'], ['no_variants', 'No Variants']] as [FilterTab, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-1.5 text-sm font-medium rounded-xl transition-colors ${activeTab === key ? 'bg-white shadow text-[#6D4AE0]' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {entriesLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            Loading calendar entries…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center bg-white rounded-3xl" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
              <FlaskConical className="w-8 h-8" style={{ color: '#6D4AE0' }} />
            </div>
            <p className="text-sm text-gray-500">No entries found. Generate a content calendar in the Autonomy section first.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const activeTitle = swappedTitles[entry.id] ?? entry.title;
              const variants = entry.titleVariants ?? [];

              return (
                <div key={entry.id} className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${FORMAT_COLORS[entry.format?.toLowerCase()] ?? 'bg-gray-100 text-gray-600'}`}>
                          {entry.format ?? 'video'}
                        </span>
                        {variants.length > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>
                            {variants.length} variant{variants.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900 mt-1 truncate">{activeTitle}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(entry.plannedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100 p-4 space-y-3">
                      {entry.angle && (
                        <p className="text-sm text-gray-600 italic">Hook: {entry.angle}</p>
                      )}

                      {/* Control title */}
                      <div>
                        <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-2">Titles</p>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="flex-1 text-sm px-3 py-2 rounded-2xl font-medium text-gray-800" style={{ background: '#f5f2fd', border: '1.5px solid #e3ddf8' }}>
                              {activeTitle}
                            </span>
                            <span className="px-2 py-1 text-[11px] font-semibold rounded-xl" style={{ color: '#6D4AE0', background: '#f5f2fd' }}>Active</span>
                          </div>

                          {variants.filter((v) => v !== activeTitle).map((variant, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="flex-1 text-sm px-3 py-2 rounded-2xl bg-gray-50 text-gray-700" style={{ border: '1.5px solid #e3e0f0' }}>
                                {variant}
                              </span>
                              <button
                                onClick={() => swapMutation.mutate({ entryId: entry.id, title: variant })}
                                disabled={swapMutation.isPending}
                                className="px-3 py-1 text-xs font-semibold rounded-2xl disabled:opacity-50 shrink-0 transition-colors hover:bg-[#f5f2fd]"
                                style={{ border: '1.5px solid #e3ddf8', color: '#6D4AE0' }}
                              >
                                {swapMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Use This'}
                              </button>
                            </div>
                          ))}

                          {variants.length === 0 && (
                            <p className="text-xs text-gray-400 italic">No variants generated. Re-generate this entry in the Autonomy calendar.</p>
                          )}
                        </div>
                      </div>

                      {swappedTitles[entry.id] && (
                        <div className="flex items-center gap-2 text-green-600 text-xs font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Title updated successfully
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
