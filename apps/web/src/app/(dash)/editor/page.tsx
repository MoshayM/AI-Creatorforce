'use client';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Film, Plus, Clock, Loader2, AlertCircle, Pencil } from 'lucide-react';
import { api, type EditProject } from '@/lib/api';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  DRAFT:     { background: '#f3f4f6', color: '#4b5563' },
  RENDERING: { background: '#eff6ff', color: '#1d4ed8' },
  READY:     { background: '#ecfdf5', color: '#065f46' },
  FAILED:    { background: '#fef2f2', color: '#b91c1c' },
};

export default function EditorListPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [showForm, setShowForm] = useState(false);

  // Channel-first: the API resolves ownership from the current user.
  const { data: projects = [], isLoading, error } = useQuery<EditProject[]>({
    queryKey: ['editor-projects'],
    queryFn: () => api.editor.listMine().then((r) => r.data),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: (title: string) =>
      api.editor.createBlank({ title: title || 'Untitled Edit' }).then((r) => r.data),
    onSuccess: (data) => {
      router.push(`/editor/${data.id}`);
    },
  });

  const handleCreate = () => {
    if (creating) return;
    setCreating(true);
    createMutation.mutate(newTitle || 'Untitled Edit');
  };

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
            >
              <Film className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Video Editor</h1>
              <p className="text-sm text-gray-400 mt-0.5">Create and edit video projects with a multi-track timeline</p>
            </div>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-white text-sm font-semibold"
            style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
          >
            <Plus className="w-4 h-4" /> New edit
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
            <p className="text-sm font-semibold text-gray-800 mb-3">New edit project</p>
            <div className="flex gap-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowForm(false); }}
                placeholder="Edit title (e.g. My YouTube Video)"
                className="bg-white rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all flex-1"
                style={{ border: '1.5px solid #e3e0f0' }}
              />
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-white text-sm font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-3 py-2 rounded-2xl text-gray-600 text-sm"
                style={{ border: '1.5px solid #e3ddf8' }}
              >
                Cancel
              </button>
            </div>
            {createMutation.isError && (
              <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                {(createMutation.error as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed to create edit'}
              </p>
            )}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2 text-gray-500 py-16 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading edit projects…
          </div>
        )}

        {/* Error */}
        {!!error && !isLoading && (
          <div className="py-16 text-center">
            <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Could not load edit projects. Create a new one to get started.</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && projects.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <Film className="w-10 h-10 mx-auto mb-3" style={{ color: '#6D4AE0', opacity: 0.3 }} />
            <p className="mb-4">No edit projects yet.</p>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl text-white text-sm font-semibold"
              style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
            >
              <Plus className="w-4 h-4" /> Create your first edit
            </button>
          </div>
        )}

        {/* Project list */}
        {!isLoading && projects.length > 0 && (
          <div className="space-y-2">
            {projects.map((p) => (
              <a
                key={p.id}
                href={`/editor/${p.id}`}
                className="block bg-white rounded-2xl px-5 py-4 hover:bg-[#faf9ff] transition-colors"
                style={{ border: '1.5px solid #e3ddf8' }}
              >
                <div className="flex items-center gap-3">
                  <Film className="w-5 h-5 shrink-0" style={{ color: '#6D4AE0' }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{p.title}</p>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {relativeTime(p.lastEditedAt)} · {p.width}×{p.height} · {p.fps}fps
                    </p>
                  </div>
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0"
                    style={STATUS_STYLES[p.status] ?? { background: '#f3f4f6', color: '#4b5563' }}
                  >
                    {p.status.toLowerCase()}
                  </span>
                  <Pencil className="w-4 h-4 text-gray-300 shrink-0" />
                </div>
              </a>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
