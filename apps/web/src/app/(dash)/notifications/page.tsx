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
    return <Clock className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#6D4AE0' }} />;
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
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Notifications</h1>
            <p className="text-sm text-gray-400 mt-0.5">Stay up to date with approvals, jobs, and system alerts</p>
          </div>
          <div className="flex items-center gap-3 pt-1">
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center rounded-full text-[11px] font-bold px-2.5 py-0.5" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>
                {unreadCount} unread
              </span>
            )}
            <button
              type="button"
              disabled={unreadCount === 0 || markAllMutation.isPending}
              onClick={() => markAllMutation.mutate()}
              className="text-sm font-bold hover:underline disabled:opacity-40 disabled:no-underline flex items-center gap-1"
              style={{ color: '#6D4AE0' }}
            >
              {markAllMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Mark all read
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="flex-shrink-0 py-1.5 px-4 text-sm font-semibold rounded-2xl transition-all whitespace-nowrap"
              style={activeTab === tab.id
                ? { background: '#f5f2fd', border: '2px solid #6D4AE0', color: '#6D4AE0' }
                : { background: '#faf9ff', border: '1.5px solid #e3ddf8', color: '#374151' }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Notification list */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-7 h-7 animate-spin" style={{ color: '#6D4AE0' }} />
          </div>
        ) : allItems.length === 0 ? (
          <div className="bg-white rounded-3xl flex flex-col items-center py-16 gap-4" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
              <Bell className="w-8 h-8" style={{ color: '#6D4AE0' }} />
            </div>
            <div className="text-center">
              <p className="text-base font-extrabold text-gray-900">You&apos;re all caught up</p>
              <p className="text-sm text-gray-400 mt-1">No notifications in this category</p>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
            {allItems.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleRowClick(n)}
                className="w-full text-left flex items-start gap-3 px-5 py-4 transition-colors hover:bg-[#faf9ff]"
                style={{
                  background: !n.readAt ? 'rgba(109,74,224,0.03)' : 'white',
                  borderBottom: '1px solid #f0edf9',
                }}
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
                  <span className="mt-1.5 shrink-0 w-2 h-2 rounded-full" style={{ background: '#6D4AE0' }} aria-hidden="true" />
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
              className="flex items-center gap-2 px-5 py-2 rounded-2xl text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              style={{ border: '1.5px solid #e3ddf8' }}
            >
              {isFetchingNextPage && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
