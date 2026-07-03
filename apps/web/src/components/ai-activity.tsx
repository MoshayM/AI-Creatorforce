'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Timer } from 'lucide-react';

export function formatElapsed(totalSecs: number): string {
  if (totalSecs < 60) return `${totalSecs}s`;
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  return formatElapsed(Math.round(ms / 1000));
}

export function useElapsedSeconds(since: string | number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since == null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);

  if (since == null) return 0;
  const start = typeof since === 'number' ? since : new Date(since).getTime();
  return Math.max(0, Math.floor((now - start) / 1000));
}

export function ElapsedBadge({ since, className = '' }: { since: string | number; className?: string }) {
  const secs = useElapsedSeconds(since);
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-gray-400 tabular-nums ${className}`}>
      <Timer className="w-3 h-3" />
      {formatElapsed(secs)}
    </span>
  );
}

interface AiWorkingCardProps {
  title: string;
  steps?: string[];
  hint?: string;
}

const STEP_INTERVAL_SECS = 5;

export function AiWorkingCard({ title, steps = [], hint }: AiWorkingCardProps) {
  const startRef = useRef<number>(Date.now());
  const secs = useElapsedSeconds(startRef.current);
  const stepIdx = steps.length ? Math.min(Math.floor(secs / STEP_INTERVAL_SECS), steps.length - 1) : -1;

  return (
    <div className="bg-white border border-brand-100 rounded-xl p-6 fade-in" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-brand-600 animate-pulse" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">{title}</p>
            {stepIdx >= 0 && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{steps[stepIdx]}…</p>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{formatElapsed(secs)}</p>
          <p className="text-xs text-gray-400 mt-1">elapsed</p>
        </div>
      </div>

      <div className="h-1.5 rounded-full shimmer-bar" />

      <p className="text-xs text-gray-400 mt-3">
        {hint ?? 'This usually takes 10–30 seconds — results appear here the moment they are ready.'}
      </p>
    </div>
  );
}
