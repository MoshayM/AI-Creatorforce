'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Clock, Loader2, Clapperboard, Tag, FileText, History, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { api, apiClient } from '@/lib/api';
import { useEffect, useState } from 'react';

interface Approval {
  id: string;
  status: string;
  expiresAt: string;
  reviewedAt?: string | null;
  notes?: string | null;
  project: { title: string; channel: { title: string } };
  job: { type: string; result: unknown };
}

const STATUS_CHIP: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
  PENDING: 'bg-gray-100 text-gray-500', // lapsed-pending shown as expired
};

interface ShortsExportResult {
  shortClipId?: string;
  clipType?: string;
  exportVersionId?: string | null;
  durationMs?: number | null;
  metadata?: { title?: string; description?: string; tags?: string[] };
}

function isShortsExport(type: string, result: unknown): result is ShortsExportResult {
  return type === 'SHORTS_EXPORT' && !!result && typeof result === 'object';
}

function useBlobUrl(versionId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!versionId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void apiClient.get(`/media/versions/${versionId}/file`, { responseType: 'blob' }).then((r) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(r.data as Blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [versionId]);
  return url;
}

/** Watchable review card for a Shorts export awaiting publish approval. */
function ShortsExportReview({ result }: { result: ShortsExportResult }) {
  const videoUrl = useBlobUrl(result.exportVersionId);
  const meta = result.metadata ?? {};
  return (
    <div className="flex gap-4 bg-gray-50 rounded-lg p-4 mb-4">
      <div className="w-32 shrink-0">
        {videoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- AI-generated preview; caption track not produced
          <video src={videoUrl} controls className="w-full rounded-lg aspect-[9/16] object-cover bg-black" />
        ) : (
          <div className="w-full rounded-lg aspect-[9/16] bg-gray-200 flex items-center justify-center">
            <Clapperboard className="w-6 h-6 text-gray-500" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-brand-700 uppercase tracking-wide flex items-center gap-1.5">
          <Clapperboard className="w-3.5 h-3.5" />
          {(result.clipType ?? 'SHORT').replace(/_/g, ' ')}
          {result.durationMs ? ` · ${Math.round(result.durationMs / 1000)}s` : ''}
        </p>
        {meta.title && <p className="font-semibold text-gray-900 mt-1.5">{meta.title}</p>}
        {meta.description && (
          <p className="text-sm text-gray-600 mt-1 whitespace-pre-line line-clamp-4">{meta.description}</p>
        )}
        {(meta.tags?.length ?? 0) > 0 && (
          <p className="flex items-center gap-1 flex-wrap mt-2">
            <Tag className="w-3 h-3 text-gray-500" />
            {meta.tags!.slice(0, 8).map((t) => (
              <span key={t} className="px-1.5 py-0.5 bg-brand-50 text-brand-700 rounded text-[11px]">{t}</span>
            ))}
          </p>
        )}
        {result.shortClipId && (
          <Link href={`/shorts-studio/clips/${result.shortClipId}/export`} className="inline-block text-xs text-brand-600 hover:underline mt-2">
            Open full export page →
          </Link>
        )}
      </div>
    </div>
  );
}

/** Readable fallback for other job results: flat fields as labeled rows, raw JSON behind a toggle. */
function GenericResultView({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;
  const flat = Object.entries(obj).filter(([, v]) =>
    ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === 'string')));

  return (
    <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm">
      {flat.length > 0 ? (
        <dl className="space-y-1.5">
          {flat.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-gray-500 shrink-0 w-32 capitalize">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
              <dd className="text-gray-700 min-w-0 break-words">
                {Array.isArray(v) ? (v as string[]).join(', ') : String(v)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-gray-500 flex items-center gap-1.5"><FileText className="w-4 h-4" /> Structured result attached</p>
      )}
      <details className="mt-2">
        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-600">Raw details</summary>
        <pre className="whitespace-pre-wrap text-xs text-gray-500 mt-1 max-h-40 overflow-y-auto">{JSON.stringify(obj, null, 2)}</pre>
      </details>
    </div>
  );
}

/**
 * Reviewed/expired approval: compact row that expands on click into the full
 * review card (video preview + metadata for shorts). The preview blob only
 * loads once expanded, so a long history stays cheap.
 */
function HistoryRow({ a, open, onToggle }: { a: Approval; open: boolean; onToggle: () => void }) {
  const shorts = isShortsExport(a.job.type, a.job.result) ? a.job.result : null;
  const title = shorts?.metadata?.title
    ?? (a.job.type === 'SHORTS_EXPORT' ? 'Short clip' : a.job.type.replace(/_/g, ' ').toLowerCase());
  const effectiveStatus = a.status === 'PENDING' ? 'EXPIRED' : a.status;
  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors cursor-pointer"
      >
        {open ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />}
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${STATUS_CHIP[effectiveStatus] ?? 'bg-gray-100 text-gray-500'}`}>
          {effectiveStatus}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
          <p className="text-[11px] text-gray-500 truncate">
            {a.project.title} · {a.project.channel.title}
            {a.reviewedAt ? ` · reviewed ${new Date(a.reviewedAt).toLocaleString()}` : ''}
          </p>
        </div>
        {shorts?.shortClipId && (
          <Link
            href={`/shorts-studio/clips/${shorts.shortClipId}/export`}
            onClick={(e) => e.stopPropagation()}
            className="text-brand-600 hover:text-brand-700 shrink-0"
            title="Open clip export page"
          >
            <ExternalLink className="w-4 h-4" />
          </Link>
        )}
      </div>
      {open && (
        <div className="px-4 pb-4 border-t border-gray-50 pt-3">
          {shorts ? <ShortsExportReview result={shorts} /> : <GenericResultView result={a.job.result} />}
          <div className="text-xs text-gray-500 space-y-0.5 -mt-2">
            {a.notes && <p><span className="text-gray-500">Review notes:</span> “{a.notes}”</p>}
            {a.reviewedAt && <p><span className="text-gray-500">Reviewed:</span> {new Date(a.reviewedAt).toLocaleString()}</p>}
            <p><span className="text-gray-500">Expires{effectiveStatus === 'EXPIRED' ? 'd' : ''}:</span> {new Date(a.expiresAt).toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const { data: approvals = [], isLoading } = useQuery<Approval[]>({
    queryKey: ['approvals'],
    queryFn: () => api.approvals.listPending().then((r) => r.data as Approval[]),
    refetchInterval: 30_000,
  });

  const { data: history = [] } = useQuery<Approval[]>({
    queryKey: ['approvals-history'],
    queryFn: () => api.approvals.listHistory().then((r) => r.data as Approval[]),
    refetchInterval: 60_000,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.approvals.approve(id, notes[id]),
    onSuccess: (_, { id }) => {
      qc.setQueryData<Approval[]>(['approvals'], (old) => (old ?? []).filter((a) => a.id !== id));
      void qc.invalidateQueries({ queryKey: ['approvals-history'] });
    },
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.approvals.reject(id, notes[id]),
    onSuccess: (_, { id }) => {
      qc.setQueryData<Approval[]>(['approvals'], (old) => (old ?? []).filter((a) => a.id !== id));
      void qc.invalidateQueries({ queryKey: ['approvals-history'] });
    },
  });

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Approval Center</h1>
        <p className="text-gray-500 mt-1">Review AI-generated content before it goes live</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>
      ) : approvals.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No pending approvals. All caught up!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((a) => (
            <div key={a.id} className="bg-white border border-gray-200 rounded-xl p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{a.project.title}</h3>
                  <p className="text-sm text-gray-500">
                    {a.project.channel.title} · {a.job.type === 'SHORTS_EXPORT' ? 'Short ready to publish' : a.job.type.replace(/_/g, ' ').toLowerCase()}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-sm text-orange-600">
                  <Clock className="w-4 h-4" />
                  Expires {new Date(a.expiresAt).toLocaleDateString()}
                </div>
              </div>

              {isShortsExport(a.job.type, a.job.result)
                ? <ShortsExportReview result={a.job.result} />
                : <GenericResultView result={a.job.result} />}

              <div className="mb-4">
                <textarea
                  placeholder="Review notes (optional)"
                  value={notes[a.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => approveMutation.mutate({ id: a.id })}
                  disabled={approveMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => rejectMutation.mutate({ id: a.id })}
                  disabled={rejectMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <section className="mt-10">
          <div
            onClick={() => setHistoryOpen((o) => !o)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHistoryOpen((o) => !o); } }}
            className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
          >
            {historyOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
              <History className="w-4 h-4" /> Recently reviewed
            </h2>
            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[11px] font-medium">{history.length}</span>
            {historyOpen && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenRows((prev) => prev.size === history.length ? new Set() : new Set(history.map((a) => a.id)));
                }}
                className="ml-auto text-xs text-brand-600 hover:underline"
              >
                {openRows.size === history.length ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          {historyOpen && (
            <div className="space-y-2 mt-2">
              {history.map((a) => (
                <HistoryRow
                  key={a.id}
                  a={a}
                  open={openRows.has(a.id)}
                  onToggle={() => setOpenRows((prev) => {
                    const next = new Set(prev);
                    if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
                    return next;
                  })}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
