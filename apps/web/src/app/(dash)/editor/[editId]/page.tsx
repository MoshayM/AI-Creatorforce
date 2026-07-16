'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Film, Play, Pause, Loader2, Save, Download, Wand2,
  Volume2, Zap, Type, Image, X,
  ZoomIn, ZoomOut, Plus, Maximize2,
  SlidersHorizontal, ChevronDown, Clapperboard, Sparkles, KeyRound,
  Music,
} from 'lucide-react';
import {
  api,
  apiClient,
  type EditProject,
  type EditTimeline,
  type EditTrack,
  type EditItem,
  type EditItemProperties,
  type EditItemFilters,
  type TransitionType,
  type EditItemTransition,
  type TextAnimType,
  type EditKeyframe,
  type MediaBinEntry,
  type RenderPreset,
  type RenderStatus,
  type EditExportOptions,
  type RenderFormat,
  type RenderQuality,
} from '@/lib/api';
import { JobErrorCard } from '@/components/job-error-card';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

const TRACK_H = 48; // px, also min touch target height
const TRACK_COLORS: Record<string, string> = {
  VIDEO: 'bg-brand-500/80 border-brand-600 text-white',
  AUDIO: 'bg-emerald-500/70 border-emerald-600 text-white',
  TEXT: 'bg-amber-400/80 border-amber-500 text-gray-900',
};

function msToX(ms: number, pxPerSec: number): number {
  return (ms / 1000) * pxPerSec;
}
function xToMs(px: number, pxPerSec: number): number {
  return (px / pxPerSec) * 1000;
}

/** Media-bin asset kinds → timeline item kind. VOICE/MUSIC are audio-only. */
function binKindToItemKind(kind: string): 'VIDEO' | 'IMAGE' | 'AUDIO' {
  if (kind === 'AUDIO' || kind === 'VOICE' || kind === 'MUSIC') return 'AUDIO';
  if (kind === 'IMAGE') return 'IMAGE';
  return 'VIDEO';
}

// Signed media URLs let the <video> element stream straight from the API
// without needing an Authorization header. Cached per asset version and
// refreshed shortly before expiry.
const signedUrlCache = new Map<string, { url: string; expiresAtMs: number }>();

function useSignedMediaUrl(versionId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!versionId) return null;
    const hit = signedUrlCache.get(versionId);
    return hit && hit.expiresAtMs - Date.now() > 30_000 ? hit.url : null;
  });
  useEffect(() => {
    if (!versionId) { setUrl(null); return; }
    const hit = signedUrlCache.get(versionId);
    if (hit && hit.expiresAtMs - Date.now() > 30_000) { setUrl(hit.url); return; }
    let cancelled = false;
    void api.media.versionSignedUrl(versionId).then((r) => {
      // r.data.url is API-relative ("/api/v1/media/..."), prefix the API origin
      const origin = new URL(apiClient.defaults.baseURL ?? 'http://localhost:4007/api/v1').origin;
      const abs = `${origin}${r.data.url}`;
      signedUrlCache.set(versionId, { url: abs, expiresAtMs: new Date(r.data.expiresAt).getTime() });
      if (!cancelled) setUrl(abs);
    }).catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; };
  }, [versionId]);
  return url;
}

// ── Render Export Dialog ──────────────────────────────────────────────────────

const PRESETS: { value: RenderPreset; label: string }[] = [
  { value: '1080P_16_9', label: '1080p 16:9 (Landscape)' },
  { value: '1080P_9_16', label: '1080p 9:16 (Vertical / Shorts)' },
  { value: '720P_16_9', label: '720p 16:9' },
  { value: '1080P_1_1', label: '1080p 1:1 (Square)' },
  { value: 'SOURCE', label: 'Match source' },
];

const FORMATS: { value: RenderFormat; label: string }[] = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'webm', label: 'WebM (VP9)' },
];

const QUALITIES: { value: RenderQuality; label: string; hint: string }[] = [
  { value: 'draft', label: 'Draft', hint: 'Fast, lower bitrate — good for review' },
  { value: 'standard', label: 'Standard', hint: 'Balanced quality and file size' },
  { value: 'high', label: 'High', hint: 'Maximum quality, larger file' },
];

