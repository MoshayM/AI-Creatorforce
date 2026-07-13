'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { FolderOpen, Plus, Loader2, Youtube, Video, Music, Zap, PlayCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { StatCard } from '@/components/stat-card';

type ContentType = 'VIDEO' | 'MUSIC' | 'SHORT';

interface Project {
  id: string;
  title: string;
  niche?: string;
  status: string;
  channel: { title: string; thumbnailUrl?: string };
  _count: { jobs: number; videos: number };
  updatedAt: string;
}

interface Channel {
  id: string;
  title: string;
}

const CONTENT_TYPES: { type: ContentType; label: string; icon: React.ReactNode; desc: string }[] = [
  { type: 'VIDEO', label: 'YouTube Video', icon: <Youtube className="w-4 h-4" />, desc: 'Standard long-form video (trend → script → publish)' },
  { type: 'MUSIC', label: 'Music / Audio', icon: <Music className="w-4 h-4" />, desc: 'Music track, gospel, podcast, or audio content' },
  { type: 'SHORT', label: 'YouTube Short', icon: <Zap className="w-4 h-4" />, desc: 'Vertical short-form content under 60 seconds' },
];

const CT_BADGE: Record<ContentType, string> = {
  VIDEO: 'bg-red-100 text-red-700',
  MUSIC: 'bg-purple-100 text-purple-700',
  SHORT: 'bg-blue-100 text-blue-700',
};

function getContentType(projectId: string): ContentType {
  if (typeof window === 'undefined') return 'VIDEO';
  return (localStorage.getItem(`cf_ct_${projectId}`) as ContentType | null) ?? 'VIDEO';
}

export default function ProjectsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ channelId: '', title: '', niche: '', contentType: 'VIDEO' as ContentType });

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.projects.list().then((r) => (r.data as { data: Project[] }).data),
  });

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.projects.create({ channelId: form.channelId, title: form.title, niche: form.niche || undefined }),
    onSuccess: (res) => {
      const newId: string = (res.data as { id: string }).id;
      localStorage.setItem(`cf_ct_${newId}`, form.contentType);
      void qc.invalidateQueries({ queryKey: ['projects'] });
      setShowCreate(false);
      setForm({ channelId: '', title: '', niche: '', contentType: 'VIDEO' });
    },
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-500 mt-1">Manage your content campaigns</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700"
        >
          <Plus className="w-4 h-4" />
          New Project
        </button>
      </div>

      {/* Pastel stat overview (design ref: analyse.jpg) */}
      {projects.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard tone="lilac" icon={<FolderOpen className="w-5 h-5" />} label="Projects" value={projects.length} />
          <StatCard tone="pink" icon={<PlayCircle className="w-5 h-5" />} label="Active" value={projects.filter((p) => p.status === 'ACTIVE').length} sub="in production" subClassName="text-gray-500" />
          <StatCard tone="cream" icon={<Zap className="w-5 h-5" />} label="Agent Jobs" value={projects.reduce((s, p) => s + p._count.jobs, 0)} sub="across all projects" subClassName="text-gray-500" />
          <StatCard tone="periwinkle" icon={<Video className="w-5 h-5" />} label="Videos" value={projects.reduce((s, p) => s + p._count.videos, 0)} />
        </div>
      )}

      {showCreate && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <h2 className="font-semibold text-gray-900 mb-4">Create Project</h2>
          <div className="space-y-4">
            {/* Content Type Selector */}
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">Content Type</span>
              <div className="grid grid-cols-3 gap-3">
                {CONTENT_TYPES.map((ct) => (
                  <button
                    key={ct.type}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, contentType: ct.type }))}
                    className={`flex flex-col items-start gap-1 p-3 rounded-lg border-2 text-left transition-colors ${
                      form.contentType === ct.type
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className={`flex items-center gap-2 font-medium text-sm ${form.contentType === ct.type ? 'text-brand-700' : 'text-gray-700'}`}>
                      {ct.icon} {ct.label}
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">{ct.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <select
                aria-label="Channel"
                value={form.channelId}
                onChange={(e) => setForm((f) => ({ ...f, channelId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">Select channel</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>{ch.title}</option>
                ))}
              </select>
              <input
                placeholder="Project title"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
              <div>
                <input
                  placeholder="Niche (optional)"
                  value={form.niche}
                  onChange={(e) => setForm((f) => ({ ...f, niche: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {form.contentType === 'MUSIC' ? 'e.g. Gospel, R&B, Worship' :
                   form.contentType === 'SHORT' ? 'e.g. Tech Tips, Life Hacks' :
                   'e.g. Technology, Finance, Cooking'}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => createMutation.mutate()}
                disabled={!form.channelId || !form.title || createMutation.isPending}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Create
              </button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-600">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-brand-600" /></div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <FolderOpen className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>No projects yet. Create your first campaign!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((p) => {
            const ct = getContentType(p.id);
            return (
              <Link key={p.id} href={`/projects/${p.id}`}
                className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">{p.title}</h3>
                  <div className="flex gap-1.5 flex-shrink-0 ml-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CT_BADGE[ct]}`}>
                      {ct === 'VIDEO' ? 'Video' : ct === 'MUSIC' ? 'Music' : 'Short'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      p.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>{p.status}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                  <Youtube className="w-4 h-4" />
                  {p.channel.title}
                  {p.niche && <span className="text-gray-500">· {p.niche}</span>}
                </div>
                <div className="flex gap-4 text-sm text-gray-500">
                  <span className="flex items-center gap-1"><Activity className="w-3 h-3" />{p._count.jobs} jobs</span>
                  <span className="flex items-center gap-1"><Video className="w-3 h-3" />{p._count.videos} videos</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Activity({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>;
}
