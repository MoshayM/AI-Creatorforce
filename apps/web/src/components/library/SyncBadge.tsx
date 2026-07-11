'use client';
import { useRef, useEffect } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { api, type LibrarySyncPhase } from '@/lib/api';

const ACTIVE_PHASES: LibrarySyncPhase[] = ['VIDEOS', 'PLAYLISTS', 'PLAYLIST_ITEMS'];

interface SyncBadgeProps {
  channelId: string;
}

export function SyncBadge({ channelId }: SyncBadgeProps) {
  const qc = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ['library-sync-status', channelId],
    queryFn: () => api.library.syncStatus(channelId).then((r) => r.data),
    refetchInterval: (q) => {
      const phase = q.state.data?.phase;
      return phase && ACTIVE_PHASES.includes(phase) ? 4000 : false;
    },
  });

  // Track previous phase to detect DONE transition
  const prevPhaseRef = useRef<LibrarySyncPhase | undefined>(undefined);
  useEffect(() => {
    if (!status) return;
    const prev = prevPhaseRef.current;
    const curr = status.phase;
    if (prev && ACTIVE_PHASES.includes(prev) && curr === 'DONE') {
      void qc.invalidateQueries({ queryKey: ['library-videos', channelId] });
    }
    prevPhaseRef.current = curr;
  }, [status, channelId, qc]);

  const syncMutation = useMutation({
    mutationFn: () => api.library.syncStart(channelId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['library-sync-status', channelId] }),
  });

  if (!status) return null;

  const isActive = ACTIVE_PHASES.includes(status.phase);
  const isError = status.phase === 'ERROR';

  return (
    <div className="flex items-center gap-2">
      {isActive && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-sm font-medium">
          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Syncing — {status.syncedVideos} videos
        </span>
      )}
      {isError && (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {status.error ?? 'Sync error'}
        </span>
      )}
      {(status.phase === 'IDLE' || status.phase === 'DONE' || isError) && (
        <button
          type="button"
          onClick={() => { void syncMutation.mutate(); }}
          disabled={syncMutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {syncMutation.isPending ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {isError ? 'Resume sync' : 'Sync library'}
        </button>
      )}
    </div>
  );
}
