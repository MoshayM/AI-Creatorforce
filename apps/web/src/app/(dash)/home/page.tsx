'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  FolderOpen, Video, Zap, Youtube, ArrowRight, Plus, Sparkles, CalendarClock,
  CheckCircle2, Circle, ChevronRight, Bot, Mic2, MessageSquare, TrendingUp,
  Clock, Activity, PlayCircle, FileText, Music2, Image as ImageIcon, Film,
  LayoutDashboard, Flame, Scissors,
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
  RESEARCH:       BookOpenIcon,
  SCRIPT:         FileText,
  VOICE_GENERATE: Mic2,
  MUSIC_GENERATE: Music2,
  IMAGE_GENERATE: ImageIcon,
  VIDEO_GENERATE: Film,
  RENDER:         PlayCircle,
  THUMBNAIL:      ImageIcon,
};

function BookOpenIcon(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...p}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
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
  { label: 'New YouTube video', icon: PlayCircle,  prompt: 'Create a new YouTube video' },
  { label: 'Create Shorts',     icon: Scissors,    prompt: 'Create YouTube Shorts from an existing video' },
  { label: 'Research a topic',  icon: TrendingUp,  prompt: 'Research a topic for my next video' },
  { label: 'Write a script',    icon: FileText,    prompt: 'Write a script for my next video' },
];

