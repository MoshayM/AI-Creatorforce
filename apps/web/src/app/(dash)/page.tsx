'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { FolderOpen, Video, Zap, Youtube, ArrowRight, Plus, Sparkles, CalendarClock, Home } from 'lucide-react';
import { api } from '@/lib/api';
import { StatCard } from '@/components/stat-card';

interface Project {
  id: string;
  title: string;
  niche?: string;
  status: string;
  channel: { title: string };
  _count: { jobs: number; videos: number };
  updatedAt: string;
}

interface Channel {
  id: string;
  title: string;
}

type ContentType = 'VIDEO' | 'MUSIC' | 'SHORT';

const CT_BADGE: Record<ContentType, string> = {
  VIDEO: 'bg-red-100 text-red-700',
  MUSIC: 'bg-purple-100 text-purple-700',
  SHORT: 'bg-blue-100 text-blue-700',
};

function getContentType(projectId: string): ContentType {
  if (typeof window === 'undefined') return 'VIDEO';
  return (localStorage.getItem(`cf_ct_${projectId}`) as ContentType | null) ?? 'VIDEO';
}

const QUICK_ACTIONS = [
  {
    href: '/projects',
    icon: Plus,
    label: 'New Project',
    description: 'Start a new content campaign',
    gradient: 'from-violet-500 to-purple-600',
  },
  {
    href: '/autonomy',
    icon: Sparkles,
    label: 'AI Autonomy',
    description: 'Review and approve AI content plans',
    gradient: 'from-pink-500 to-rose-500',
  },
  {
    href: '/scheduler',
    icon: CalendarClock,
    label: 'Schedule',
    description: 'View and manage your content calendar',
    gradient: 'from-blue-500 to-indigo-600',
  },
];

function todayLabel(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function HomePage() {
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.auth.me().then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.projects.list().then((r) => (r.data as { data: Project[] }).data),
  });

  const activeProjects = projects.filter((p) => p.status === 'ACTIVE').length;
  const totalVideos = projects.reduce((s, p) => s + p._count.videos, 0);
  const totalJobs = projects.reduce((s, p) => s + p._count.jobs, 0);
  const recentProjects = [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3);

  const displayName = me?.name ?? 'Creator';

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Welcome banner */}
      <div className="bg-gradient-to-br from-[#9d6ff0] to-[#7c4fd8] rounded-2xl px-6 py-5 text-white flex items-center justify-between shadow-md">
        <div>
          <p className="text-white/70 text-sm mb-0.5">{todayLabel()}</p>
          <h1 className="text-2xl font-bold">Welcome back, {displayName}</h1>
          <p className="text-white/70 text-sm mt-1">Here&apos;s what&apos;s happening with your content.</p>
        </div>
        <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-white/20 items-center justify-center shadow-inner">
          <Home className="w-7 h-7 text-white" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard tone="lilac" icon={<FolderOpen className="w-5 h-5" />} label="Channels" value={channels.length} />
        <StatCard tone="pink" icon={<Zap className="w-5 h-5" />} label="Active Projects" value={activeProjects} sub={`of ${projects.length} total`} subClassName="text-gray-600" />
        <StatCard tone="cream" icon={<Video className="w-5 h-5" />} label="Videos" value={totalVideos} />
        <StatCard tone="periwinkle" icon={<Zap className="w-5 h-5" />} label="AI Jobs" value={totalJobs} sub="across all projects" subClassName="text-gray-600" />
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {QUICK_ACTIONS.map(({ href, icon: Icon, label, description, gradient }) => (
            <Link
              key={href}
              href={href}
              className="group bg-white border border-gray-100 rounded-2xl p-5 hover:shadow-md transition-shadow flex flex-col gap-3"
            >
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-sm`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-gray-900">{label}</p>
                <p className="text-sm text-gray-500 mt-0.5">{description}</p>
              </div>
              <span className="text-xs font-medium text-brand-600 flex items-center gap-1 group-hover:gap-2 transition-all">
                Open <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent projects */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Recent Projects</h2>
          <Link href="/projects" className="text-xs text-brand-600 hover:underline font-medium">View all</Link>
        </div>
        {recentProjects.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm text-gray-500 mb-4">No projects yet. Start your first content campaign!</p>
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Create Project
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50 overflow-hidden">
            {recentProjects.map((p) => {
              const ct = getContentType(p.id);
              return (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-gray-900 text-sm truncate">{p.title}</span>
                    <span className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                      <Youtube className="w-3 h-3" /> {p.channel.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${CT_BADGE[ct]}`}>
                      {ct === 'VIDEO' ? 'Video' : ct === 'MUSIC' ? 'Music' : 'Short'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] ${p.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {p.status}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
