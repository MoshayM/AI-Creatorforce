'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  FolderOpen, Video, Zap, Youtube, ArrowRight, Plus, Sparkles, CalendarClock,
  CheckCircle2, Circle, ChevronRight, Bot, Mic2, MessageSquare, TrendingUp,
  Clock, Activity, PlayCircle, FileText, Music2, Image as ImageIcon, Film,
  LayoutDashboard, Flame,
} from 'lucide-react';
import { api, type TrialStatusResponse, type ChannelAutomation } from '@/lib/api';
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

interface Channel { id: string; title: string; }

const JOB_ICON: Record<string, React.ElementType> = {
  RESEARCH: BookOpenIcon,
  SCRIPT: FileText,
  VOICE_GENERATE: Mic2,
  MUSIC_GENERATE: Music2,
  IMAGE_GENERATE: ImageIcon,
  VIDEO_GENERATE: Film,
  RENDER: PlayCircle,
  THUMBNAIL: ImageIcon,
};

function BookOpenIcon(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...p}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: '#10B981',
  RUNNING:   '#F59E0B',
  FAILED:    '#EF4444',
  PENDING:   '#8B8FA8',
  DRAFT:     '#8B8FA8',
};

const QUICK_PROMPTS = [
  { label: 'New YouTube video', icon: PlayCircle, prompt: 'Create a new YouTube video' },
  { label: 'Create Shorts',     icon: Zap,        prompt: 'Create YouTube Shorts from an existing video' },
  { label: 'Research a topic',  icon: TrendingUp, prompt: 'Research a topic for my next video' },
  { label: 'Write a script',    icon: FileText,   prompt: 'Write a script for my next video' },
];

