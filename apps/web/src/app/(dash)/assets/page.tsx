'use client';
import { useState, useEffect } from 'react';
import { Layers, Music, Video, Image, Mic, FileText, RefreshCw, CheckCircle, Clock, AlertCircle } from 'lucide-react';

interface Asset {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  label: string | null;
  createdAt: string;
  versions: Array<{ id: string; version: number; provider?: string; durationMs?: number; sizeBytes?: string }>;
}

interface Project {
  id: string;
  title: string;
}

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4007/api';

async function callApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = localStorage.getItem('cf_token');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  MUSIC: Music,
  VIDEO: Video,
  THUMBNAIL: Image,
  VOICE: Mic,
  IMAGE: Image,
  SUBTITLE: FileText,
  UPLOAD: Layers,
  RENDER_SOURCE: Layers,
};

const STATUS_BADGE: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  BRIEFED: { label: 'Brief ready', icon: Clock, color: 'bg-gray-100 text-gray-600' },
  GENERATING: { label: 'Generating', icon: RefreshCw, color: 'bg-blue-100 text-blue-700' },
  READY: { label: 'Ready', icon: CheckCircle, color: 'bg-green-100 text-green-700' },
  ACCEPTED: { label: 'Accepted', icon: CheckCircle, color: 'bg-brand-100 text-brand-700' },
  FAILED: { label: 'Failed', icon: AlertCircle, color: 'bg-red-100 text-red-600' },
};

export default function AssetsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    callApi<{ data: Project[] }>('/projects')
      .then((page) => setProjects(page.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    setLoading(true);
    setError('');
    callApi<{ data: Asset[] }>(`/assets/project/${selectedProject}`)
      .then((page) => setAssets(page.data))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load assets'))
      .finally(() => setLoading(false));
  }, [selectedProject]);

  const grouped = assets.reduce<Record<string, Asset[]>>((acc, a) => {
    acc[a.kind] = [...(acc[a.kind] ?? []), a];
    return acc;
  }, {});

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <Layers className="w-7 h-7 text-brand-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asset Library</h1>
          <p className="text-sm text-gray-500">Voice takes, images, music, thumbnails, and render sources per project</p>
        </div>
      </div>

      {/* Project selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <label htmlFor="assets-project" className="block text-sm font-medium text-gray-700 mb-2">Select Project</label>
        <select
          id="assets-project"
          value={selectedProject}
          onChange={e => setSelectedProject(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Choose a project…</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-brand-500" />
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {selectedProject && !loading && assets.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No assets yet for this project.</p>
          <p className="text-xs mt-1">Run Voice Spec, Image Brief, or Music Brief from the project pipeline.</p>
        </div>
      )}

      {Object.entries(grouped).map(([kind, kindAssets]) => {
        const Icon = KIND_ICONS[kind] ?? Layers;
        return (
          <div key={kind} className="mb-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
              <Icon className="w-4 h-4 text-brand-500" />
              {kind.replace('_', ' ')} ({kindAssets.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {kindAssets.map(asset => {
                const status = STATUS_BADGE[asset.status] ?? STATUS_BADGE['BRIEFED'];
                const StatusIcon = status.icon;
                const latestVersion = asset.versions[0];
                return (
                  <div key={asset.id} className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-medium text-gray-900 truncate flex-1">
                        {asset.label ?? `${kind} — ${asset.id.slice(0, 8)}`}
                      </p>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ml-2 ${status.color}`}>
                        <StatusIcon className={`w-3 h-3 ${asset.status === 'GENERATING' ? 'animate-spin' : ''}`} />
                        {status.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {asset.versions.length} version{asset.versions.length !== 1 ? 's' : ''}
                      {latestVersion?.provider ? ` · ${latestVersion.provider}` : ''}
                      {latestVersion?.durationMs ? ` · ${Math.round(latestVersion.durationMs / 1000)}s` : ''}
                    </p>
                    <p className="text-xs text-gray-300 mt-1">Created {new Date(asset.createdAt).toLocaleDateString()}</p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
