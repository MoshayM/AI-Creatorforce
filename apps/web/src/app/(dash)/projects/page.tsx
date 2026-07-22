'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  FolderOpen, Plus, Loader2, Video, Zap, PlayCircle,
  ChevronDown, ArrowRight, Bot, Clock, MoreVertical,
} from 'lucide-react';
import { api } from '@/lib/api';
import { StatCard } from '@/components/stat-card';

// ── Types ─────────────────────────────────────────────────────────────────────

type Platform = 'YOUTUBE' | 'INSTAGRAM' | 'LINKEDIN' | 'TIKTOK' | 'X' | 'THREADS' | 'FACEBOOK';
type ContentFormat = string; // platform-prefixed e.g. 'YT_VIDEO', 'IG_REEL', 'LI_ARTICLE'

interface Project {
  id: string;
  title: string;
  niche?: string;
  status: string;
  channel?: { title: string; thumbnailUrl?: string } | null;
  _count: { jobs: number; videos: number };
  updatedAt: string;
}

interface Channel { id: string; title: string; platform?: string; thumbnailUrl?: string; }

// ── Platform config ───────────────────────────────────────────────────────────

interface FormatDef { type: string; emoji: string; label: string; desc: string; }
interface PlatformDef {
  platform: Platform; label: string; emoji: string;
  color: string; bg: string; border: string; textColor: string;
  formats: FormatDef[];
}

const PLATFORMS: PlatformDef[] = [
  {
    platform: 'YOUTUBE', label: 'YouTube', emoji: '▶️',
    color: '#FF0000', bg: '#fff0f0', border: '#fecaca', textColor: '#b91c1c',
    formats: [
      { type: 'YT_VIDEO',   emoji: '🎬', label: 'Long Video',      desc: 'AI research, script, chapters & SEO publish' },
      { type: 'YT_SHORT',   emoji: '⚡', label: 'Short / Reel',    desc: 'Vertical <60s from scratch or clipped' },
      { type: 'YT_PODCAST', emoji: '🎙️', label: 'Podcast / Audio', desc: 'Video podcast or audio-first content' },
    ],
  },
  {
    platform: 'INSTAGRAM', label: 'Instagram', emoji: '📸',
    color: '#E1306C', bg: '#fff0f6', border: '#fbcfe8', textColor: '#be185d',
    formats: [
      { type: 'IG_REEL',  emoji: '🎞️', label: 'Reel',            desc: 'Short vertical video up to 90 s' },
      { type: 'IG_POST',  emoji: '🖼️', label: 'Post / Carousel', desc: 'Image or multi-image carousel' },
      { type: 'IG_STORY', emoji: '⭕', label: 'Story',           desc: '15 s disappearing content' },
    ],
  },
  {
    platform: 'LINKEDIN', label: 'LinkedIn', emoji: '💼',
    color: '#0A66C2', bg: '#eff6ff', border: '#bfdbfe', textColor: '#1d4ed8',
    formats: [
      { type: 'LI_ARTICLE', emoji: '📄', label: 'Article',      desc: 'Long-form thought leadership piece' },
      { type: 'LI_POST',    emoji: '✍️', label: 'Post',         desc: 'Text + optional image/video' },
      { type: 'LI_VIDEO',   emoji: '🎥', label: 'Native Video', desc: 'Short video direct upload' },
    ],
  },
  {
    platform: 'TIKTOK', label: 'TikTok', emoji: '🎵',
    color: '#000000', bg: '#f8f8f8', border: '#d1d5db', textColor: '#111827',
    formats: [
      { type: 'TT_VIDEO',  emoji: '🎵', label: 'TikTok Video', desc: 'Short-form vertical video' },
      { type: 'TT_SERIES', emoji: '📚', label: 'Series',       desc: 'Multi-part episodic content' },
    ],
  },
  {
    platform: 'X', label: 'X / Twitter', emoji: '𝕏',
    color: '#000000', bg: '#f9fafb', border: '#e5e7eb', textColor: '#111827',
    formats: [
      { type: 'X_THREAD', emoji: '🧵', label: 'Thread',     desc: 'Multi-post text thread' },
      { type: 'X_VIDEO',  emoji: '📹', label: 'Video Post', desc: 'Short video with caption' },
    ],
  },
  {
    platform: 'THREADS', label: 'Threads', emoji: '🧶',
    color: '#1a1a1a', bg: '#f9fafb', border: '#e5e7eb', textColor: '#111827',
    formats: [
      { type: 'TH_THREAD', emoji: '🧵', label: 'Thread',     desc: 'Multi-post text thread' },
      { type: 'TH_VIDEO',  emoji: '📹', label: 'Video Post', desc: 'Short video + caption' },
    ],
  },
  {
    platform: 'FACEBOOK', label: 'Facebook', emoji: '📘',
    color: '#1877F2', bg: '#eff6ff', border: '#bfdbfe', textColor: '#1d4ed8',
    formats: [
      { type: 'FB_VIDEO', emoji: '📺', label: 'Video', desc: 'Facebook native video' },
      { type: 'FB_REEL',  emoji: '⚡', label: 'Reel',  desc: 'Short vertical video' },
      { type: 'FB_POST',  emoji: '📝', label: 'Post',  desc: 'Text + image post' },
    ],
  },
];

