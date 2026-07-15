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

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  RENDERING: 'bg-blue-100 text-blue-700',
  READY: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
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
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Film className="w-6 h-6 text-brand-600" /> Video Editor
          </h1>
          <p className="text-gray-500 mt-1">Create and edit video projects with a multi-track timeline</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-xl text-sm hover:bg-brand-700"
        >
          <Plus className="w-4 h-4" /> New edit
        </button>
      </div>

      {showForm && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl shadow-sm p-5">
          <p className="text-sm font-semibold text-gray-800 mb-3">New edit project</p>
          <div className="flex gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowForm(false); }}
              placeholder="Edit title (e.g. My YouTube Video)"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand-400"
            />
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
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

      {isLoading && (
        <div className="flex items-center gap-2 text-gray-500 py-16 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading edit projects…
        </div>
      )}

      {!!error && !isLoading && (
        <div className="py-16 text-center">
          <AlertCircle className="w-8 h-8 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Could not load edit projects. Create a new one to get started.</p>
        </div>
      )}

      {!isLoading && !error && projects.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          <Film className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="mb-4">No edit projects yet.</p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700"
          >
            <Plus className="w-4 h-4" /> Create your first edit
          </button>
        </div>
      )}

      {!isLoading && projects.length > 0 && (
        <div className="space-y-2">
          {projects.map((p) => (
            <a
              key={p.id}
              href={`/editor/${p.id}`}
              className="block bg-white border border-gray-100 rounded-xl shadow-sm px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Film className="w-5 h-5 text-brand-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{p.title}</p>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3" />
                    {relativeTime(p.lastEditedAt)} · {p.width}×{p.height} · {p.fps}fps
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${STATUS_COLORS[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {p.status.toLowerCase()}
                </span>
                <Pencil className="w-4 h-4 text-gray-300 shrink-0" />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
