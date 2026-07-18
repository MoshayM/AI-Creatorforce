'use client';
import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell, CheckCircle, XCircle, Clock, AlertTriangle, Loader2,
} from 'lucide-react';
import { api, type AppNotification } from '@/lib/api';

const PAGE_SIZE = 30;

type Tab = 'all' | 'approvals' | 'jobs' | 'publishing' | 'system';

const TABS: { id: Tab; label: string; types?: string[] }[] = [
  { id: 'all', label: 'All' },
  { id: 'approvals', label: 'Approvals', types: ['APPROVAL_REQUEST', 'APPROVAL_DONE'] },
  { id: 'jobs', label: 'Jobs', types: ['JOB_COMPLETE', 'JOB_FAILED'] },
  { id: 'publishing', label: 'Publishing', types: ['PUBLISH_SUCCESS', 'PUBLISH_FAILED'] },
  { id: 'system', label: 'System', types: ['SYSTEM', 'TRIAL_EXPIRING', 'CREDITS_LOW'] },
];

function notifIcon(type: string) {
  if (['APPROVAL_DONE', 'JOB_COMPLETE', 'PUBLISH_SUCCESS'].includes(type))
    return <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />;
  if (['JOB_FAILED', 'PUBLISH_FAILED'].includes(type))
    return <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />;
  if (['TRIAL_EXPIRING', 'CREDITS_LOW'].includes(type))
    return <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />;
  if (type === 'APPROVAL_REQUEST')
    return <Clock className="w-5 h-5 text-violet-500 shrink-0 mt-0.5" />;
  return <Bell className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('all');

  const activeTabDef = useMemo(() => TABS.find((t) => t.id === activeTab)!, [activeTab]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['notifications-page', activeTab],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.notifications
        .list({
          take: PAGE_SIZE,
          cursor: pageParam,
        })
        .then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
  });

  const allItems = useMemo(() => {
    const items = data?.pages.flatMap((p) => p.items) ?? [];
    if (!activeTabDef.types) return items;
    return items.filter((n) => activeTabDef.types!.includes(n.type));
  }, [data, activeTabDef]);
  const unreadCount = data?.pages[0]?.unreadCount ?? 0;

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.notifications.markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications-page'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications-page'] });
      void qc.invalidateQueries({ queryKey: ['notifications-unread'] });
    },
  });

  function handleRowClick(n: AppNotification) {
    if (!n.readAt) markReadMutation.mutate(n.id);
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold">
              {unreadCount} unread
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={unreadCount === 0 || markAllMutation.isPending}
          onClick={() => markAllMutation.mutate()}
          className="text-sm font-medium text-[#7b5ec7] hover:underline disabled:opacity-40 disabled:no-underline flex items-center gap-1"
        >
          {markAllMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Mark all read
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-max py-1.5 px-3 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white shadow text-[#7b5ec7]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-7 h-7 animate-spin text-[#7b5ec7]" />
        </div>
      ) : allItems.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 text-gray-400">
          <Bell className="w-12 h-12 opacity-30" />
          <p className="text-sm">You&apos;re all caught up</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 overflow-hidden">
          {allItems.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => handleRowClick(n)}
              className={`w-full text-left flex items-start gap-3 px-5 py-4 transition-colors hover:bg-gray-50 ${
                !n.readAt ? 'bg-violet-50/40' : 'bg-white'
              }`}
            >
              {notifIcon(n.type)}
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug ${!n.readAt ? 'font-semibold text-gray-900' : 'font-normal text-gray-700'}`}>
                  {n.title}
                </p>
                {n.body && (
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug line-clamp-2">{n.body}</p>
                )}
                <p className="text-[11px] text-gray-400 mt-1">{relativeTime(n.createdAt)}</p>
              </div>
              {!n.readAt && (
                <span className="mt-1.5 shrink-0 w-2 h-2 rounded-full bg-[#7b5ec7]" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center mt-5">
          <button
            type="button"
            disabled={isFetchingNextPage}
            onClick={() => { void fetchNextPage(); }}
            className="flex items-center gap-2 px-5 py-2 rounded-full border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {isFetchingNextPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
