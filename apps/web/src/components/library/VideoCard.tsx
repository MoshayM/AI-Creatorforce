'use client';
import type { LibraryVideo } from '@/lib/api';

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtViews(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`;
  return `${n} views`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function VideoCard({ video }: { video: LibraryVideo }) {
  return (
    <article className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden flex flex-col h-[212px] hover:shadow-md transition-shadow">
      {/* Thumbnail */}
      <div className="relative w-full aspect-video bg-gray-100 shrink-0" style={{ height: '120px' }}>
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.07A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M4 8a2 2 0 012-2h9a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" />
            </svg>
          </div>
        )}
        {/* Duration badge */}
        <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
          {fmtDuration(video.durationMs)}
        </span>
        {/* Short chip */}
        {video.kind === 'short' && (
          <span className="absolute top-1 left-1 bg-brand-600 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
            Short
          </span>
        )}
      </div>
      {/* Body */}
      <div className="flex-1 flex flex-col px-3 py-2 min-h-0">
        <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-snug">{video.title}</p>
        <div className="mt-auto flex items-center justify-between text-[11px] text-gray-500">
          <span>{fmtDate(video.publishedAt)}</span>
          <span>{fmtViews(video.viewCount)}</span>
        </div>
      </div>
    </article>
  );
}