function greet(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name}`;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function daysUntil(dateStr: string): number {
  return Math.max(0, Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000));
}

export default function HomePage() {
  const [onboardingDone, setOnboardingDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (localStorage.getItem('cf.onboarding.done') === '1') setOnboardingDone(true);
  }, []);

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

  const firstChannelId = channels[0]?.id;

  const { data: automation } = useQuery<ChannelAutomation>({
    queryKey: ['automation', firstChannelId],
    queryFn: () => api.automation.get(firstChannelId!).then((r) => r.data),
    enabled: !!firstChannelId,
    staleTime: 60_000,
  });

  const { data: trialStatus } = useQuery<TrialStatusResponse>({
    queryKey: ['trial-status'],
    queryFn: () => api.trial.status().then((r) => r.data),
    staleTime: 120_000,
  });

  const displayName = (me?.name ?? 'Creator').split(' ')[0] ?? 'Creator';
  const activeProjects = projects.filter((p) => p.status === 'ACTIVE');
  const totalVideos = projects.reduce((s, p) => s + p._count.videos, 0);
  const totalJobs = projects.reduce((s, p) => s + p._count.jobs, 0);

  const recentProjects = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);
  const lastProject = recentProjects[0];

  const showTrial = trialStatus?.hasTrial && (trialStatus.trialCreditsRemaining ?? 0) > 0;
  const creditsPct = trialStatus?.creditsGranted
    ? Math.round(((trialStatus.trialCreditsRemaining ?? 0) / trialStatus.creditsGranted) * 100)
    : 0;
  const daysLeft = trialStatus?.expiresAt ? daysUntil(trialStatus.expiresAt) : null;

  const steps = [
    { label: 'Connect a YouTube channel',        done: channels.length > 0, href: '/library?tab=channels' },
    { label: 'Create your first project',         done: projects.length > 0, href: '/projects' },
    { label: 'Enable AI automation',              done: automation?.enabled === true, href: '/automation' },
    { label: 'Generate your first AI content',    done: totalJobs > 0, href: '/autonomy' },
  ];
  const completedCount = steps.filter((s) => s.done).length;
  const allComplete = completedCount === steps.length;

  useEffect(() => {
    if (allComplete && !onboardingDone) {
      localStorage.setItem('cf.onboarding.done', '1');
      const t = setTimeout(() => setOnboardingDone(true), 3000);
      return () => clearTimeout(t);
    }
  }, [allComplete, onboardingDone]);

  function openCopilotWithPrompt(prompt: string) {
    window.dispatchEvent(new CustomEvent('cf:open-copilot'));
    setTimeout(() => {
      const inp = document.querySelector<HTMLInputElement>('input[placeholder="Type a message…"]');
      if (inp) { inp.value = prompt; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); }
    }, 400);
  }

  return (
    <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">

      {/* ── AI GREETING BANNER ──────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden relative"
        style={{background:'linear-gradient(135deg,#1a0f4a 0%,#2d1b6e 50%,#3b1fa8 100%)'}}
      >
        {/* Glow */}
        <div aria-hidden className="absolute top-0 right-0 w-64 h-64 opacity-20 pointer-events-none" style={{background:'radial-gradient(circle,#a78bfa 0%,transparent 70%)',filter:'blur(30px)'}} />

        <div className="relative px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          {/* Copilot orb */}
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{background:'rgba(167,139,250,.2)',border:'1px solid rgba(167,139,250,.3)'}}>
            <Bot className="w-7 h-7 text-purple-300" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white/60 text-sm font-medium">{greet(displayName)}</p>
            <h1 className="text-white font-bold text-xl leading-tight mt-0.5">What would you like to create today?</h1>

            {/* Quick prompt input */}
            <div className="mt-3 flex items-center gap-2 rounded-xl px-3.5 py-2.5 max-w-lg" style={{background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.12)'}}>
              <MessageSquare className="w-4 h-4 shrink-0 text-purple-300" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Describe what you want to create…"
                className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder:text-white/40"
                style={{fontFamily:'inherit'}}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    openCopilotWithPrompt((e.target as HTMLInputElement).value.trim());
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const val = inputRef.current?.value.trim();
                  if (val) { openCopilotWithPrompt(val); if (inputRef.current) inputRef.current.value = ''; }
                  else window.dispatchEvent(new CustomEvent('cf:open-copilot'));
                }}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-80"
                style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)'}}
              >
                Ask AI
              </button>
            </div>

            {/* Quick suggestion chips */}
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_PROMPTS.map(({ label, icon: Icon, prompt }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => openCopilotWithPrompt(prompt)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white/80 transition-all hover:text-white hover:bg-white/15"
                  style={{background:'rgba(255,255,255,.08)',border:'1px solid rgba(255,255,255,.12)'}}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Voice button */}
          <button
            type="button"
            title="Voice mode"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('cf:open-copilot'));
              setTimeout(() => document.querySelector<HTMLButtonElement>('button[title="Start listening"]')?.click(), 500);
            }}
            className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-all hover:scale-110"
            style={{background:'rgba(167,139,250,.2)',border:'1px solid rgba(167,139,250,.3)',color:'#c4b5fd'}}
          >
            <Mic2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── STATS ROW ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard tone="lilac"     icon={<FolderOpen className="w-5 h-5" />} label="Channels"        value={channels.length} />
        <StatCard tone="pink"      icon={<Zap className="w-5 h-5" />}        label="Active Projects"  value={activeProjects.length} sub={`of ${projects.length} total`} subClassName="text-gray-600" />
        <StatCard tone="cream"     icon={<Video className="w-5 h-5" />}      label="Videos"           value={totalVideos} />
        <StatCard tone="periwinkle"icon={<Activity className="w-5 h-5" />}   label="AI Jobs"          value={totalJobs} sub="across all projects" subClassName="text-gray-600" />
      </div>

      {/* ── CONTINUE + ONBOARDING (side by side on lg) ───────────────────── */}
      <div className="grid lg:grid-cols-5 gap-5">

        {/* Continue where you left off */}
        <div className="lg:col-span-3 flex flex-col gap-3">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Continue
          </h2>

          {lastProject ? (
            <Link
              href={`/projects/${lastProject.id}`}
              className="group bg-white border border-gray-100 rounded-2xl p-5 hover:border-purple-200 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{background: lastProject.status==='ACTIVE'?'#ECFDF5':'#F3F4F6',color: lastProject.status==='ACTIVE'?'#065F46':'#6B7280'}}>
                      {lastProject.status}
                    </span>
                    <span className="text-[11px] text-gray-400">{relativeTime(lastProject.updatedAt)}</span>
                  </div>
                  <h3 className="font-bold text-gray-900 text-base leading-tight truncate">{lastProject.title}</h3>
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                    <Youtube className="w-3.5 h-3.5" />
                    {lastProject.channel.title}
                  </p>
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><Video className="w-3 h-3" /> {lastProject._count.videos} videos</span>
                    <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {lastProject._count.jobs} AI jobs</span>
                  </div>
                </div>
                <div className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center" style={{background:'linear-gradient(135deg,#EDE9FE,#DDD6FE)'}}>
                  <FolderOpen className="w-6 h-6" style={{color:'#7C3AED'}} />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs font-semibold text-purple-600 flex items-center gap-1 group-hover:gap-2 transition-all">
                  Open project <ArrowRight className="w-3 h-3" />
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); openCopilotWithPrompt(`Continue working on ${lastProject.title}`); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-purple-600 hover:bg-purple-50 transition-colors"
                >
                  <Bot className="w-3 h-3" /> Ask AI
                </button>
              </div>
            </Link>
          ) : (
            <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center">
              <LayoutDashboard className="w-10 h-10 mx-auto mb-3 text-gray-200" />
              <p className="text-sm text-gray-500 mb-4">No projects yet.</p>
              <button
                type="button"
                onClick={() => openCopilotWithPrompt('Create a new YouTube video project')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{background:'linear-gradient(135deg,#a78bfa,#7C3AED)'}}
              >
                <Bot className="w-4 h-4" /> Ask AI to start
              </button>
            </div>
          )}

          {/* Recent projects list */}
          {recentProjects.length > 1 && (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-50">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Recent Projects</span>
                <Link href="/projects" className="text-xs text-purple-600 hover:underline font-medium">View all</Link>
              </div>
              <div className="divide-y divide-gray-50">
                {recentProjects.slice(1).map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-gray-900 text-sm truncate">{p.title}</span>
                      <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        <Youtube className="w-3 h-3" /> {p.channel.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <span className="text-[11px] text-gray-400">{relativeTime(p.updatedAt)}</span>
                      <span className="w-2 h-2 rounded-full" style={{background: STATUS_COLOR[p.status] ?? '#8B8FA8'}} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: onboarding + quick actions */}
        <div className="lg:col-span-2 flex flex-col gap-3">

          {/* Onboarding checklist */}
          {!onboardingDone && (
            allComplete ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-500 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-green-800 text-sm">You&apos;re all set!</p>
                  <p className="text-green-700 text-xs mt-0.5">All setup steps complete.</p>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-bold text-gray-900 text-sm">Getting Started</h2>
                    <p className="text-xs text-gray-400">{completedCount} of 4 complete</p>
                  </div>
                  <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{width:`${(completedCount/4)*100}%`,background:'linear-gradient(90deg,#a78bfa,#7C3AED)'}} />
                  </div>
                </div>
                <div className="space-y-1">
                  {steps.map((step) => (
                    <Link key={step.label} href={step.href} className={`flex items-center gap-2.5 p-2.5 rounded-xl transition-colors ${step.done?'opacity-50 cursor-default':'hover:bg-gray-50'}`}>
                      {step.done
                        ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                        : <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                      <span className={`text-xs flex-1 ${step.done?'line-through text-gray-400':'text-gray-700 font-medium'}`}>{step.label}</span>
                      {!step.done && <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
                    </Link>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Trial credits */}
          {showTrial && (
            <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4">
              <div className="flex items-center gap-2 mb-2">
                <Flame className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-gray-700">Trial Credits</span>
                {daysLeft !== null && daysLeft <= 7 && (
                  <span className="ml-auto text-xs text-red-500 font-medium">{daysLeft}d left</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${creditsPct>30?'bg-violet-500':'bg-amber-500'}`} style={{width:`${creditsPct}%`}} />
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {(trialStatus?.trialCreditsRemaining??0).toLocaleString()} credits
                </span>
              </div>
              <Link href="/wallet" className="mt-2 text-xs font-semibold text-violet-600 hover:underline flex items-center gap-1">
                Upgrade plan <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}

          {/* Quick actions */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Quick Actions</h2>
            <div className="space-y-2">
              {[
                { href: '/projects', icon: Plus, label: 'New Project', gradient: 'from-violet-500 to-purple-600' },
                { href: '/copilot', icon: Bot, label: 'Open Copilot', gradient: 'from-indigo-500 to-blue-600' },
                { href: '/autonomy', icon: Sparkles, label: 'AI Autonomy', gradient: 'from-pink-500 to-rose-500' },
                { href: '/scheduler', icon: CalendarClock, label: 'Schedule', gradient: 'from-blue-500 to-indigo-600' },
              ].map(({ href, icon: Icon, label, gradient }) => (
                <Link key={href} href={href} className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                  <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center shrink-0`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">{label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-300 ml-auto group-hover:text-gray-500 transition-colors" />
                </Link>
              ))}
            </div>
          </div>

          {/* Channel status */}
          {channels.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl px-5 py-4">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Connected Channels</h2>
              <div className="space-y-2">
                {channels.slice(0, 3).map((ch) => (
                  <div key={ch.id} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center">
                      <Youtube className="w-4 h-4 text-red-600" />
                    </div>
                    <span className="text-sm text-gray-800 font-medium truncate flex-1">{ch.title}</span>
                    {automation?.enabled && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">Auto</span>}
                  </div>
                ))}
              </div>
              {channels.length === 0 && (
                <Link href="/library?tab=channels" className="flex items-center gap-2 text-sm text-purple-600 font-medium hover:underline">
                  <Plus className="w-4 h-4" /> Connect a channel
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
