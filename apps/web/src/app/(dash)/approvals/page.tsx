'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useState } from 'react';

interface Approval {
  id: string;
  status: string;
  expiresAt: string;
  project: { title: string; channel: { title: string } };
  job: { type: string; result: unknown };
}

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const { data: approvals = [], isLoading } = useQuery<Approval[]>({
    queryKey: ['approvals'],
    queryFn: () => api.approvals.listPending().then((r) => r.data as Approval[]),
    refetchInterval: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.approvals.approve(id, notes[id]),
    onSuccess: (_, { id }) => {
      qc.setQueryData<Approval[]>(['approvals'], (old) => (old ?? []).filter((a) => a.id !== id));
    },
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => api.approvals.reject(id, notes[id]),
    onSuccess: (_, { id }) => {
      qc.setQueryData<Approval[]>(['approvals'], (old) => (old ?? []).filter((a) => a.id !== id));
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
        <div className="text-center py-20 text-gray-400">
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
                  <p className="text-sm text-gray-500">{a.project.channel.title} · {a.job.type}</p>
                </div>
                <div className="flex items-center gap-1 text-sm text-orange-600">
                  <Clock className="w-4 h-4" />
                  Expires {new Date(a.expiresAt).toLocaleDateString()}
                </div>
              </div>

              {a.job.result ? (
                <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm text-gray-700 max-h-48 overflow-y-auto">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(a.job.result as object, null, 2)}</pre>
                </div>
              ) : null}

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
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
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
    </div>
  );
}