const QUICK_ACTIONS = [
  { href: '/projects',   icon: Plus,          label: 'New Project',  sub: 'Start from scratch',          tileBg: '#6D4AE0' },
  { href: '/copilot',    icon: Bot,           label: 'AI Copilot',   sub: 'Chat with your AI crew',      tileBg: '#7c5ae8' },
  { href: '/autonomy',   icon: Sparkles,      label: 'AI Autonomy',  sub: 'Auto-generate content',       tileBg: '#ec4899' },
  { href: '/scheduler',  icon: CalendarClock, label: 'Schedule',     sub: 'Plan publish calendar',       tileBg: '#0891b2' },
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

// ── Section heading ───────────────────────────────────────────────────────────
function SectionLabel({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1.5 mb-3">
      <Icon className="w-3.5 h-3.5" />
      {children}
    </h2>
  );
}

// ── Auth-style card wrapper ───────────────────────────────────────────────────
function Card({ children, className = '', href }: { children: React.ReactNode; className?: string; href?: string }) {
  const cls = `bg-white rounded-2xl p-5 ${className}`;
  const style = { border: '1.5px solid #e3ddf8' };
  if (href) {
    return (
      <Link href={href} className={`block ${cls} hover:border-[#6D4AE0]/40 hover:shadow-md transition-all`} style={style}>
        {children}
      </Link>
    );
  }
  return <div className={cls} style={style}>{children}</div>;
}

// ── Page ──────────────────────────────────────────────────────────────────────
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
    { label: 'Connect a YouTube channel',     done: channels.length > 0,       href: '/library?tab=channels' },
    { label: 'Create your first project',      done: projects.length > 0,       href: '/projects' },
    { label: 'Enable AI automation',           done: automation?.enabled === true, href: '/automation' },
    { label: 'Generate your first AI content', done: totalJobs > 0,             href: '/autonomy' },
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
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">

        {/* ── AI GREETING BANNER ─────────────────────────────────────────── */}
        <div
          className="rounded-3xl overflow-hidden relative"
          style={{ background: 'linear-gradient(145deg, #4f2ec4 0%, #6D4AE0 55%, #7c5ae8 100%)' }}
        >
          {/* Ambient orbs */}
          <div aria-hidden className="absolute -top-16 -right-16 w-64 h-64 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.07)', filter: 'blur(50px)' }} />
          <div aria-hidden className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full pointer-events-none" style={{ background: 'rgba(160,120,255,0.25)', filter: 'blur(40px)' }} />

          <div className="relative px-6 sm:px-8 py-7">
            {/* Top row */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)' }}
                >
                  <Bot className="w-5 h-5 text-purple-200" />
                </div>
                <div>
                  <p className="text-white/55 text-sm font-medium leading-none mb-0.5">{greet(displayName)}</p>
                  <h1 className="text-white font-extrabold text-xl leading-tight">
                    What would you like to create today?
                  </h1>
                </div>
              </div>

              {/* Short Studio badge */}
              <div
                className="hidden sm:flex items-center gap-2 shrink-0 px-3.5 py-2 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.15)' }}
              >
                <span className="text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full" style={{ background: '#f0c14d', color: '#3b1f00' }}>NEW</span>
                <span className="text-white/80 text-xs font-semibold">✂️ Short Studio</span>
              </div>
            </div>

            {/* Prompt input */}
            <div
              className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-4 max-w-2xl"
              style={{ background: 'rgba(255,255,255,0.10)', border: '1.5px solid rgba(255,255,255,0.15)' }}
            >
              <MessageSquare className="w-4 h-4 text-purple-300 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Describe what you want to create…"
                className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/40"
                style={{ fontFamily: 'inherit' }}
                onKeyDown={(e) => {
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
                className="shrink-0 px-4 py-1.5 rounded-xl text-xs font-bold transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #f0c14d, #f5a623)', color: '#3b1f00' }}
              >
                Ask AI
              </button>
              <button
                type="button"
                title="Voice mode"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('cf:open-copilot'));
                  setTimeout(() => document.querySelector<HTMLButtonElement>('button[title="Start listening"]')?.click(), 500);
                }}
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all hover:scale-110"
                style={{ background: 'rgba(255,255,255,0.15)', color: '#c4b5fd' }}
              >
                <Mic2 className="w-4 h-4" />
              </button>
            </div>

            {/* Quick suggestion chips */}
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map(({ label, icon: Icon, prompt }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => openCopilotWithPrompt(prompt)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white/80 transition-all hover:text-white"
                  style={{ background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.13)' }}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── STATS ROW ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard tone="lilac"      icon={<FolderOpen className="w-5 h-5" />} label="Channels"        value={channels.length} />
          <StatCard tone="cream"      icon={<Zap className="w-5 h-5" />}        label="Active Projects"  value={activeProjects.length} sub={`of ${projects.length} total`} />
          <StatCard tone="periwinkle" icon={<Video className="w-5 h-5" />}      label="Videos"           value={totalVideos} />
          <StatCard tone="pink"       icon={<Activity className="w-5 h-5" />}   label="AI Jobs"          value={totalJobs} sub="across all projects" />
        </div>

        {/* ── MAIN GRID ──────────────────────────────────────────────────── */}
        <div className="grid lg:grid-cols-5 gap-5">

          {/* ── LEFT: Continue + Recent ──────────────────────────────────── */}
          <div className="lg:col-span-3 space-y-4">
            <SectionLabel icon={Clock}>Continue</SectionLabel>

            {/* Last project card */}
            {lastProject ? (
              <Card href={`/projects/${lastProject.id}`} className="group !p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                        style={{
                          background: lastProject.status === 'ACTIVE' ? '#ecfdf5' : '#f5f2fd',
                          color: lastProject.status === 'ACTIVE' ? '#065f46' : '#6D4AE0',
                        }}
                      >
                        {lastProject.status}
                      </span>
                      <span className="text-[11px] text-gray-400">{relativeTime(lastProject.updatedAt)}</span>
                    </div>
                    <h3 className="font-extrabold text-gray-900 text-base leading-tight truncate">{lastProject.title}</h3>
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <Youtube className="w-3.5 h-3.5 text-red-500" />
                      {lastProject.channel.title}
                    </p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><Video className="w-3 h-3" /> {lastProject._count.videos} videos</span>
                      <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {lastProject._count.jobs} AI jobs</span>
                    </div>
                  </div>
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                    style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}
                  >
                    <FolderOpen className="w-6 h-6" style={{ color: '#6D4AE0' }} />
                  </div>
                </div>
                <div className="mt-4 pt-3 flex items-center gap-2" style={{ borderTop: '1.5px solid #f0edf9' }}>
                  <span className="text-xs font-bold text-[#6D4AE0] flex items-center gap-1 group-hover:gap-2 transition-all">
                    Open project <ArrowRight className="w-3 h-3" />
                  </span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); openCopilotWithPrompt(`Continue working on ${lastProject.title}`); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors hover:bg-[#f5f2fd]"
                    style={{ color: '#6D4AE0' }}
                  >
                    <Bot className="w-3 h-3" /> Ask AI
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="text-center !py-8">
                <LayoutDashboard className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                <p className="text-sm text-gray-500 mb-4">No projects yet — let AI start your first one.</p>
                <button
                  type="button"
                  onClick={() => openCopilotWithPrompt('Create a new YouTube video project')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.99]"
                  style={{ background: 'linear-gradient(135deg, #6D4AE0, #7c5ae8)', boxShadow: '0 4px 16px rgba(109,74,224,0.30)' }}
                >
                  <Bot className="w-4 h-4" /> Ask AI to start
                </button>
              </Card>
            )}

            {/* Recent projects list */}
            {recentProjects.length > 1 && (
              <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1.5px solid #e3ddf8' }}>
                <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1.5px solid #f0edf9' }}>
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Recent Projects</span>
                  <Link href="/projects" className="text-xs font-semibold hover:underline" style={{ color: '#6D4AE0' }}>View all</Link>
                </div>
                <div className="divide-y" style={{ '--tw-divide-opacity': 1 } as React.CSSProperties}>
                  {recentProjects.slice(1).map((p) => (
                    <Link
                      key={p.id}
                      href={`/projects/${p.id}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-[#faf9ff] transition-colors"
                      style={{ borderBottom: '1px solid #f5f2fd' }}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="font-semibold text-gray-900 text-sm truncate">{p.title}</span>
                        <span className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                          <Youtube className="w-3 h-3 text-red-400" /> {p.channel.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <span className="text-[11px] text-gray-400">{relativeTime(p.updatedAt)}</span>
                        <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[p.status] ?? '#8B8FA8' }} />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── RIGHT: Onboarding + Actions + Channels ───────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Onboarding checklist */}
            {!onboardingDone && (
              allComplete ? (
                <div
                  className="rounded-2xl px-5 py-4 flex items-center gap-3"
                  style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0' }}
                >
                  <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
                  <div>
                    <p className="font-bold text-green-800 text-sm">You&apos;re all set!</p>
                    <p className="text-green-600 text-xs mt-0.5">All setup steps complete.</p>
                  </div>
                </div>
              ) : (
                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="font-extrabold text-gray-900 text-sm">Getting Started</h2>
                      <p className="text-xs text-gray-400 mt-0.5">{completedCount} of {steps.length} complete</p>
                    </div>
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${(completedCount / steps.length) * 100}%`, background: 'linear-gradient(90deg, #6D4AE0, #7c5ae8)' }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    {steps.map((step, i) => (
                      <Link
                        key={step.label}
                        href={step.href}
                        className={`flex items-center gap-3 p-2.5 rounded-xl transition-colors ${step.done ? 'opacity-50 pointer-events-none' : 'hover:bg-[#faf9ff]'}`}
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0"
                          style={step.done
                            ? { background: '#10b981', color: '#fff' }
                            : { background: '#f0edf9', color: '#6D4AE0', border: '1.5px solid #e3ddf8' }}
                        >
                          {step.done ? '✓' : i + 1}
                        </div>
                        <span className={`text-xs flex-1 font-medium ${step.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                          {step.label}
                        </span>
                        {!step.done && <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
                      </Link>
                    ))}
                  </div>
                </Card>
              )
            )}

            {/* Trial credits */}
            {showTrial && (
              <Card>
                <div className="flex items-center gap-2 mb-2">
                  <Flame className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-bold text-gray-700">Trial Credits</span>
                  {daysLeft !== null && daysLeft <= 7 && (
                    <span className="ml-auto text-xs text-red-500 font-semibold">{daysLeft}d left</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${creditsPct}%`, background: creditsPct > 30 ? '#6D4AE0' : '#f59e0b' }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap tabular-nums">
                    {(trialStatus?.trialCreditsRemaining ?? 0).toLocaleString()} credits
                  </span>
                </div>
                <Link href="/wallet" className="text-xs font-bold flex items-center gap-1 hover:underline" style={{ color: '#6D4AE0' }}>
                  Upgrade plan <ArrowRight className="w-3 h-3" />
                </Link>
              </Card>
            )}

            {/* Quick actions */}
            <Card>
              <SectionLabel icon={Sparkles}>Quick Actions</SectionLabel>
              <div className="space-y-2">
                {QUICK_ACTIONS.map(({ href, icon: Icon, label, sub, tileBg }) => (
                  <Link
                    key={href}
                    href={href}
                    className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#faf9ff] transition-colors"
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: tileBg }}
                    >
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800 leading-none mb-0.5">{label}</p>
                      <p className="text-[11px] text-gray-400">{sub}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-[#6D4AE0] transition-colors shrink-0" />
                  </Link>
                ))}
              </div>
            </Card>

            {/* Connected channels */}
            {channels.length > 0 && (
              <Card>
                <SectionLabel icon={Youtube}>Connected Channels</SectionLabel>
                <div className="space-y-2.5">
                  {channels.slice(0, 3).map((ch) => (
                    <div key={ch.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                        <Youtube className="w-4 h-4 text-red-500" />
                      </div>
                      <span className="text-sm text-gray-800 font-semibold truncate flex-1">{ch.title}</span>
                      {automation?.enabled && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 shrink-0">Auto</span>
                      )}
                    </div>
                  ))}
                  {channels.length === 0 && (
                    <Link
                      href="/library?tab=channels"
                      className="flex items-center gap-2 text-sm font-semibold hover:underline"
                      style={{ color: '#6D4AE0' }}
                    >
                      <Plus className="w-4 h-4" /> Connect a channel
                    </Link>
                  )}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
