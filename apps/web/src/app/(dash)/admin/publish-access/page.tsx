'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { api, type PublishAccessRequest, type PublishGrantStatus } from '@/lib/api';
import { getErrorMessage } from '@/lib/getErrorMessage';

// ── Status chip ───────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: PublishGrantStatus }) {
  const styles: Record<PublishGrantStatus, string> = {
    REQUESTED: 'bg-amber-100 text-amber-700',
    GRANTED: 'bg-green-100 text-green-700',
    DENIED: 'bg-red-100 text-red-600',
    REVOKED: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${styles[status]}`}>
      {status}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PublishAccessPage() {
  const [requests, setRequests] = useState<PublishAccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  // Per-row action loading state: key = userId, value = action in progress
  const [acting, setActing] = useState<Record<string, 'approve' | 'deny' | 'revoke'>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.publishAccess.listRequests();
      setRequests(res.data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 403) setForbidden(true);
      else setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAction(userId: string, action: 'approve' | 'deny' | 'revoke') {
    setActing((prev) => ({ ...prev, [userId]: action }));
    try {
      if (action === 'approve') await api.publishAccess.approve(userId);
      else if (action === 'deny') await api.publishAccess.deny(userId);
      else await api.publishAccess.revoke(userId);
      // Optimistic refresh: reload the list
      await load();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setActing((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  }

  if (forbidden) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full text-center">
        <ShieldAlert className="w-10 h-10 text-gray-300 mb-3" />
        <p className="text-sm font-semibold text-gray-600">Admin access required</p>
        <p className="text-xs text-gray-500 mt-1">This page is available to platform owners, super admins, and creator roles.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-brand-600" /> Publish access
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Approve, deny, or revoke direct YouTube publish access for users
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void load(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {/* Table */}
      <section className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        {loading && requests.length === 0 ? (
          <p className="text-sm text-gray-500 py-10 text-center">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-gray-500 py-10 text-center">No publish access requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4 font-semibold">User</th>
                  <th className="py-2 pr-4 font-semibold">Role</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                  <th className="py-2 pr-4 font-semibold">Requested</th>
                  <th className="py-2 pr-4 font-semibold">Decided</th>
                  <th className="py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requests.map((req) => {
                  const currentAction = acting[req.userId];
                  const busy = currentAction !== undefined;
                  return (
                    <tr key={req.id}>
                      {/* User */}
                      <td className="py-2.5 pr-4">
                        <p className="font-medium text-gray-800">{req.user.name ?? '—'}</p>
                        <p className="text-[11px] text-gray-500">{req.user.email}</p>
                      </td>
                      {/* Role */}
                      <td className="py-2.5 pr-4 text-gray-600 text-[12px]">{req.user.role}</td>
                      {/* Status */}
                      <td className="py-2.5 pr-4">
                        <StatusChip status={req.status} />
                      </td>
                      {/* Requested at */}
                      <td className="py-2.5 pr-4 text-gray-500 text-[12px] tabular-nums">
                        {fmtDate(req.requestedAt)}
                      </td>
                      {/* Decided at */}
                      <td className="py-2.5 pr-4 text-gray-500 text-[12px] tabular-nums">
                        {fmtDate(req.decidedAt)}
                      </td>
                      {/* Actions */}
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {req.status === 'REQUESTED' && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => { void handleAction(req.userId, 'approve'); }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-100 hover:bg-green-200 text-xs font-semibold text-green-700 transition-colors disabled:opacity-50"
                              >
                                {currentAction === 'approve'
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <CheckCircle2 className="w-3 h-3" />}
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => { void handleAction(req.userId, 'deny'); }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-100 hover:bg-red-200 text-xs font-semibold text-red-600 transition-colors disabled:opacity-50"
                              >
                                {currentAction === 'deny'
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <XCircle className="w-3 h-3" />}
                                Deny
                              </button>
                            </>
                          )}
                          {req.status === 'GRANTED' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => { void handleAction(req.userId, 'revoke'); }}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#f0eafc] hover:bg-[#e5dbf9] text-xs font-semibold text-[#7c4fd8] transition-colors disabled:opacity-50"
                            >
                              {currentAction === 'revoke'
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <XCircle className="w-3 h-3" />}
                              Revoke
                            </button>
                          )}
                          {(req.status === 'DENIED' || req.status === 'REVOKED') && (
                            <span className="text-[11px] text-gray-400">No actions</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
