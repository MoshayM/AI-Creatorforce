'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  FolderOpen, Plus, Loader2, Youtube, Video, Zap, PlayCircle,
  ChevronDown, ArrowRight, Bot, Clock,
} from 'lucide-react';
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

interface Channel { id: string; title: string; }

// ── Content type config ───────────────────────────────────────────────────────

const CONTENT_TYPES: { type: ContentType; emoji: string; label: string; desc: string }[] = [
  { type: 'VIDEO', emoji: '🎬', label: 'YouTube Video',  desc: 'Long-form with trend research, AI script & publish' },
  { type: 'SHORT', emoji: '✂️', label: 'YouTube Short',  desc: 'Vertical shorts from scratch or clipped from long video' },
  { type: 'MUSIC', emoji: '🎵', label: 'Music / Audio',  desc: 'Music track, gospel, podcast or audio content' },
];

const CT_TILE: Record<ContentType, { tileBg: string; badgeBg: string; badgeColor: string }> = {
  VIDEO: { tileBg: 'linear-gradient(135deg, #f0edf9, #e3ddf8)', badgeBg: '#f0edf9', badgeColor: '#6D4AE0' },
  SHORT: { tileBg: 'linear-gradient(135deg, #fefce8, #fde68a)', badgeBg: '#fefce8', badgeColor: '#a16207' },
  MUSIC: { tileBg: 'linear-gradient(135deg, #fdf2f8, #fce7f3)', badgeBg: '#fdf2f8', badgeColor: '#be185d' },
};

const CT_EMOJI: Record<ContentType, string> = { VIDEO: '🎬', SHORT: '✂️', MUSIC: '🎵' };
const CT_LABEL: Record<ContentType, string> = { VIDEO: 'Video', SHORT: 'Short', MUSIC: 'Music' };

const STATUS_STYLE: Record<string, { bg: string; color: string; dot: string }> = {
  ACTIVE:   { bg: '#ecfdf5', color: '#065f46', dot: '#10b981' },
  DRAFT:    { bg: '#f5f2fd', color: '#6D4AE0', dot: '#6D4AE0' },
  PAUSED:   { bg: '#fff7ed', color: '#c2410c', dot: '#f97316' },
  ARCHIVED: { bg: '#f3f4f6', color: '#4b5563', dot: '#9ca3af' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getContentType(projectId: string): ContentType {
  if (typeof window === 'undefined') return 'VIDEO';
  return (localStorage.getItem(`cf_ct_${projectId}`) as ContentType | null) ?? 'VIDEO';
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

// ── Field input ───────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

// ── Page ──────────────────────────────────────────────────────────────────────

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

  const activeCount = projects.filter((p) => p.status === 'ACTIVE').length;
  const totalJobs   = projects.reduce((s, p) => s + p._count.jobs, 0);
  const totalVideos = projects.reduce((s, p) => s + p._count.videos, 0);

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
              Create your first content campaign — long-form YouTube videos, Shorts, or music tracks.
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
              const ct = getContentType(p.id);
              const tile = CT_TILE[ct];
              return (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="group bg-white rounded-2xl p-5 transition-all hover:border-[#6D4AE0]/40 hover:shadow-lg hover:-translate-y-0.5"
                  style={{ border: '1.5px solid #e3ddf8' }}
                >
                  {/* Top row */}
                  <div className="flex items-start gap-3 mb-4">
                    <div
                      className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0"
                      style={{ background: tile.tileBg }}
                    >
                      {CT_EMOJI[ct]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-extrabold text-gray-900 text-sm leading-tight truncate mb-1">
                        {p.title}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <Youtube className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        <span className="truncate">{p.channel.title}</span>
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
                        style={{ background: tile.badgeBg, color: tile.badgeColor }}
                      >
                        {CT_LABEL[ct]}
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
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create project modal ──────────────────────────────────────────── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,10,40,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false); }}
        >
          <div
            className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
            style={{ border: '1.5px solid #e3ddf8' }}
          >
            {/* Modal header */}
            <div
              className="px-7 py-5 flex items-center justify-between"
              style={{ borderBottom: '1.5px solid #f0edf9' }}
            >
              <div>
                <h2 className="text-lg font-extrabold text-gray-900">New Project</h2>
                <p className="text-xs text-gray-400 mt-0.5">Choose a type and fill in the details</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-7 py-6 space-y-5">
              {/* Content type tiles */}
              <Field label="Content type">
                <div className="grid grid-cols-3 gap-3 mt-0.5">
                  {CONTENT_TYPES.map((ct) => {
                    const selected = form.contentType === ct.type;
                    return (
                      <button
                        key={ct.type}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, contentType: ct.type }))}
                        className="flex flex-col items-center gap-2 py-4 px-3 rounded-2xl text-center transition-all"
                        style={
                          selected
                            ? { background: '#f5f2fd', border: '2px solid #6D4AE0' }
                            : { background: '#faf9ff', border: '1.5px solid #e3ddf8' }
                        }
                      >
                        <span className="text-2xl" aria-hidden>{ct.emoji}</span>
                        <span
                          className="text-xs font-bold leading-none"
                          style={{ color: selected ? '#6D4AE0' : '#374151' }}
                        >
                          {ct.label}
                        </span>
                        <span className="text-[10px] text-gray-400 leading-tight">{ct.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* Channel select */}
              <Field label="Channel">
                <div className="relative">
                  <select
                    aria-label="Channel"
                    value={form.channelId}
                    onChange={(e) => setForm((f) => ({ ...f, channelId: e.target.value }))}
                    className={`${inputCls} pr-10 appearance-none cursor-pointer`}
                    style={inputStyle}
                  >
                    <option value="">Select a channel…</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>{ch.title}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
                {channels.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
                    <span>⚠</span> No channels connected yet —{' '}
                    <Link href="/library?tab=channels" className="underline" onClick={() => setShowCreate(false)}>connect one first</Link>
                  </p>
                )}
              </Field>

              {/* Title */}
              <Field label="Project title">
                <input
                  placeholder="e.g. How to Start Investing in 2025"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className={inputCls}
                  style={inputStyle}
                />
              </Field>

              {/* Niche */}
              <Field
                label="Niche"
                hint={
                  form.contentType === 'MUSIC'  ? 'e.g. Gospel, R&B, Worship' :
                  form.contentType === 'SHORT'  ? 'e.g. Tech Tips, Life Hacks, Finance' :
                  'e.g. Technology, Personal Finance, Cooking'
                }
              >
                <input
                  placeholder="Optional — helps AI tune content"
                  value={form.niche}
                  onChange={(e) => setForm((f) => ({ ...f, niche: e.target.value }))}
                  className={inputCls}
                  style={inputStyle}
                />
              </Field>
            </div>

            {/* Modal footer */}
            <div
              className="px-7 py-5 flex items-center justify-between gap-3"
              style={{ borderTop: '1.5px solid #f0edf9' }}
            >
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-5 py-2.5 rounded-2xl text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={!form.channelId || !form.title || createMutation.isPending}
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
          </div>
        </div>
      )}
    </div>
  );
}