function ExportDialog({ editId, onClose }: { editId: string; onClose: () => void }) {
  const [preset, setPreset] = useState<RenderPreset>('1080P_16_9');
  const [format, setFormat] = useState<RenderFormat>('mp4');
  const [quality, setQuality] = useState<RenderQuality>('standard');
  const [renderStatus, setRenderStatus] = useState<RenderStatus | null>(null);
  const [downloadPath, setDownloadPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => () => stopPoll(), []);

  const startRender = async () => {
    setSubmitting(true);
    setError(null);
    setRenderStatus(null);
    try {
      const options: EditExportOptions = { preset, format, quality };
      const res = await api.editor.render(editId, options);
      setRenderStatus(res.data.renderStatus);
      // Poll render-status
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.editor.renderStatus(editId);
          setRenderStatus(s.data.renderStatus);
          if (s.data.renderStatus === 'READY') {
            setDownloadPath(s.data.downloadPath ?? null);
            stopPoll();
          } else if (s.data.renderStatus === 'FAILED') {
            setError('Render failed on the server. Retry or contact support.');
            stopPoll();
          }
        } catch { /* keep polling */ }
      }, 4000);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Failed to start render');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Build a download filename hint from the chosen format
  const downloadFilename = `export.${format}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div role="dialog" aria-modal="true" aria-label="Export video" className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <Download className="w-5 h-5 text-brand-600" />
          <h2 className="text-base font-semibold text-gray-900 flex-1">Export video</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label htmlFor="export-preset" className="text-sm font-medium text-gray-700 block mb-1.5">Output preset</label>
            <select
              id="export-preset"
              value={preset}
              onChange={(e) => setPreset(e.target.value as RenderPreset)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="export-format" className="text-sm font-medium text-gray-700 block mb-1.5">Format</label>
              <select
                id="export-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as RenderFormat)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="export-quality" className="text-sm font-medium text-gray-700 block mb-1.5">Quality</label>
              <select
                id="export-quality"
                value={quality}
                onChange={(e) => setQuality(e.target.value as RenderQuality)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {QUALITIES.map((q) => (
                  <option key={q.value} value={q.value}>{q.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">
            {QUALITIES.find((q) => q.value === quality)?.hint}
          </p>

          {renderStatus && renderStatus !== 'READY' && renderStatus !== 'FAILED' && (
            <div className="flex items-center gap-2 text-sm text-brand-700 bg-brand-50 rounded-xl px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              {renderStatus === 'PENDING' || renderStatus === 'QUEUED' ? 'Queued — waiting for worker…' : 'Rendering…'}
            </div>
          )}

          {renderStatus === 'READY' && downloadPath && (
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 space-y-2">
              <p className="text-sm text-green-800 font-medium">Render complete!</p>
              <a
                href={downloadPath}
                download={downloadFilename}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
              >
                <Download className="w-4 h-4" /> Download {downloadFilename}
              </a>
            </div>
          )}

          {error && (
            <JobErrorCard
              error={error}
              errorCode="JOB_FAILED"
              onRetry={() => void startRender()}
            />
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              {renderStatus === 'READY' ? 'Close' : 'Cancel'}
            </button>
            {!renderStatus && (
              <button
                onClick={() => void startRender()}
                disabled={submitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Start render
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AI Edit Dialog ────────────────────────────────────────────────────────────

/** Canned instruction used when the dialog opens in auto-suggest mode. */
const AUTO_EDIT_INSTRUCTION =
  'Analyze this video edit and suggest an automatic edit plan: silent sections to trim, ' +
  'filler words to cut, pacing improvements, and any title/text overlays or transitions ' +
  'that would improve it. List each suggested edit with timestamps so I can apply them.';

function AiEditDialog({ editId, timeline, autoSuggest = false, onClose }: { editId: string; timeline: EditTimeline | null; autoSuggest?: boolean; onClose: () => void }) {
  const [instruction, setInstruction] = useState(autoSuggest ? AUTO_EDIT_INSTRUCTION : '');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoRan = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (text?: string) => {
    const prompt = (text ?? instruction).trim();
    if (!prompt || busy) return;
    setBusy(true);
    setReply(null);
    setError(null);
    try {
      // Route through the existing copilot endpoint — do NOT make a direct LLM call.
      // The copilot handles instructions with editor context; Phase 2 will wire up
      // a dedicated apply-to-timeline endpoint.
      // TODO (Phase 2): parse structured commands from the response and apply them
      // to the timeline via api.editor.saveTimeline when the backend exposes an
      // editor-aware copilot action.
      const res = await apiClient.post<{ reply: string }>('/copilot/chat', {
        messages: [
          {
            role: 'user',
            content: `[Video Editor context — editId: ${editId}, tracks: ${timeline?.tracks.length ?? 0}, duration: ${timeline ? fmtMs(timeline.durationMs) : 'unknown'}]\n\n${prompt}`,
          },
        ],
        inputMode: 'text',
      });
      setReply(res.data.reply);
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  // Auto-suggest: fire the canned request once when opened from "Video Edit"
  // on an imported video, as soon as the timeline context has loaded.
  useEffect(() => {
    if (!autoSuggest || autoRan.current || !timeline) return;
    autoRan.current = true;
    void submit(AUTO_EDIT_INSTRUCTION);
  }, [autoSuggest, timeline]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div role="dialog" aria-modal="true" aria-label="AI edit assistant" className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <Wand2 className="w-5 h-5 text-brand-600" />
          <h2 className="text-base font-semibold text-gray-900 flex-1">AI edit</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-gray-500">
            Describe what you want to change — the Copilot will guide you. Automatic timeline application is coming in Phase 2.
          </p>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={3}
            placeholder={'Try: "trim the silent intro", "add a title that says Welcome", "speed up the middle section"'}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-brand-400 resize-none"
          />
          {reply && (
            <div className="rounded-xl bg-brand-50 border border-brand-100 p-4 text-sm text-gray-800 whitespace-pre-wrap">
              {reply}
            </div>
          )}
          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Close</button>
            <button
              onClick={() => void submit()}
              disabled={!instruction.trim() || busy}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Ask Copilot
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inspector Panel ───────────────────────────────────────────────────────────

function Inspector({
  item,
  onChange,
  onDelete,
  currentTimeMs,
}: {
  item: EditItem | null;
  onChange: (patch: Partial<EditItem>) => void;
  onDelete?: () => void;
  currentTimeMs: number;
}) {
  // Collapsible section open states
  const [effectsOpen, setEffectsOpen] = useState(true);
  const [transitionOpen, setTransitionOpen] = useState(true);
  const [textAnimOpen, setTextAnimOpen] = useState(true);
  const [keyframesOpen, setKeyframesOpen] = useState(true);
  const [audioOpen, setAudioOpen] = useState(true);

  if (!item) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm p-4 text-center">
        Click an item on the timeline to inspect and edit its properties
      </div>
    );
  }

  const props = item.properties ?? {};

  // @reason: EditItemProperties keys are statically known; the dynamic key is always a valid property name.
  const setProp = (key: keyof EditItemProperties, value: number | string | boolean | EditItemFilters | EditItemTransition | TextAnimType | EditKeyframe[] | undefined) => {
    onChange({ properties: { ...props, [key]: value } });
  };

  const filters = props.filters ?? {};

  const setFilter = (key: keyof EditItemFilters, value: number | boolean) => {
    onChange({ properties: { ...props, filters: { ...filters, [key]: value } } });
  };

  const resetFilters = () => {
    onChange({ properties: { ...props, filters: undefined } });
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* ── Item info ── */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          {item.kind} item
        </p>
        <div className="text-xs text-gray-500 space-y-0.5">
          <p>Start: {fmtMs(item.timelineStartMs)}</p>
          <p>End: {fmtMs(item.timelineEndMs)}</p>
          <p>Duration: {fmtMs(item.timelineEndMs - item.timelineStartMs)}</p>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Remove this item from the timeline (Delete)"
            className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs hover:bg-red-50"
          >
            <X className="w-3.5 h-3.5" /> Remove from timeline
          </button>
        )}
      </div>

      {/* ── Volume (AUDIO / VIDEO) ── */}
      {(item.kind === 'AUDIO' || item.kind === 'VIDEO') && (
        <div>
          <label htmlFor="insp-volume" className="text-xs font-medium text-gray-700 flex items-center gap-1 mb-1.5">
            <Volume2 className="w-3.5 h-3.5" /> Volume
          </label>
          <input
            id="insp-volume"
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={props.volume ?? 1}
            onChange={(e) => setProp('volume', parseFloat(e.target.value))}
            className="w-full accent-brand-600"
          />
          <p className="text-[11px] text-gray-500 text-right">{Math.round((props.volume ?? 1) * 100)}%</p>
        </div>
      )}

      {/* ── Speed (VIDEO) ── */}
      {item.kind === 'VIDEO' && (
        <div>
          <label htmlFor="insp-speed" className="text-xs font-medium text-gray-700 flex items-center gap-1 mb-1.5">
            <Zap className="w-3.5 h-3.5" /> Speed
          </label>
          <input
            id="insp-speed"
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={props.speed ?? 1}
            onChange={(e) => setProp('speed', parseFloat(e.target.value))}
            className="w-full accent-brand-600"
          />
          <p className="text-[11px] text-gray-500 text-right">{(props.speed ?? 1).toFixed(2)}×</p>
        </div>
      )}

      {/* ── Opacity / Scale / Position (VIDEO / IMAGE) ── */}
      {(item.kind === 'VIDEO' || item.kind === 'IMAGE') && (
        <>
          <div>
            <label htmlFor="insp-opacity" className="text-xs font-medium text-gray-700 block mb-1.5">Opacity</label>
            <input
              id="insp-opacity"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={props.opacity ?? 1}
              onChange={(e) => setProp('opacity', parseFloat(e.target.value))}
              className="w-full accent-brand-600"
            />
            <p className="text-[11px] text-gray-500 text-right">{Math.round((props.opacity ?? 1) * 100)}%</p>
          </div>
          <div>
            <label htmlFor="insp-scale" className="text-xs font-medium text-gray-700 block mb-1.5">Scale</label>
            <input
              id="insp-scale"
              type="range"
              min={0.1}
              max={3}
              step={0.01}
              value={props.scale ?? 1}
              onChange={(e) => setProp('scale', parseFloat(e.target.value))}
              className="w-full accent-brand-600"
            />
            <p className="text-[11px] text-gray-500 text-right">{(props.scale ?? 1).toFixed(2)}×</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="insp-x" className="text-xs font-medium text-gray-700 block mb-1">X position</label>
              <input
                id="insp-x"
                type="number"
                value={props.x ?? 0}
                onChange={(e) => setProp('x', parseFloat(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <label htmlFor="insp-y" className="text-xs font-medium text-gray-700 block mb-1">Y position</label>
              <input
                id="insp-y"
                type="number"
                value={props.y ?? 0}
                onChange={(e) => setProp('y', parseFloat(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
              />
            </div>
          </div>
        </>
      )}

      {/* ── Text controls (TEXT) ── */}
      {item.kind === 'TEXT' && (
        <>
          <div>
            <label htmlFor="insp-text" className="text-xs font-medium text-gray-700 flex items-center gap-1 mb-1.5">
              <Type className="w-3.5 h-3.5" /> Text
            </label>
            <textarea
              id="insp-text"
              value={props.text ?? ''}
              onChange={(e) => setProp('text', e.target.value)}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none"
            />
          </div>
          <div>
            <label htmlFor="insp-fontsize" className="text-xs font-medium text-gray-700 block mb-1.5">Font size</label>
            <input
              id="insp-fontsize"
              type="number"
              min={8}
              max={200}
              value={props.fontSize ?? 32}
              onChange={(e) => setProp('fontSize', parseInt(e.target.value, 10))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="insp-color" className="text-xs font-medium text-gray-700 block mb-1.5">Color</label>
            <input
              id="insp-color"
              type="color"
              value={props.color ?? '#ffffff'}
              onChange={(e) => setProp('color', e.target.value)}
              className="w-full h-8 border border-gray-200 rounded-lg cursor-pointer"
            />
          </div>
        </>
      )}

      {/* ── EFFECTS section (VIDEO / IMAGE) ── */}
      {/* TODO (Phase 2): Effects/filters are stored in properties.filters and sent to the render/export pipeline.
          Live preview does NOT reflect these in Phase 2 — the preview still shows the raw clip.
          WYSIWYG canvas preview is planned for Phase 3. */}
      {(item.kind === 'VIDEO' || item.kind === 'IMAGE') && (
        <div className="border-t border-gray-100 pt-4">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left mb-3 min-h-[44px]"
            onClick={() => setEffectsOpen((o) => !o)}
            aria-expanded={effectsOpen}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">Effects</p>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${effectsOpen ? '' : '-rotate-90'}`} />
          </button>
          {effectsOpen && (
            <div className="space-y-3">
              <div>
                <label htmlFor="insp-brightness" className="text-xs font-medium text-gray-700 flex justify-between mb-1">
                  <span>Brightness</span>
                  <span className="tabular-nums">{(filters.brightness ?? 0).toFixed(2)}</span>
                </label>
                <input
                  id="insp-brightness"
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={filters.brightness ?? 0}
                  onChange={(e) => setFilter('brightness', clamp(parseFloat(e.target.value), -1, 1))}
                  className="w-full accent-brand-600"
                />
              </div>
              <div>
                <label htmlFor="insp-contrast" className="text-xs font-medium text-gray-700 flex justify-between mb-1">
                  <span>Contrast</span>
                  <span className="tabular-nums">{(filters.contrast ?? 1).toFixed(2)}</span>
                </label>
                <input
                  id="insp-contrast"
                  type="range"
                  min={0}
                  max={2}
                  step={0.01}
                  value={filters.contrast ?? 1}
                  onChange={(e) => setFilter('contrast', clamp(parseFloat(e.target.value), 0, 2))}
                  className="w-full accent-brand-600"
                />
              </div>
              <div>
                <label htmlFor="insp-saturation" className="text-xs font-medium text-gray-700 flex justify-between mb-1">
                  <span>Saturation</span>
                  <span className="tabular-nums">{(filters.saturation ?? 1).toFixed(2)}</span>
                </label>
                <input
                  id="insp-saturation"
                  type="range"
                  min={0}
                  max={3}
                  step={0.01}
                  value={filters.saturation ?? 1}
                  onChange={(e) => setFilter('saturation', clamp(parseFloat(e.target.value), 0, 3))}
                  className="w-full accent-brand-600"
                />
              </div>
              <div>
                <label htmlFor="insp-blur" className="text-xs font-medium text-gray-700 flex justify-between mb-1">
                  <span>Blur</span>
                  <span className="tabular-nums">{(filters.blur ?? 0).toFixed(1)}px</span>
                </label>
                <input
                  id="insp-blur"
                  type="range"
                  min={0}
                  max={20}
                  step={0.5}
                  value={filters.blur ?? 0}
                  onChange={(e) => setFilter('blur', clamp(parseFloat(e.target.value), 0, 20))}
                  className="w-full accent-brand-600"
                />
              </div>
              <div className="flex items-center gap-2 min-h-[44px]">
                <input
                  id="insp-grayscale"
                  type="checkbox"
                  checked={filters.grayscale ?? false}
                  onChange={(e) => setFilter('grayscale', e.target.checked)}
                  className="w-4 h-4 accent-brand-600 rounded"
                />
                <label htmlFor="insp-grayscale" className="text-xs font-medium text-gray-700 cursor-pointer">Grayscale</label>
              </div>
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-gray-500 hover:text-red-600 underline min-h-[44px] w-full text-left"
              >
                Reset effects
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── TRANSITION section (VIDEO items) ── */}
      {/* TODO (Phase 2): Transition is stored in properties.transitionIn and applied on render/export.
          Live preview does NOT show the transition in Phase 2. WYSIWYG planned for Phase 3. */}
      {item.kind === 'VIDEO' && (
        <div className="border-t border-gray-100 pt-4">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left mb-3 min-h-[44px]"
            onClick={() => setTransitionOpen((o) => !o)}
            aria-expanded={transitionOpen}
          >
            <Clapperboard className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">Transition in</p>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${transitionOpen ? '' : '-rotate-90'}`} />
          </button>
          {transitionOpen && (
            <div className="space-y-3">
              <div>
                <label htmlFor="insp-transition-type" className="text-xs font-medium text-gray-700 block mb-1.5">Type</label>
                <select
                  id="insp-transition-type"
                  value={props.transitionIn?.type ?? 'none'}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'none') {
                      setProp('transitionIn', undefined);
                    } else {
                      setProp('transitionIn', {
                        type: v as TransitionType,
                        durationMs: props.transitionIn?.durationMs ?? 500,
                      });
                    }
                  }}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="dissolve">Dissolve</option>
                  <option value="slide">Slide</option>
                </select>
              </div>
              {props.transitionIn && (
                <div>
                  <label htmlFor="insp-transition-dur" className="text-xs font-medium text-gray-700 flex justify-between mb-1.5">
                    <span>Duration</span>
                    <span className="tabular-nums">{props.transitionIn.durationMs}ms</span>
                  </label>
                  <input
                    id="insp-transition-dur"
                    type="range"
                    min={100}
                    max={3000}
                    step={50}
                    value={props.transitionIn.durationMs}
                    onChange={(e) => {
                      const dur = clamp(parseInt(e.target.value, 10), 100, 3000);
                      setProp('transitionIn', { ...props.transitionIn!, durationMs: dur });
                    }}
                    className="w-full accent-brand-600"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TEXT ANIMATION section (TEXT items) ── */}
      {/* TODO (Phase 2): textAnim is stored in properties and applied on render/export.
          Live preview does NOT animate text in Phase 2. WYSIWYG planned for Phase 3. */}
      {item.kind === 'TEXT' && (
        <div className="border-t border-gray-100 pt-4">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left mb-3 min-h-[44px]"
            onClick={() => setTextAnimOpen((o) => !o)}
            aria-expanded={textAnimOpen}
          >
            <Sparkles className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">Text animation</p>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${textAnimOpen ? '' : '-rotate-90'}`} />
          </button>
          {textAnimOpen && (
            <div>
              <label htmlFor="insp-text-anim" className="text-xs font-medium text-gray-700 block mb-1.5">Animation</label>
              <select
                id="insp-text-anim"
                value={props.textAnim ?? 'none'}
                onChange={(e) => setProp('textAnim', e.target.value as TextAnimType)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="none">None</option>
                <option value="fade-in">Fade in</option>
                <option value="slide-up">Slide up</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* ── AUDIO section (VIDEO / AUDIO) ── */}
      {/* TODO (Phase 3): Fade envelope and gain are applied on render/export only.
          Live preview does NOT reflect audio processing in Phase 3.
          Waveform visualisation skipped — no client-side audio decode; add in a future phase. */}
      {(item.kind === 'VIDEO' || item.kind === 'AUDIO') && (
        <div className="border-t border-gray-100 pt-4">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left mb-3 min-h-[44px]"
            onClick={() => setAudioOpen((o) => !o)}
            aria-expanded={audioOpen}
          >
            <Music className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">Audio</p>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${audioOpen ? '' : '-rotate-90'}`} />
          </button>
          {audioOpen && (
            <div className="space-y-3">
              {/* Fade in */}
              <div>
                <label htmlFor="insp-fade-in" className="text-xs font-medium text-gray-700 flex justify-between mb-1">
                  <span>Fade in</span>
                  <span className="tabular-nums">{props.fadeInMs ?? 0} ms</span>
                </label>
                <input
                  id="insp-fade-in"
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={props.fadeInMs ?? 0}
                  onChange={(e) => setProp('fadeInMs', clamp(parseInt(e.target.value, 10) || 0, 0, 10000))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                />
              </div>
              {/* Fade out */}
              <div>
                <label htmlFor="insp-fade-out" className="text-xs font-medium text-gray-700 flex justify-between mb-1">
                  <span>Fade out</span>
                  <span className="tabular-nums">{props.fadeOutMs ?? 0} ms</span>
                </label>
                <input
                  id="insp-fade-out"
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={props.fadeOutMs ?? 0}
                  onChange={(e) => setProp('fadeOutMs', clamp(parseInt(e.target.value, 10) || 0, 0, 10000))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                />
              </div>
              {/* Gain */}
              <div>
                <label htmlFor="insp-gain" className="text-xs font-medium text-gray-700 flex justify-between mb-1">
                  <span>Gain</span>
                  <span className="tabular-nums">{(props.gainDb ?? 0).toFixed(1)} dB</span>
                </label>
                <input
                  id="insp-gain"
                  type="range"
                  min={-60}
                  max={12}
                  step={0.5}
                  value={props.gainDb ?? 0}
                  onChange={(e) => setProp('gainDb', clamp(parseFloat(e.target.value), -60, 12))}
                  className="w-full accent-brand-600"
                />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>-60 dB</span>
                  <span>0 dB</span>
                  <span>+12 dB</span>
                </div>
              </div>
              {/* Duck under voice (AUDIO items only) */}
              {item.kind === 'AUDIO' && (
                <div className="flex items-center gap-2 min-h-[44px]">
                  <input
                    id="insp-duck-voice"
                    type="checkbox"
                    checked={props.duckUnderVoice ?? false}
                    onChange={(e) => setProp('duckUnderVoice', e.target.checked)}
                    className="w-4 h-4 accent-brand-600 rounded"
                  />
                  <label htmlFor="insp-duck-voice" className="text-xs font-medium text-gray-700 cursor-pointer">
                    Duck under voice
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── KEYFRAMES section (VIDEO / IMAGE / TEXT) ── */}
      {/* TODO (Phase 2): Keyframe interpolation is applied on render/export only.
          Live preview does NOT reflect keyframe motion in Phase 2. WYSIWYG curve editor planned for Phase 3. */}
      {(item.kind === 'VIDEO' || item.kind === 'IMAGE' || item.kind === 'TEXT') && (
        <div className="border-t border-gray-100 pt-4">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left mb-3 min-h-[44px]"
            onClick={() => setKeyframesOpen((o) => !o)}
            aria-expanded={keyframesOpen}
          >
            <KeyRound className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">Keyframes</p>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${keyframesOpen ? '' : '-rotate-90'}`} />
          </button>
          {keyframesOpen && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => {
                  const existing = props.keyframes ?? [];
                  // Schema wants integer ms; avoid duplicate atMs
                  const atMs = Math.max(0, Math.round(currentTimeMs));
                  if (existing.some((kf) => kf.atMs === atMs)) return;
                  const updated = [...existing, { atMs }].sort((a, b) => a.atMs - b.atMs);
                  setProp('keyframes', updated);
                }}
                className="flex items-center gap-1.5 w-full px-3 py-2.5 border border-dashed border-brand-300 text-brand-700 text-xs rounded-lg hover:bg-brand-50 min-h-[44px]"
              >
                <Plus className="w-3.5 h-3.5" /> Add keyframe at {fmtMs(currentTimeMs)}
              </button>
              {(props.keyframes ?? []).length === 0 && (
                <p className="text-xs text-gray-400 text-center py-1">No keyframes yet</p>
              )}
              {(props.keyframes ?? []).map((kf, idx) => (
                <div key={kf.atMs} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-600">{fmtMs(kf.atMs)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = (props.keyframes ?? []).filter((_, i) => i !== idx);
                        setProp('keyframes', updated.length > 0 ? updated : undefined);
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
                      aria-label={`Delete keyframe at ${fmtMs(kf.atMs)}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`kf-opacity-${idx}`} className="text-[10px] font-medium text-gray-500 block mb-0.5">Opacity</label>
                      <input
                        id={`kf-opacity-${idx}`}
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        placeholder="—"
                        value={kf.opacity ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? undefined : clamp(parseFloat(e.target.value), 0, 1);
                          const updated = (props.keyframes ?? []).map((k, i) => i === idx ? { ...k, opacity: v } : k);
                          setProp('keyframes', updated);
                        }}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor={`kf-scale-${idx}`} className="text-[10px] font-medium text-gray-500 block mb-0.5">Scale</label>
                      <input
                        id={`kf-scale-${idx}`}
                        type="number"
                        min={0.1}
                        max={10}
                        step={0.01}
                        placeholder="—"
                        value={kf.scale ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? undefined : clamp(parseFloat(e.target.value), 0.1, 10);
                          const updated = (props.keyframes ?? []).map((k, i) => i === idx ? { ...k, scale: v } : k);
                          setProp('keyframes', updated);
                        }}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor={`kf-x-${idx}`} className="text-[10px] font-medium text-gray-500 block mb-0.5">X</label>
                      <input
                        id={`kf-x-${idx}`}
                        type="number"
                        step={1}
                        placeholder="—"
                        value={kf.x ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                          const updated = (props.keyframes ?? []).map((k, i) => i === idx ? { ...k, x: v } : k);
                          setProp('keyframes', updated);
                        }}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor={`kf-y-${idx}`} className="text-[10px] font-medium text-gray-500 block mb-0.5">Y</label>
                      <input
                        id={`kf-y-${idx}`}
                        type="number"
                        step={1}
                        placeholder="—"
                        value={kf.y ?? ''}
                        onChange={(e) => {
                          const v = e.target.value === '' ? undefined : parseFloat(e.target.value);
                          const updated = (props.keyframes ?? []).map((k, i) => i === idx ? { ...k, y: v } : k);
                          setProp('keyframes', updated);
                        }}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Timeline Track ────────────────────────────────────────────────────────────

function TimelineTrack({
  track,
  durationMs,
  pxPerSec,
  selectedId,
  onSelect,
  onMoveItem,
  onTrimItem,
}: {
  track: EditTrack;
  durationMs: number;
  pxPerSec: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMoveItem: (itemId: string, newStartMs: number) => void;
  onTrimItem: (itemId: string, newStartMs: number, newEndMs: number) => void;
}) {
  const totalW = msToX(durationMs, pxPerSec);

  return (
    <div className="flex items-center" style={{ minHeight: TRACK_H }}>
      {/* Track label */}
      <div className="w-24 shrink-0 px-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">
        {track.label}
      </div>
      {/* Track lane */}
      <div
        className="relative flex-1 bg-gray-50 border border-gray-100 rounded-lg overflow-hidden"
        style={{ height: TRACK_H, width: totalW }}
      >
        {track.items.map((item) => (
          <TimelineItem
            key={item.id}
            item={item}
            pxPerSec={pxPerSec}
            trackH={TRACK_H}
            selected={item.id === selectedId}
            colorClass={TRACK_COLORS[track.kind] ?? 'bg-gray-400/70 border-gray-500 text-white'}
            onSelect={() => onSelect(item.id)}
            onMove={(newStartMs) => onMoveItem(item.id, newStartMs)}
            onTrim={(newStartMs, newEndMs) => onTrimItem(item.id, newStartMs, newEndMs)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Timeline Item (drag to move, drag edges to trim) ─────────────────────────

function TimelineItem({
  item,
  pxPerSec,
  trackH,
  selected,
  colorClass,
  onSelect,
  onMove,
  onTrim,
}: {
  item: EditItem;
  pxPerSec: number;
  trackH: number;
  selected: boolean;
  colorClass: string;
  onSelect: () => void;
  onMove: (newStartMs: number) => void;
  onTrim: (newStartMs: number, newEndMs: number) => void;
}) {
  const left = msToX(item.timelineStartMs, pxPerSec);
  const width = msToX(item.timelineEndMs - item.timelineStartMs, pxPerSec);
  const HANDLE_W = 8;

  const dragRef = useRef<{ startX: number; startMs: number; mode: 'move' | 'trim-left' | 'trim-right' } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, mode: 'move' | 'trim-left' | 'trim-right') => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startMs: item.timelineStartMs, mode };
    onSelect();
  }, [item.timelineStartMs, onSelect]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const deltaMs = xToMs(dx, pxPerSec);
    if (dragRef.current.mode === 'move') {
      const newStart = Math.max(0, dragRef.current.startMs + deltaMs);
      onMove(newStart);
    } else if (dragRef.current.mode === 'trim-left') {
      const newStart = clamp(dragRef.current.startMs + deltaMs, 0, item.timelineEndMs - 100);
      onTrim(newStart, item.timelineEndMs);
    } else {
      const newEnd = clamp(item.timelineStartMs + (item.timelineEndMs - item.timelineStartMs) + deltaMs, item.timelineStartMs + 100, Infinity);
      onTrim(item.timelineStartMs, newEnd);
    }
  }, [item.timelineStartMs, item.timelineEndMs, pxPerSec, onMove, onTrim]);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const label = item.properties?.text ?? item.kind.toLowerCase();

  return (
    <div
      style={{ left, width, height: trackH, position: 'absolute', top: 0 }}
      className={`rounded border ${colorClass} ${selected ? 'ring-2 ring-white ring-offset-1' : ''} flex items-center overflow-hidden select-none touch-none`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Left trim handle */}
      <div
        className="absolute left-0 top-0 bottom-0 cursor-ew-resize z-10 flex items-center justify-center"
        style={{ width: HANDLE_W, minHeight: 44 }}
        onPointerDown={(e) => onPointerDown(e, 'trim-left')}
      >
        <div className="w-0.5 h-4 bg-white/60 rounded-full" />
      </div>
      {/* Main body — drag to move */}
      <div
        className="flex-1 h-full flex items-center px-3 cursor-grab active:cursor-grabbing overflow-hidden"
        style={{ paddingLeft: HANDLE_W + 4, paddingRight: HANDLE_W + 4 }}
        onPointerDown={(e) => onPointerDown(e, 'move')}
      >
        <span className="text-[11px] font-medium truncate">{label}</span>
      </div>
      {/* Right trim handle */}
      <div
        className="absolute right-0 top-0 bottom-0 cursor-ew-resize z-10 flex items-center justify-center"
        style={{ width: HANDLE_W, minHeight: 44 }}
        onPointerDown={(e) => onPointerDown(e, 'trim-right')}
      >
        <div className="w-0.5 h-4 bg-white/60 rounded-full" />
      </div>
    </div>
  );
}

// ── Media Bin ─────────────────────────────────────────────────────────────────

function MediaBin({
  entries,
  onAddToTimeline,
}: {
  entries: MediaBinEntry[];
  onAddToTimeline: (entry: MediaBinEntry) => void;
}) {
  const KIND_ICON: Record<string, React.ReactNode> = {
    VIDEO: <Film className="w-3.5 h-3.5 text-brand-500" />,
    IMAGE: <Image className="w-3.5 h-3.5 text-amber-500" />,
    AUDIO: <Volume2 className="w-3.5 h-3.5 text-emerald-500" />,
    VOICE: <Volume2 className="w-3.5 h-3.5 text-emerald-500" />,
    MUSIC: <Music className="w-3.5 h-3.5 text-emerald-500" />,
    RENDER_SOURCE: <Film className="w-3.5 h-3.5 text-brand-500" />,
    EDIT_RENDER: <Clapperboard className="w-3.5 h-3.5 text-purple-500" />,
    SHORTS_SOURCE_VIDEO: <Clapperboard className="w-3.5 h-3.5 text-brand-500" />,
  };

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-center text-gray-400 text-xs">
        No media in bin yet. Send a video to this editor from the Shorts Studio or Projects pages.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {entries.map((e) => (
        <div key={e.id} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-2.5 py-2 hover:bg-gray-50">
          <span className="shrink-0">{KIND_ICON[e.kind] ?? <Film className="w-3.5 h-3.5 text-gray-400" />}</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-800 truncate">{e.label}</p>
            {(e.durationMs ?? 0) > 0 && <p className="text-[10px] text-gray-400">{fmtMs(e.durationMs!)}</p>}
          </div>
          <button
            onClick={() => onAddToTimeline(e)}
            title="Add to timeline"
            className="shrink-0 p-1 rounded hover:bg-brand-50 text-brand-600 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Main Editor Page ──────────────────────────────────────────────────────────

export default function EditorWorkspacePage() {
  const { editId } = useParams<{ editId: string }>();
  const qc = useQueryClient();

  // Load edit project
  const { data: project, isLoading, error: loadError } = useQuery<EditProject>({
    queryKey: ['editor-project', editId],
    queryFn: () => api.editor.get(editId).then((r) => r.data),
    refetchOnWindowFocus: false,
  });

  // Load media bin
  const { data: mediaBin = [] } = useQuery<MediaBinEntry[]>({
    queryKey: ['editor-media-bin', editId],
    queryFn: () => api.editor.mediaBin(editId).then((r) => r.data),
    enabled: !!project,
  });

  // Local timeline state (editable copy, synced from server initially)
  const [timeline, setTimeline] = useState<EditTimeline | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [pxPerSec, setPxPerSec] = useState(40);
  const [playing, setPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [showExport, setShowExport] = useState(false);
  const [showAiEdit, setShowAiEdit] = useState(false);
  const [aiAutoSuggest, setAiAutoSuggest] = useState(false);
  // Mobile panel visibility
  const [mobileBinOpen, setMobileBinOpen] = useState(false);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);

  // Arriving from "Video Edit" on an imported video (?autoEdit=1): open the
  // AI dialog immediately so the assistant proposes an auto-edit plan.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('autoEdit') === '1') {
      setAiAutoSuggest(true);
      setShowAiEdit(true);
    }
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialise timeline from server
  useEffect(() => {
    if (project?.timeline && !timeline) {
      setTimeline(project.timeline);
    }
  }, [project, timeline]);

  // Debounced autosave (1.5s after last change)
  useEffect(() => {
    if (!dirty || !timeline) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void handleSave(), 1500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [dirty, timeline]);

  const handleSave = async () => {
    if (!timeline) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.editor.saveTimeline(editId, timeline);
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['editor-project', editId] });
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      setSaveError(e.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const updateTimeline = useCallback((updater: (tl: EditTimeline) => EditTimeline) => {
    setTimeline((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      setDirty(true);
      return next;
    });
  }, []);

  // The timeline schema requires integer ms — pointer deltas come in as
  // fractional pixels, so every write from a drag/trim must round, or the
  // autosave is rejected with "Invalid timeline: … expected integer".
  const handleMoveItem = useCallback((itemId: string, newStartMs: number) => {
    updateTimeline((tl) => ({
      ...tl,
      tracks: tl.tracks.map((tr) => ({
        ...tr,
        items: tr.items.map((it) => {
          if (it.id !== itemId) return it;
          const start = Math.max(0, Math.round(newStartMs));
          return { ...it, timelineStartMs: start, timelineEndMs: start + (it.timelineEndMs - it.timelineStartMs) };
        }),
      })),
    }));
  }, [updateTimeline]);

  const handleTrimItem = useCallback((itemId: string, newStartMs: number, newEndMs: number) => {
    updateTimeline((tl) => ({
      ...tl,
      tracks: tl.tracks.map((tr) => ({
        ...tr,
        items: tr.items.map((it) => {
          if (it.id !== itemId) return it;
          const start = Math.max(0, Math.round(newStartMs));
          const end = Math.max(start + 1, Math.round(newEndMs));
          return { ...it, timelineStartMs: start, timelineEndMs: end };
        }),
      })),
    }));
  }, [updateTimeline]);

  const handleInspectorChange = useCallback((patch: Partial<EditItem>) => {
    if (!selectedItemId) return;
    updateTimeline((tl) => ({
      ...tl,
      tracks: tl.tracks.map((tr) => ({
        ...tr,
        items: tr.items.map((it) =>
          it.id === selectedItemId ? { ...it, ...patch } : it,
        ),
      })),
    }));
  }, [selectedItemId, updateTimeline]);

  const handleAddToTimeline = useCallback((entry: MediaBinEntry) => {
    updateTimeline((tl) => {
      // Find or create a track of matching kind — VOICE/MUSIC assets are
      // audio-only and must land on an AUDIO track, not VIDEO.
      const itemKind = binKindToItemKind(entry.kind);
      const kind = itemKind === 'AUDIO' ? 'AUDIO' : 'VIDEO';
      const existingTrack = tl.tracks.find((t) => t.kind === kind);
      const trackId = existingTrack?.id ?? `track-${Date.now()}`;
      // Round: asset durations from ffprobe can be fractional, schema wants int ms
      const startMs = Math.max(0, Math.round(tl.durationMs));
      const newItem: EditItem = {
        id: `item-${Date.now()}`,
        sourceAssetId: entry.id,
        kind: itemKind,
        timelineStartMs: startMs,
        timelineEndMs: startMs + Math.max(1, Math.round(entry.durationMs || 5000)),
      };
      const newDuration = newItem.timelineEndMs;
      if (existingTrack) {
        return {
          ...tl,
          durationMs: newDuration,
          tracks: tl.tracks.map((t) =>
            t.id === trackId ? { ...t, items: [...t.items, newItem] } : t,
          ),
        };
      }
      const newTrack: EditTrack = {
        id: trackId,
        kind,
        label: kind.charAt(0) + kind.slice(1).toLowerCase(),
        items: [newItem],
      };
      return { ...tl, durationMs: newDuration, tracks: [...tl.tracks, newTrack] };
    });
  }, [updateTimeline]);

  // Remove an item from the timeline (Inspector button or Delete/Backspace).
  // Empty tracks are pruned and the master duration recomputed.
  const handleDeleteItem = useCallback((itemId: string) => {
    setSelectedItemId((sel) => (sel === itemId ? null : sel));
    updateTimeline((tl) => {
      const tracks = tl.tracks
        .map((tr) => ({ ...tr, items: tr.items.filter((it) => it.id !== itemId) }))
        .filter((tr) => tr.items.length > 0);
      const durationMs = tracks.reduce(
        (max, tr) => tr.items.reduce((m, it) => Math.max(m, it.timelineEndMs), max),
        0,
      );
      return { ...tl, tracks, durationMs };
    });
  }, [updateTimeline]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (selectedItemId) {
        e.preventDefault();
        handleDeleteItem(selectedItemId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedItemId, handleDeleteItem]);

  // Playback via rAF
  const startPlay = useCallback(() => {
    if (!timeline) return;
    setPlaying(true);
    const startTime = Date.now() - currentTimeMs;
    const tick = () => {
      const now = Date.now() - startTime;
      if (now >= timeline.durationMs) {
        setCurrentTimeMs(0);
        setPlaying(false);
        return;
      }
      setCurrentTimeMs(now);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [timeline, currentTimeMs]);

  const stopPlay = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  }, []);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // Find the currently-active video source for the preview
  const activeVideoItem = timeline?.tracks
    .filter((t) => t.kind === 'VIDEO')
    .flatMap((t) => t.items)
    .find((it) => it.timelineStartMs <= currentTimeMs && it.timelineEndMs > currentTimeMs) ?? null;

  const activeMediaEntry = activeVideoItem?.sourceAssetId
    ? mediaBin.find((e) => e.id === activeVideoItem.sourceAssetId)
    : null;
  // The bin's previewPath is a server disk path the browser can't load —
  // stream through the media API with an expiring signed URL instead.
  const videoSrc = useSignedMediaUrl(activeMediaEntry?.versionId ?? null);

  // TEXT items overlapping the playhead — overlaid on the preview as a
  // lower-third approximation of the rendered output.
  const activeTextItems = timeline?.tracks
    .filter((t) => t.kind === 'TEXT')
    .flatMap((t) => t.items)
    .filter((it) => it.timelineStartMs <= currentTimeMs && it.timelineEndMs > currentTimeMs) ?? [];

  // Clip-local source time: timeline offset within the clip, scaled by its
  // speed, plus the source trim-in point. This is what the render produces,
  // so the preview seeks here instead of the raw global timeline time.
  const activeSourceSec = activeVideoItem
    ? ((activeVideoItem.sourceInMs ?? 0) + (currentTimeMs - activeVideoItem.timelineStartMs) * (activeVideoItem.properties?.speed ?? 1)) / 1000
    : 0;

  // Slave the <video> element to the rAF master clock. While playing, only
  // correct drift beyond a threshold so playback doesn't stutter from
  // constant micro-seeks; when paused/seeking, snap exactly.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const rate = activeVideoItem?.properties?.speed ?? 1;
    if (v.playbackRate !== rate) v.playbackRate = rate;
    const vol = clamp(activeVideoItem?.properties?.volume ?? 1, 0, 1);
    v.volume = vol;
    v.muted = vol === 0;
    if (playing && activeVideoItem) {
      if (Math.abs(v.currentTime - activeSourceSec) > 0.35) v.currentTime = activeSourceSec;
      if (v.paused) void v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - activeSourceSec) > 0.05) v.currentTime = activeSourceSec;
    }
  }, [playing, currentTimeMs, activeVideoItem, activeSourceSec]);

  // Selected item
  const selectedItem = selectedItemId
    ? timeline?.tracks.flatMap((t) => t.items).find((it) => it.id === selectedItemId) ?? null
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-20 justify-center">
        <Loader2 className="w-6 h-6 animate-spin" /> Loading editor…
      </div>
    );
  }

  if (loadError || !project) {
    return (
      <div className="p-8">
        <Link href="/editor" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
          <ArrowLeft className="w-4 h-4" /> Video Editor
        </Link>
        <JobErrorCard
          error={(loadError as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Could not load this edit project'}
          errorCode="JOB_FAILED"
          onRetry={() => { void qc.invalidateQueries({ queryKey: ['editor-project', editId] }); }}
        />
      </div>
    );
  }

  const dur = timeline?.durationMs ?? 0;
  const totalTimelineW = msToX(dur || 60000, pxPerSec);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-white shrink-0 flex-wrap gap-y-2">
        <Link href="/editor" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 min-h-[44px] min-w-[44px] flex items-center justify-center">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <Film className="w-4 h-4 text-brand-500 shrink-0" />
        <p className="font-semibold text-gray-800 text-sm truncate flex-1 min-w-0">{project.title}</p>

        {dirty && (
          <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">
            Unsaved
          </span>
        )}

        {/* Mobile panel toggles */}
        <button
          onClick={() => setMobileBinOpen((o) => !o)}
          className="lg:hidden p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          title="Media bin"
        >
          <Film className="w-4 h-4" />
        </button>
        <button
          onClick={() => setMobileInspectorOpen((o) => !o)}
          className="lg:hidden p-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          title="Inspector"
        >
          <Maximize2 className="w-4 h-4" />
        </button>

        <button
          onClick={() => setShowAiEdit(true)}
          className="flex items-center gap-1.5 px-3 py-2 border border-brand-200 text-brand-700 rounded-lg text-xs hover:bg-brand-50 min-h-[44px]"
        >
          <Wand2 className="w-3.5 h-3.5" /> AI edit
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-700 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-40 min-h-[44px]"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </button>
        <button
          onClick={() => setShowExport(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-lg text-xs hover:bg-brand-700 min-h-[44px]"
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </div>

      {saveError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700 flex items-center gap-1.5">
          {saveError}
          <button onClick={() => setSaveError(null)} className="ml-auto" aria-label="Dismiss error">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Main layout: left bin / center / right inspector ───────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left: Media Bin (desktop always visible, mobile slide-over) ── */}
        {/* Desktop */}
        <aside className="hidden lg:flex flex-col w-56 shrink-0 border-r border-gray-100 bg-gray-50">
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-brand-500" />
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Media bin</p>
          </div>
          <MediaBin entries={mediaBin} onAddToTimeline={handleAddToTimeline} />
        </aside>

        {/* Mobile media bin slide-over */}
        {mobileBinOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-black/30 flex" onClick={(e) => { if (e.target === e.currentTarget) setMobileBinOpen(false); }} role="presentation">
            <div className="w-72 bg-white h-full flex flex-col shadow-xl" role="dialog" aria-modal="true" aria-label="Media bin">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                <Film className="w-4 h-4 text-brand-500" />
                <p className="text-sm font-semibold text-gray-800 flex-1">Media bin</p>
                <button onClick={() => setMobileBinOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Close media bin">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
              <MediaBin entries={mediaBin} onAddToTimeline={(e) => { handleAddToTimeline(e); setMobileBinOpen(false); }} />
            </div>
          </div>
        )}

        {/* ── Center: Preview + Timeline ───────────────────────────────── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* Preview area */}
          <div className="relative shrink-0 bg-black flex items-center justify-center" style={{ height: 280 }}>
            {videoSrc ? (
              <>
                {/* The rAF loop is the master clock — the element never drives
                    currentTimeMs (two competing clocks made the playhead jump). */}
                <video
                  ref={videoRef}
                  src={videoSrc}
                  className="max-w-full max-h-full object-contain"
                  style={{ opacity: clamp(activeVideoItem?.properties?.opacity ?? 1, 0, 1) }}
                  onLoadedMetadata={(e) => { e.currentTarget.currentTime = activeSourceSec; }}
                  playsInline
                >
                  {/* Source clips carry no sidecar caption file; empty track satisfies a11y. */}
                  <track kind="captions" />
                </video>
                {activeTextItems.map((it) => (
                  <span
                    key={it.id}
                    className="absolute left-1/2 -translate-x-1/2 pointer-events-none font-semibold text-center px-2 max-w-[90%] truncate"
                    style={{
                      bottom: '12%',
                      color: it.properties?.color ?? '#ffffff',
                      fontSize: Math.max(10, (it.properties?.fontSize ?? 32) * 0.4),
                      opacity: clamp(it.properties?.opacity ?? 1, 0, 1),
                      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                    }}
                  >
                    {it.properties?.text ?? ''}
                  </span>
                ))}
                <span className="absolute top-2 right-2 text-[10px] uppercase tracking-wide bg-black/50 text-white/70 px-2 py-0.5 rounded-full pointer-events-none">
                  Approximate preview
                </span>
              </>
            ) : (
              <div className="text-gray-600 text-sm text-center space-y-1 p-4">
                <Film className="w-8 h-8 mx-auto opacity-40" />
                <p className="opacity-60">Approximate preview</p>
                <p className="text-xs opacity-40">Add a video clip to the timeline to preview it here</p>
                {/* TODO (Phase 2): Full WYSIWYG compositing preview with canvas renderer */}
              </div>
            )}
          </div>

          {/* Transport bar */}
          <div className="shrink-0 bg-gray-900 text-white flex items-center gap-3 px-4 py-2">
            <button
              onClick={() => playing ? stopPlay() : startPlay()}
              className="p-2 rounded-lg hover:bg-white/10 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button
              type="button"
              aria-label="Seek"
              className="flex-1 relative h-1.5 bg-white/20 rounded-full cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const frac = (e.clientX - rect.left) / rect.width;
                setCurrentTimeMs(Math.round(frac * (dur || 60000)));
              }}
            >
              <span
                className="absolute left-0 top-0 bottom-0 bg-brand-400 rounded-full"
                style={{ width: `${dur > 0 ? (currentTimeMs / dur) * 100 : 0}%` }}
              />
            </button>
            <span className="text-xs font-mono tabular-nums">{fmtMs(currentTimeMs)} / {fmtMs(dur)}</span>
            {/* Zoom controls */}
            <button
              onClick={() => setPxPerSec((p) => Math.max(5, p - 10))}
              className="p-2 rounded-lg hover:bg-white/10 min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-white/60 tabular-nums w-8 text-center">{pxPerSec}</span>
            <button
              onClick={() => setPxPerSec((p) => Math.min(200, p + 10))}
              className="p-2 rounded-lg hover:bg-white/10 min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>

          {/* Timeline */}
          <div className="flex-1 overflow-auto bg-gray-50">
            {!timeline ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading timeline…
              </div>
            ) : timeline.tracks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm gap-2">
                <Film className="w-8 h-8 opacity-30" />
                <p>Add media from the bin to start editing</p>
              </div>
            ) : (
              <div className="p-3 min-w-0 space-y-1.5">
                {/* Time ruler */}
                <div className="flex ml-24 overflow-hidden" style={{ width: totalTimelineW }}>
                  {Array.from({ length: Math.ceil((dur || 60000) / 5000) }).map((_, i) => (
                    <div
                      key={i}
                      className="shrink-0 text-[9px] text-gray-400 border-l border-gray-200 pl-1"
                      style={{ width: msToX(5000, pxPerSec) }}
                    >
                      {fmtMs(i * 5000)}
                    </div>
                  ))}
                </div>
                {/* Playhead */}
                <div className="relative ml-24" style={{ width: totalTimelineW }}>
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-brand-500 z-20 pointer-events-none"
                    style={{ left: msToX(currentTimeMs, pxPerSec) }}
                  />
                </div>
                {/* Tracks */}
                {timeline.tracks.map((track) => (
                  <TimelineTrack
                    key={track.id}
                    track={track}
                    durationMs={dur || 60000}
                    pxPerSec={pxPerSec}
                    selectedId={selectedItemId}
                    onSelect={(id) => { setSelectedItemId(id); if (window.innerWidth < 1024) setMobileInspectorOpen(true); }}
                    onMoveItem={handleMoveItem}
                    onTrimItem={handleTrimItem}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Inspector (desktop always visible, mobile slide-over) ─ */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 border-l border-gray-100 bg-white">
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-1.5">
            <Maximize2 className="w-3.5 h-3.5 text-gray-500" />
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Inspector</p>
          </div>
          <Inspector item={selectedItem} onChange={handleInspectorChange} onDelete={selectedItemId ? () => handleDeleteItem(selectedItemId) : undefined} currentTimeMs={currentTimeMs} />
        </aside>

        {/* Mobile inspector slide-over */}
        {mobileInspectorOpen && (
          <div className="lg:hidden fixed inset-0 z-40 bg-black/30 flex justify-end" onClick={(e) => { if (e.target === e.currentTarget) setMobileInspectorOpen(false); }} role="presentation">
            <div className="w-72 bg-white h-full flex flex-col shadow-xl" role="dialog" aria-modal="true" aria-label="Inspector">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                <Maximize2 className="w-4 h-4 text-gray-500" />
                <p className="text-sm font-semibold text-gray-800 flex-1">Inspector</p>
                <button onClick={() => setMobileInspectorOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100" aria-label="Close inspector">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
              <Inspector item={selectedItem} onChange={handleInspectorChange} onDelete={selectedItemId ? () => handleDeleteItem(selectedItemId) : undefined} currentTimeMs={currentTimeMs} />
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {showExport && <ExportDialog editId={editId} onClose={() => setShowExport(false)} />}
      {showAiEdit && <AiEditDialog editId={editId} timeline={timeline} autoSuggest={aiAutoSuggest} onClose={() => { setShowAiEdit(false); setAiAutoSuggest(false); }} />}
    </div>
  );
}
