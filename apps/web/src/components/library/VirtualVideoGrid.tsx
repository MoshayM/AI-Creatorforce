'use client';
import { useRef, useEffect, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LibraryVideo } from '@/lib/api';
import { VideoCard } from './VideoCard';

const ROW_HEIGHT_ESTIMATE = 220;
const OVERSCAN = 5;
// Simple breakpoint mapping for columns: <640 → 2, <1024 → 3, else → 4
function colsFromWidth(w: number): number {
  if (w < 640) return 2;
  if (w < 1024) return 3;
  return 4;
}

interface VirtualVideoGridProps {
  videos: LibraryVideo[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

export function VirtualVideoGrid({
  videos,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: VirtualVideoGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  // State (not a ref): crossing a breakpoint must re-render the grid, and the
  // guarded setter means non-breakpoint resize ticks cause no re-renders.
  const [cols, setCols] = useState(4);

  useEffect(() => {
    if (!parentRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCols((prev) => {
        const next = colsFromWidth(w);
        return next === prev ? prev : next;
      });
    });
    ro.observe(parentRef.current);
    setCols(colsFromWidth(parentRef.current.offsetWidth));
    return () => ro.disconnect();
  }, []);
  const rowCount = Math.ceil(videos.length / cols);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: OVERSCAN,
  });

  // Infinite scroll trigger: when last virtual row is within 3 rows of end
  const handleScroll = useCallback(() => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    if (!virtualItems.length) return;
    const lastVirtual = virtualItems[virtualItems.length - 1];
    if (!lastVirtual) return;
    if (lastVirtual.index >= rowCount - 3 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [rowVirtualizer, rowCount, hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalHeight = rowVirtualizer.getTotalSize();

  return (
    <div ref={parentRef} className="overflow-y-auto flex-1" style={{ height: '100%' }}>
      <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
        {virtualItems.map((vRow) => {
          const startIndex = vRow.index * cols;
          const rowVideos = videos.slice(startIndex, startIndex + cols);
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              <div
                className="grid gap-4 pb-4"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {rowVideos.map((video) => (
                  <VideoCard key={video.id} video={video} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-4 text-sm text-gray-400 gap-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Loading more…
        </div>
      )}
    </div>
  );
}
