'use client';
import { useState, useEffect } from 'react';
import { Layers, Music, Video, Image, Mic, FileText, RefreshCw, CheckCircle, Clock, AlertCircle, ChevronDown } from 'lucide-react';

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

const STATUS_BADGE: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; style: React.CSSProperties }> = {
  BRIEFED: { label: 'Brief ready', icon: Clock, style: { background: '#f3f4f6', color: '#4b5563' } },
  GENERATING: { label: 'Generating', icon: RefreshCw, style: { background: '#eff6ff', color: '#1d4ed8' } },
  READY: { label: 'Ready', icon: CheckCircle, style: { background: '#ecfdf5', color: '#065f46' } },
  ACCEPTED: { label: 'Accepted', icon: CheckCircle, style: { background: '#f5f2fd', color: '#6D4AE0' } },
  FAILED: { label: 'Failed', icon: AlertCircle, style: { background: '#fef2f2', color: '#dc2626' } },
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
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">
        {/* Page header */}
        <div className="flex items-center gap-3">
          <Layers className="w-7 h-7" style={{ color: '#6D4AE0' }} />
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Asset Library</h1>
            <p className="text-sm text-gray-400 mt-0.5">Voice takes, images, music, thumbnails, and render sources per project</p>
          </div>
        </div>

        {/* Project selector */}
        <div className="bg-white rounded-2xl p-5" style={{ border: '1.5px solid #e3ddf8' }}>
          <label htmlFor="assets-project" className="block text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-2">Select Project</label>
          <div className="relative">
            <select
              id="assets-project"
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="w-full bg-white rounded-2xl px-4 py-3 pr-10 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] transition-all appearance-none"
              style={{ border: '1.5px solid #e3e0f0' }}
            >
              <option value="">Choose a project…</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin" style={{ color: '#6D4AE0' }} />
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}

        {selectedProject && !loading && assets.length === 0 && (
          <div className="bg-white rounded-3xl p-12 flex flex-col items-center text-center" style={{ border: '1.5px solid #e3ddf8' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}>
              <Layers className="w-7 h-7" style={{ color: '#6D4AE0' }} />
            </div>
            <p className="text-sm font-semibold text-gray-700">No assets yet for this project</p>
            <p className="text-xs text-gray-400 mt-1">Run Voice Spec, Image Brief, or Music Brief from the project pipeline.</p>
          </div>
        )}

        {Object.entries(grouped).map(([kind, kindAssets]) => {
          const Icon = KIND_ICONS[kind] ?? Layers;
          return (
            <div key={kind}>
              <h2 className="flex items-center gap-2 mb-3">
                <Icon className="w-4 h-4 text-[#6D4AE0]" />
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400">
                  {kind.replace('_', ' ')}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: '#f5f2fd', color: '#6D4AE0' }}>
                  {kindAssets.length}
                </span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {kindAssets.map(asset => {
                  const status = STATUS_BADGE[asset.status] ?? STATUS_BADGE['BRIEFED'];
                  const StatusIcon = status.icon;
                  const latestVersion = asset.versions[0];
                  return (
                    <div key={asset.id} className="bg-white rounded-2xl p-4" style={{ border: '1.5px solid #e3ddf8' }}>
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-gray-900 truncate flex-1">
                          {asset.label ?? `${kind} — ${asset.id.slice(0, 8)}`}
                        </p>
                        <span
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ml-2"
                          style={status.style}
                        >
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
    </div>
  );
}
