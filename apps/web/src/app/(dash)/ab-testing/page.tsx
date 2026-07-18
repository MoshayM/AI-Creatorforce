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
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[#9d6ff0] to-[#7c4fd8] rounded-xl flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">A/B Title Testing</h1>
            <p className="text-sm text-gray-500">Compare AI-generated title variants for your content calendar</p>
          </div>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={entriesLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${entriesLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Channel selector */}
      <div className="flex items-center gap-3 mb-5">
        <label className="text-sm font-medium text-gray-700 shrink-0">Channel:</label>
        {channelsLoading ? (
          <div className="w-40 h-9 bg-gray-100 animate-pulse rounded-lg" />
        ) : (
          <select
            value={channelId}
            onChange={(e) => setSelectedChannelId(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#9d6ff0]/30 min-w-[200px]"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        )}
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-[#f0eafc] rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1">Total Entries</p>
          <p className="text-2xl font-bold text-gray-900">{total}</p>
        </div>
        <div className="bg-[#e9edfc] rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1">Have Variants</p>
          <p className="text-2xl font-bold text-[#7c4fd8]">{withVariants}</p>
        </div>
        <div className="bg-[#fdf5dd] rounded-2xl p-4">
          <p className="text-xs text-gray-500 mb-1">Coverage</p>
          <p className="text-2xl font-bold text-gray-900">{total ? Math.round(withVariants / total * 100) : 0}%</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1 w-fit">
        {([['all', 'All'], ['has_variants', 'Has Variants'], ['no_variants', 'No Variants']] as [FilterTab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${activeTab === key ? 'bg-white shadow text-[#7c4fd8]' : 'text-gray-500 hover:text-gray-700'}`}
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
        <div className="py-16 text-center">
          <FlaskConical className="w-10 h-10 mx-auto mb-3 text-gray-200" />
          <p className="text-sm text-gray-500">No entries found. Generate a content calendar in the Autonomy section first.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const activeTitle = swappedTitles[entry.id] ?? entry.title;
            const variants = entry.titleVariants ?? [];

            return (
              <div key={entry.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
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
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#f0eafc] text-[#7c4fd8]">
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
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Titles</p>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-sm px-3 py-2 rounded-xl bg-[#f0eafc] border border-[#c9b3f5] text-gray-800 font-medium">
                            {activeTitle}
                          </span>
                          <span className="px-2 py-1 text-[11px] font-semibold text-[#7c4fd8] bg-[#f0eafc] rounded-lg">Active</span>
                        </div>

                        {variants.filter((v) => v !== activeTitle).map((variant, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="flex-1 text-sm px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-gray-700">
                              {variant}
                            </span>
                            <button
                              onClick={() => swapMutation.mutate({ entryId: entry.id, title: variant })}
                              disabled={swapMutation.isPending}
                              className="px-3 py-1 text-xs font-medium rounded-lg border border-[#9d6ff0] text-[#7c4fd8] hover:bg-[#f0eafc] transition-colors disabled:opacity-50 shrink-0"
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
  );
}