const STATUS_STYLE: Record<string, { bg: string; color: string; dot: string }> = {
  ACTIVE:   { bg: '#ecfdf5', color: '#065f46', dot: '#10b981' },
  DRAFT:    { bg: '#f5f2fd', color: '#6D4AE0', dot: '#6D4AE0' },
  PAUSED:   { bg: '#fff7ed', color: '#c2410c', dot: '#f97316' },
  ARCHIVED: { bg: '#f3f4f6', color: '#4b5563', dot: '#9ca3af' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function platformFromChannel(ch: Channel): Platform {
  const p = (ch.platform ?? 'YOUTUBE').toUpperCase() as Platform;
  return PLATFORMS.find(d => d.platform === p) ? p : 'YOUTUBE';
}

function getProjectMeta(id: string): { platform: Platform; format: ContentFormat } {
  if (typeof window === 'undefined') return { platform: 'YOUTUBE', format: 'YT_VIDEO' };
  return {
    platform: (localStorage.getItem(`cf_platform_${id}`) as Platform | null) ?? 'YOUTUBE',
    format:   (localStorage.getItem(`cf_ct_${id}`) as string | null) ?? 'YT_VIDEO',
  };
}

function getCrossPosts(id: string): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(`cf_crosspost_${id}`) ?? '[]') as string[]; }
  catch { return []; }
}

function formatLabel(fmt: string): string {
  for (const pd of PLATFORMS) {
    const fd = pd.formats.find(f => f.type === fmt);
    if (fd) return fd.label;
  }
  return fmt;
}

