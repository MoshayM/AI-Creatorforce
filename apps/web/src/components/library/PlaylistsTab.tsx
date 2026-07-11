'use client';
import { useState, useOptimistic, useTransition } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { api, type LibraryPlaylist, type LibraryPlaylistItem } from '@/lib/api';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

// ── Playlist items sub-panel ────────────────────────────────────────────────

function PlaylistItemsPanel({ channelId, playlist }: { channelId: string; playlist: LibraryPlaylist }) {
  const [isPending, startTransition] = useTransition();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['library-playlist-items', channelId, playlist.id],
    queryFn: ({ pageParam }) =>
      api.library.listPlaylistItems(channelId, playlist.id, pageParam as string | undefined).then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const allItems: LibraryPlaylistItem[] = data?.pages.flatMap((p) => p.data) ?? [];

  // Optimistic ordered items for reorder UX
  const [optimisticItems, applyOptimistic] = useOptimistic(
    allItems,
    (_state: LibraryPlaylistItem[], next: LibraryPlaylistItem[]) => next,
  );

  const reorderMutation = useMutation({
    mutationFn: (itemIds: string[]) => api.library.reorderPlaylist(channelId, playlist.id, itemIds),
  });

  function moveItem(fromIndex: number, direction: -1 | 1) {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= optimisticItems.length) return;
    const next = [...optimisticItems];
    // swap
    const tmp = next[fromIndex];
    next[fromIndex] = next[toIndex]!;
    next[toIndex] = tmp!;

    startTransition(() => {
      applyOptimistic(next);
    });

    reorderMutation.mutate(next.map((it) => it.id), {
      onError: () => {
        // rollback — the optimistic state will revert to allItems on next render
      },
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 justify-center text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading items…
      </div>
    );
  }

  if (!optimisticItems.length) {
    return <p className="py-4 text-sm text-gray-400 text-center">No items in this playlist.</p>;
  }

  return (
    <div className="space-y-1">
      {(isPending ? optimisticItems : allItems).map((item, idx) => (
        <div key={item.id} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
          <span className="text-[11px] text-gray-400 w-5 text-right shrink-0">{idx + 1}</span>
          {item.video.thumbnailUrl && (
            <img
              src={item.video.thumbnailUrl}
              alt=""
              className="w-14 h-8 object-cover rounded shrink-0"
            />
          )}
          <p className="flex-1 text-sm text-gray-800 truncate min-w-0">{item.video.title}</p>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => { moveItem(idx, -1); }}
              disabled={idx === 0 || reorderMutation.isPending}
              aria-label="Move up"
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={() => { moveItem(idx, 1); }}
              disabled={idx === (isPending ? optimisticItems : allItems).length - 1 || reorderMutation.isPending}
              aria-label="Move down"
              className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>
      ))}
      {hasNextPage && (
        <button
          onClick={() => { void fetchNextPage(); }}
          disabled={isFetchingNextPage}
          className="w-full py-2 text-sm text-brand-600 hover:underline disabled:opacity-50"
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more items'}
        </button>
      )}
    </div>
  );
}

// ── Playlist row ────────────────────────────────────────────────────────────

function PlaylistRow({ channelId, playlist }: { channelId: string; playlist: LibraryPlaylist }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); }}
        className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        {playlist.thumbnailUrl && (
          <img src={playlist.thumbnailUrl} alt="" className="w-14 h-9 object-cover rounded-md shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{playlist.title}</p>
          <p className="text-[11px] text-gray-400">{playlist.itemCount} items</p>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-50">
          <PlaylistItemsPanel channelId={channelId} playlist={playlist} />
        </div>
      )}
    </div>
  );
}

// ── Playlists tab root ──────────────────────────────────────────────────────

interface PlaylistsTabProps {
  channelId: string;
}

export function PlaylistsTab({ channelId }: PlaylistsTabProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['library-playlists', channelId],
    queryFn: ({ pageParam }) =>
      api.library.listPlaylists(channelId, pageParam as string | undefined).then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!channelId,
  });

  const playlists: LibraryPlaylist[] = data?.pages.flatMap((p) => p.data) ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-20 justify-center text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading playlists…
      </div>
    );
  }

  if (!playlists.length) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-sm">No playlists synced yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {playlists.map((pl) => (
        <PlaylistRow key={pl.id} channelId={channelId} playlist={pl} />
      ))}
      {hasNextPage && (
        <button
          type="button"
          onClick={() => { void fetchNextPage(); }}
          disabled={isFetchingNextPage}
          className="w-full py-2 text-sm text-brand-600 hover:underline disabled:opacity-50"
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more playlists'}
        </button>
      )}
    </div>
  );
}
