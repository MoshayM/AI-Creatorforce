'use client';
import React from 'react';
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react';

export type BannerType = 'success' | 'error' | 'warning' | 'info';

export interface BannerState {
  type: BannerType;
  message: string;
}

export function safeString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map(safeString).join('\n');
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj['message'] === 'string') return obj['message'];
    try { return JSON.stringify(val); } catch { return 'An unexpected error occurred.'; }
  }
  return 'An unexpected error occurred.';
}

// Simple inline toast — appears at top, auto-dismisses
export function Banner({
  type,
  message,
  onDismiss,
}: { type: BannerType; message: unknown; onDismiss: () => void }) {
  const text = safeString(message);
  const styles: Record<BannerType, string> = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };
  const icons: Record<BannerType, React.ReactNode> = {
    success: <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />,
    error: <XCircle className="w-4 h-4 text-red-600 shrink-0" />,
    warning: <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />,
    info: <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />,
  };
  return (
    <div className={`flex items-start gap-2 border rounded-xl px-4 py-3 text-sm ${styles[type]}`}>
      {icons[type]}
      <span className="flex-1 whitespace-pre-wrap">{text}</span>
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