function formatEmoji(fmt: string): string {
  for (const pd of PLATFORMS) {
    const fd = pd.formats.find(f => f.type === fmt);
    if (fd) return fd.emoji;
  }
  return '📁';
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

// ── Sub-components ────────────────────────────────────────────────────────────

function PlatformIcon({ platform, size = 16 }: { platform: Platform; size?: number }) {
  const cfg = PLATFORMS.find(d => d.platform === platform) ?? PLATFORMS[0]!;
  return (
    <span
      style={{
        width: size, height: size, borderRadius: size * 0.28,
        background: cfg.color, color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.55, fontWeight: 800, fontFamily: 'inherit', flexShrink: 0,
      }}
    >
      {cfg.emoji}
    </span>
  );
}

function ProjectSkeleton() {
  return (
    <div className="bg-white rounded-2xl p-5 animate-pulse" style={{ border: '1.5px solid #e3ddf8' }}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-11 h-11 rounded-2xl bg-gray-100 shrink-0" />
        <div className="flex-1 space-y-2 pt-0.5">
          <div className="h-4 bg-gray-100 rounded-xl w-3/4" />
          <div className="h-3 bg-gray-100 rounded-lg w-1/2" />
        </div>
        <div className="h-5 w-14 bg-gray-100 rounded-full shrink-0" />
      </div>
      <div className="h-px bg-gray-50 mb-3" />
      <div className="flex gap-4">
        <div className="h-3 bg-gray-100 rounded-lg w-20" />
        <div className="h-3 bg-gray-100 rounded-lg w-16" />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE['DRAFT']!;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
      {status}
    </span>
  );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

const inputCls = 'w-full bg-white rounded-2xl px-4 py-3 text-sm text-gray-800 outline-none transition-all focus:ring-2 focus:ring-[#6D4AE0]/20 focus:border-[#6D4AE0] placeholder:text-gray-400';
const inputStyle = { border: '1.5px solid #e3e0f0' };

// ── Three-dot card menu ───────────────────────────────────────────────────────

interface CardMenuProps {
  onRename: () => void;
  onDelete: () => void;
}

function CardMenu({ onRename, onDelete }: CardMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  return (
    <div ref={menuRef} className="relative" style={{ zIndex: 10 }}>
      <button
        type="button"
        aria-label="Project options"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-7 h-7 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-8 bg-white rounded-2xl py-1 min-w-[130px] shadow-xl"
          style={{ border: '1.5px solid #e3ddf8', zIndex: 20 }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onRename();
            }}
            className="w-full text-left px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-[#f5f2fd] hover:text-[#6D4AE0] transition-colors"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
            className="w-full text-left px-4 py-2 text-sm font-semibold transition-colors"
            style={{ color: '#dc2626' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fef2f2'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ── Rename modal ──────────────────────────────────────────────────────────────

interface RenameModalProps {
  project: Project;
  onClose: () => void;
  onSuccess: () => void;
}

function RenameModal({ project, onClose, onSuccess }: RenameModalProps) {
  const [title, setTitle] = useState(project.title);

  const renameMutation = useMutation({
    mutationFn: () => api.projects.update(project.id, { title }),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  const unchanged = title.trim() === project.title.trim();
  const disabled = !title.trim() || unchanged || renameMutation.isPending;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,10,40,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden"
        style={{ border: '1.5px solid #e3ddf8' }}
      >
        <div
          className="px-7 py-5 flex items-center justify-between"
          style={{ borderBottom: '1.5px solid #f0edf9' }}
        >
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">Rename project</h2>
            <p className="text-xs text-gray-400 mt-0.5">Update the title for this project</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-7 py-6">
          <Field label="Project title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) renameMutation.mutate(); }}
              className={inputCls}
              style={inputStyle}
              placeholder="Enter a title…"
            />
          </Field>
        </div>

        <div
          className="px-7 py-5 flex items-center justify-between gap-3"
          style={{ borderTop: '1.5px solid #f0edf9' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-2xl text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => renameMutation.mutate()}
            disabled={disabled}
            className="flex items-center gap-2 px-6 py-2.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
              boxShadow: '0 4px 16px rgba(109,74,224,0.30)',
            }}
          >
            {renameMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {renameMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────

interface DeleteModalProps {
  project: Project;
  onClose: () => void;
  onSuccess: () => void;
}

function DeleteModal({ project, onClose, onSuccess }: DeleteModalProps) {
  const deleteMutation = useMutation({
    mutationFn: () => api.projects.delete(project.id),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,10,40,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden"
        style={{ border: '1.5px solid #e3ddf8' }}
      >
        <div
          className="px-7 py-5 flex items-center justify-between"
          style={{ borderBottom: '1.5px solid #f0edf9' }}
        >
          <h2 className="text-lg font-extrabold text-gray-900">Delete this project?</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-7 py-6 space-y-3">
          <p className="text-sm font-semibold text-gray-800">
            You are about to delete <span className="font-extrabold">&ldquo;{project.title}&rdquo;</span>.
          </p>
          <div
            className="rounded-2xl px-4 py-3 text-sm font-semibold"
            style={{ background: '#fef2f2', color: '#dc2626', border: '1.5px solid #fecaca' }}
          >
            This cannot be undone. All jobs and videos in this project will be removed.
          </div>
        </div>

        <div
          className="px-7 py-5 flex items-center justify-between gap-3"
          style={{ borderTop: '1.5px solid #f0edf9' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-2xl text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
              boxShadow: '0 4px 16px rgba(220,38,38,0.30)',
            }}
          >
            {deleteMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({
    platform: 'YOUTUBE' as Platform,
    contentFormat: 'YT_VIDEO' as ContentFormat,
    primaryChannelId: '',
    crossPostChannelIds: [] as string[],
    title: '',
    niche: '',
    goal: '',
  });

  // rename / delete modal state
  const [renameProject, setRenameProject] = useState<Project | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.projects.list().then((r) => (r.data as { data: Project[] }).data),
  });

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['channels'],
    queryFn: () => api.channels.list().then((r) => r.data as Channel[]),
  });

  function closeCreate() {
    setShowCreate(false);
    setCreateStep(1);
    setCreateError(null);
    setForm({
      platform: 'YOUTUBE',
      contentFormat: 'YT_VIDEO',
      primaryChannelId: '',
      crossPostChannelIds: [],
      title: '',
      niche: '',
      goal: '',
    });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.projects.create({
        channelId: form.primaryChannelId || undefined,
        title: form.title,
        niche: form.niche || undefined,
        contentFormat: form.contentFormat,
        platforms: [
          form.platform,
          ...form.crossPostChannelIds
            .map(id => channels.find(c => c.id === id))
            .filter((c): c is Channel => Boolean(c))
            .map(c => platformFromChannel(c))
            .filter((p, i, a) => a.indexOf(p) === i),
        ],
      }),
    onSuccess: (res) => {
      const newId: string = (res.data as { id: string }).id;
      localStorage.setItem(`cf_ct_${newId}`, form.contentFormat);
      localStorage.setItem(`cf_platform_${newId}`, form.platform);
      if (form.crossPostChannelIds.length > 0) {
        localStorage.setItem(`cf_crosspost_${newId}`, JSON.stringify(form.crossPostChannelIds));
      }
      void qc.invalidateQueries({ queryKey: ['projects'] });
      router.push(`/projects/${newId}`);
      closeCreate();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setCreateError(typeof msg === 'string' ? msg : 'Failed to create project. Please try again.');
    },
  });

  function invalidateProjects() {
    void qc.invalidateQueries({ queryKey: ['projects'] });
  }

  const activeCount = projects.filter((p) => p.status === 'ACTIVE').length;
  const totalJobs   = projects.reduce((s, p) => s + p._count.jobs, 0);
  const totalVideos = projects.reduce((s, p) => s + p._count.videos, 0);

  const selPlatform = PLATFORMS.find(d => d.platform === form.platform) ?? PLATFORMS[0]!;
  const platformChannels = channels.filter(ch => platformFromChannel(ch) === form.platform);
  const otherChannels = channels.filter(ch => ch.id !== form.primaryChannelId);

  const titlePlaceholder =
    selPlatform.platform === 'YOUTUBE'   ? 'e.g. How to Start Investing in 2025' :
    selPlatform.platform === 'INSTAGRAM' ? 'e.g. Morning Routine – 5 Habits That Changed My Life' :
    selPlatform.platform === 'LINKEDIN'  ? 'e.g. Why Remote Work Changed My Leadership Style' :
    'e.g. My content campaign title';

  return (
    <div className="min-h-full bg-[#faf9ff]">
      <div className="p-5 lg:p-7 max-w-5xl mx-auto space-y-5">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Projects</h1>
            <p className="text-sm text-gray-400 mt-0.5">Manage your content campaigns</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
              boxShadow: '0 4px 20px rgba(109,74,224,0.35)',
            }}
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>

        {/* ── Stats row ────────────────────────────────────────────────── */}
        {(projects.length > 0 || isLoading) && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard tone="lilac"      icon={<FolderOpen className="w-5 h-5" />}  label="Projects"    value={projects.length} />
            <StatCard tone="periwinkle" icon={<PlayCircle className="w-5 h-5" />}  label="Active"      value={activeCount} sub="in production" />
            <StatCard tone="cream"      icon={<Zap className="w-5 h-5" />}          label="Agent Jobs"  value={totalJobs} sub="across all projects" />
            <StatCard tone="pink"       icon={<Video className="w-5 h-5" />}        label="Videos"      value={totalVideos} />
          </div>
        )}

        {/* ── Project grid ─────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => <ProjectSkeleton key={i} />)}
          </div>
        ) : projects.length === 0 ? (
          /* ── Empty state ─────────────────────────────────────────────── */
          <div
            className="rounded-3xl flex flex-col items-center justify-center py-20 px-6 text-center"
            style={{ background: 'white', border: '1.5px solid #e3ddf8' }}
          >
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6"
              style={{ background: 'linear-gradient(135deg, #f0edf9, #e3ddf8)' }}
            >
              🎬
            </div>
            <h2 className="text-xl font-extrabold text-gray-900 mb-2">No projects yet</h2>
            <p className="text-gray-400 text-sm max-w-xs mb-8 leading-relaxed">
              Create your first content campaign — YouTube videos, Instagram Reels, LinkedIn articles, TikTok videos, and more. Publish to any connected account.
            </p>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
                boxShadow: '0 4px 20px rgba(109,74,224,0.30)',
              }}
            >
              <Plus className="w-4 h-4" /> Create first project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((p) => {
              const { platform, format } = getProjectMeta(p.id);
              const pdCfg = PLATFORMS.find(d => d.platform === platform) ?? PLATFORMS[0]!;
              const crossPosts = getCrossPosts(p.id);
              return (
                <div key={p.id} className="relative group">
                  <Link
                    href={`/projects/${p.id}`}
                    className="block bg-white rounded-2xl p-5 transition-all hover:border-[#6D4AE0]/40 hover:shadow-lg hover:-translate-y-0.5"
                    style={{ border: '1.5px solid #e3ddf8' }}
                  >
                    {/* Top row — pr-10 reserves space for the floating ⋮ button */}
                    <div className="flex items-start gap-3 mb-4 pr-10">
                      <div
                        className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0"
                        style={{ background: pdCfg.bg }}
                      >
                        {formatEmoji(format)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-extrabold text-gray-900 text-sm leading-tight truncate mb-1">
                          {p.title}
                        </h3>
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                          <PlatformIcon platform={platform} size={14} />
                          {p.channel?.title ? (
                            <span className="truncate">{p.channel.title}</span>
                          ) : (
                            <span className="truncate italic" style={{ color: '#f59e0b' }}>No account linked</span>
                          )}
                          {crossPosts.length > 0 && (
                            <span className="flex items-center gap-1 ml-1">
                              <span className="text-[10px] text-gray-300 mx-0.5">+</span>
                              {crossPosts.slice(0, 3).map((cpId, i) => {
                                const cpCh = channels.find(c => c.id === cpId);
                                const cpPlatform = cpCh ? platformFromChannel(cpCh) : 'YOUTUBE';
                                return <PlatformIcon key={i} platform={cpPlatform} size={12} />;
                              })}
                              {crossPosts.length > 3 && (
                                <span className="text-[10px] text-gray-400">+{crossPosts.length - 3}</span>
                              )}
                            </span>
                          )}
                          {p.niche && <><span>·</span><span className="truncate">{p.niche}</span></>}
                        </div>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>

                    {/* Divider */}
                    <div className="h-px mb-3" style={{ background: '#f5f2fd' }} />

                    {/* Bottom row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: pdCfg.bg, color: pdCfg.textColor }}
                        >
                          {formatEmoji(format)} {formatLabel(format)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Zap className="w-3 h-3" /> {p._count.jobs} jobs
                        </span>
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Video className="w-3 h-3" /> {p._count.videos}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                        <Clock className="w-3 h-3" />
                        {relativeTime(p.updatedAt)}
                        <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-[#6D4AE0] transition-colors ml-1" />
                      </div>
                    </div>
                  </Link>

                  {/* Three-dot menu — floats above the card link */}
                  <div className="absolute top-3 right-3" style={{ zIndex: 10 }}>
                    <CardMenu
                      onRename={() => setRenameProject(p)}
                      onDelete={() => setDeleteProject(p)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create project modal ──────────────────────────────────────────── */}
      {showCreate && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,10,40,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeCreate(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') closeCreate(); }}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden"
            style={{ border: '1.5px solid #e3ddf8' }}
          >
            {/* Modal header */}
            <div
              className="px-7 py-5 flex items-start justify-between gap-4"
              style={{ borderBottom: '1.5px solid #f0edf9' }}
            >
              <div className="space-y-2.5">
                <h2 className="text-lg font-extrabold text-gray-900">New Project</h2>
                {/* Step indicator */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {[{ n: 1, label: 'Platform & Format' }, { n: 2, label: 'Accounts & Details' }].map(({ n, label }) => (
                    <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800,
                        background: createStep >= n ? '#6D4AE0' : '#e5e7eb',
                        color: createStep >= n ? '#fff' : '#9ca3af',
                      }}>{n}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: createStep === n ? '#6D4AE0' : '#9ca3af' }}>{label}</span>
                      {n < 2 && <span style={{ width: 24, height: 2, background: '#e5e7eb', borderRadius: 2 }} />}
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={closeCreate}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors text-lg leading-none shrink-0"
              >
                ×
              </button>
            </div>

            {/* ── Step 1: Platform & Format ── */}
            {createStep === 1 && (
              <>
                <div className="px-7 py-6 space-y-5 max-h-[60vh] overflow-y-auto">
                  {/* Platform grid */}
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-3">Platform</p>
                    <div className="grid grid-cols-4 gap-3">
                      {PLATFORMS.map((pd) => (
                        <button
                          key={pd.platform}
                          type="button"
                          onClick={() => {
                            setForm(f => ({
                              ...f,
                              platform: pd.platform,
                              contentFormat: pd.formats[0]!.type,
                              primaryChannelId: '',
                              crossPostChannelIds: [],
                            }));
                          }}
                          style={form.platform === pd.platform
                            ? { background: pd.bg, border: `2px solid ${pd.color}` }
                            : { background: '#faf9ff', border: '1.5px solid #e3ddf8' }}
                          className="flex flex-col items-center gap-1.5 py-4 px-2 rounded-2xl text-center transition-all hover:border-gray-300"
                        >
                          <span style={{ fontSize: 22 }}>{pd.emoji}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: form.platform === pd.platform ? pd.textColor : '#374151' }}>{pd.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Format grid */}
                  <div>
                    <p className="text-xs font-semibold text-gray-600 mb-3">Content format</p>
                    <div className="grid grid-cols-3 gap-3">
                      {selPlatform.formats.map(fd => (
                        <button
                          key={fd.type}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, contentFormat: fd.type }))}
                          style={form.contentFormat === fd.type
                            ? { background: selPlatform.bg, border: `2px solid ${selPlatform.color}` }
                            : { background: '#faf9ff', border: '1.5px solid #e3ddf8' }}
                          className="flex flex-col items-start gap-1 p-3.5 rounded-2xl text-left transition-all"
                        >
                          <span style={{ fontSize: 18 }}>{fd.emoji}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: form.contentFormat === fd.type ? selPlatform.textColor : '#374151' }}>{fd.label}</span>
                          <span style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.35 }}>{fd.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Step 1 footer */}
                <div
                  className="px-7 py-5 flex items-center justify-between gap-3"
                  style={{ borderTop: '1.5px solid #f0edf9' }}
                >
                  <button
                    type="button"
                    onClick={closeCreate}
                    className="px-5 py-2.5 rounded-2xl text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateStep(2)}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                    style={{
                      background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
                      boxShadow: '0 4px 16px rgba(109,74,224,0.30)',
                    }}
                  >
                    Next →
                  </button>
                </div>
              </>
            )}

            {/* ── Step 2: Accounts & Details ── */}
            {createStep === 2 && (
              <>
                <div className="px-7 py-6 space-y-5 max-h-[60vh] overflow-y-auto">
                  {/* Primary account */}
                  <Field
                    label={
                      <span className="flex items-center gap-2">
                        Primary account
                        <span
                          className="text-xs font-medium rounded-full px-2 py-0.5"
                          style={{ background: '#ede9fe', color: '#6D4AE0' }}
                        >
                          Optional
                        </span>
                      </span>
                    }
                    hint={`Optimizes content for ${selPlatform.label}. You can connect an account now or publish later.`}
                  >
                    {platformChannels.length === 0 ? (
                      <div
                        className="rounded-2xl px-4 py-3 text-sm"
                        style={{ background: '#f5f2fd', border: '1.5px solid #d4c9f9' }}
                      >
                        <p className="font-semibold mb-1" style={{ color: '#4c1d95' }}>
                          ℹ No accounts connected yet
                        </p>
                        <p style={{ color: '#6b7280' }}>
                          You don&apos;t need to connect any account now. Create your content first. You can connect YouTube, Facebook, Instagram, TikTok or any platform whenever you&apos;re ready to publish.
                        </p>
                        <p className="mt-2">
                          <Link
                            href="/library?tab=channels"
                            className="text-[#6D4AE0] font-semibold hover:underline"
                            onClick={closeCreate}
                          >
                            Connect Account →
                          </Link>
                          {' '}
                          <span style={{ color: '#9ca3af', fontSize: 12 }}>(optional)</span>
                        </p>
                      </div>
                    ) : (
                      <div className="relative">
                        <select
                          aria-label="Primary account"
                          value={form.primaryChannelId}
                          onChange={(e) => setForm(f => ({ ...f, primaryChannelId: e.target.value }))}
                          className={`${inputCls} pr-10 appearance-none cursor-pointer`}
                          style={inputStyle}
                        >
                          <option value="">Select a {selPlatform.label} account…</option>
                          {platformChannels.map(ch => (
                            <option key={ch.id} value={ch.id}>{ch.title}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                    )}
                  </Field>

                  {/* Cross-post */}
                  <Field
                    label="Cross-post to (optional)"
                    hint="Also publish this content to other connected accounts."
                  >
                    {otherChannels.length === 0 ? (
                      <p style={{ fontSize: 12, color: '#9ca3af' }}>
                        No other accounts connected yet.{' '}
                        <Link href="/library?tab=channels" className="text-[#6D4AE0] font-semibold hover:underline" onClick={closeCreate}>
                          Connect accounts →
                        </Link>
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2 mt-1">
                        {otherChannels.map(ch => {
                          const chPlatform = platformFromChannel(ch);
                          const chPd = PLATFORMS.find(d => d.platform === chPlatform) ?? PLATFORMS[0]!;
                          const isSel = form.crossPostChannelIds.includes(ch.id);
                          return (
                            <button
                              key={ch.id}
                              type="button"
                              onClick={() => setForm(f => ({
                                ...f,
                                crossPostChannelIds: isSel
                                  ? f.crossPostChannelIds.filter(id => id !== ch.id)
                                  : [...f.crossPostChannelIds, ch.id],
                              }))}
                              style={isSel
                                ? { background: chPd.bg, border: `1.5px solid ${chPd.color}`, color: chPd.textColor }
                                : { background: '#f9fafb', border: '1.5px solid #e5e7eb', color: '#374151' }}
                              className="flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-semibold transition-all"
                            >
                              <PlatformIcon platform={chPlatform} size={14} />
                              <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title}</span>
                              {isSel && <span style={{ fontSize: 10, marginLeft: 2 }}>✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </Field>

                  {/* Project title */}
                  <Field label="Project title">
                    <input
                      placeholder={titlePlaceholder}
                      value={form.title}
                      onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                      className={inputCls}
                      style={inputStyle}
                    />
                  </Field>

                  {/* Niche */}
                  <Field
                    label="Niche / Topic"
                    hint="Helps AI tune research & script for your audience"
                  >
                    <input
                      placeholder="Optional — e.g. Personal Finance, Tech, Wellness"
                      value={form.niche}
                      onChange={(e) => setForm(f => ({ ...f, niche: e.target.value }))}
                      className={inputCls}
                      style={inputStyle}
                    />
                  </Field>

                  {/* Goal */}
                  <Field label="Goal / Brief">
                    <textarea
                      placeholder="Optional — describe the goal, angle, or target audience for this project"
                      value={form.goal}
                      onChange={(e) => setForm(f => ({ ...f, goal: e.target.value }))}
                      rows={2}
                      className={inputCls}
                      style={{ ...inputStyle, resize: 'none' }}
                    />
                  </Field>
                </div>

                {/* Step 2 footer */}
                {createError && (
                  <p className="px-7 pb-2 text-sm text-red-600">{createError}</p>
                )}
                <div
                  className="px-7 py-5 flex items-center justify-between gap-3"
                  style={{ borderTop: '1.5px solid #f0edf9' }}
                >
                  <button
                    type="button"
                    onClick={() => setCreateStep(1)}
                    className="px-5 py-2.5 rounded-2xl text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={() => createMutation.mutate()}
                    disabled={!form.title || createMutation.isPending}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                    style={{
                      background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)',
                      boxShadow: '0 4px 16px rgba(109,74,224,0.30)',
                    }}
                  >
                    {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {createMutation.isPending ? 'Creating…' : 'Create project'}
                    {!createMutation.isPending && <Bot className="w-4 h-4 opacity-70" />}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Rename modal ──────────────────────────────────────────────────── */}
      {renameProject && (
        <RenameModal
          project={renameProject}
          onClose={() => setRenameProject(null)}
          onSuccess={invalidateProjects}
        />
      )}

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
      {deleteProject && (
        <DeleteModal
          project={deleteProject}
          onClose={() => setDeleteProject(null)}
          onSuccess={invalidateProjects}
        />
      )}
    </div>
  );
}
