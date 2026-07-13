'use client';
import React from 'react';

/**
 * Pastel KPI stat card (design ref: analyse.jpg): soft tinted card with a
 * rounded icon tile, label, big value, and an optional delta/subtitle line.
 */
export type StatTone = 'lilac' | 'pink' | 'cream' | 'periwinkle';

const TONES: Record<StatTone, { card: string; tile: string }> = {
  lilac: { card: 'bg-[#f0eafc]', tile: 'bg-[#b39df3]' },
  pink: { card: 'bg-[#fceaf2]', tile: 'bg-[#f2a3c6]' },
  cream: { card: 'bg-[#fdf5dd]', tile: 'bg-[#eec95c]' },
  periwinkle: { card: 'bg-[#e9edfc]', tile: 'bg-[#93a8ef]' },
};

export function StatCard({
  tone,
  icon,
  label,
  value,
  sub,
  subClassName = 'text-green-800',
}: {
  tone: StatTone;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  subClassName?: string;
}) {
  return (
    <div className={`${TONES[tone].card} rounded-2xl p-5 shadow-sm`}>
      <div className={`${TONES[tone].tile} w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm mb-3`}>
        {icon}
      </div>
      <p className="text-xs font-medium text-gray-600">{label}</p>
      <p className="text-3xl font-bold text-gray-900 mt-0.5 tabular-nums">{value}</p>
      {sub && <p className={`text-xs font-medium mt-1 ${subClassName}`}>{sub}</p>}
    </div>
  );
}

/** Rounded pastel bar chart (pure CSS, no chart lib). */
export function PastelBars({
  data,
  maxBars = 7,
  formatValue,
}: {
  data: Array<{ label: string; value: number; title?: string }>;
  maxBars?: number;
  formatValue?: (v: number) => string;
}) {
  const bars = data.slice(0, maxBars);
  const max = Math.max(...bars.map((b) => b.value), 0.0001);
  const COLORS = ['#b39df3', '#f2a3c6', '#f5b969', '#f7d872', '#9fd8a5', '#8fb8ef', '#c9a3ef'];
  return (
    <div className="flex items-end justify-around gap-3 h-44 pt-2">
      {bars.map((b, i) => (
        <div key={i} className="flex flex-col items-center gap-2 flex-1 min-w-0" title={b.title ?? `${b.label}: ${formatValue ? formatValue(b.value) : b.value}`}>
          <span className="text-[10px] text-gray-500 tabular-nums">{formatValue ? formatValue(b.value) : b.value}</span>
          <div
            className="w-6 rounded-full transition-all duration-500"
            style={{ height: `${Math.max((b.value / max) * 120, 8)}px`, backgroundColor: COLORS[i % COLORS.length] }}
          />
          <span className="text-[10px] text-gray-500 truncate max-w-full">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Donut chart via conic-gradient (pure CSS) with a legend. */
export function PastelDonut({
  segments,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <p className="text-sm text-gray-500 py-8 text-center">No data yet</p>;

  let acc = 0;
  const stops = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const from = (acc / total) * 360;
      acc += s.value;
      const to = (acc / total) * 360;
      return `${s.color} ${from}deg ${to}deg`;
    })
    .join(', ');

  return (
    <div className="flex items-center gap-6">
      <div
        className="w-32 h-32 rounded-full shrink-0 relative"
        style={{ background: `conic-gradient(${stops})` }}
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${Math.round((s.value / total) * 100)}%`).join(', ')}
      >
        <div className="absolute inset-[22%] bg-white rounded-full shadow-inner" />
      </div>
      <ul className="space-y-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs text-gray-600">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="font-semibold tabular-nums">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
