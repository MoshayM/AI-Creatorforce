'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, Clapperboard, Download, Star, RefreshCw, CheckCircle2, Upload,
  ShieldCheck, Package, ExternalLink, AlertTriangle, CalendarClock, XCircle, X,
  CheckCheck, Clock, ShieldAlert, Wifi,
} from 'lucide-react';
import { api, apiClient } from '@/lib/api';
import { JobErrorCard } from '@/components/job-error-card';

interface RenderStatus {
  clipStatus: string | null;
  renderJob: { status: 'QUEUED' | 'RUNNING' | 'CHECKPOINTED' | 'COMPLETE' | 'FAILED'; ffmpegPass: number; checkpointData: { segmentsDone?: number; total?: number } | null } | null;
  render: { assetId: string; versionId: string; sizeBytes: number; durationMs: number | null } | null;
  timelineStale: boolean;
}

interface Thumb {
  id: string;
  isPrimary: boolean;
  asset: { versions: Array<{ id: string }> };
}

interface PublishState {
  clipStatus: string;
  approval: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'; expiresAt: string } | null;
  publishJob: {
    id: string; status: string; error: string | null;
    errorCode?: string | null; errorDetails?: Record<string, unknown> | null; retryable?: boolean;
    startedAt?: string | null;
    result: { youtubeVideoId?: string; url?: string } | null;
  } | null;
}

function useBlobUrl(versionId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!versionId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void apiClient.get(`/media/versions/${versionId}/file`, { responseType: 'blob' }).then((r) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(r.data as Blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [versionId]);
  return url;
}

function ThumbCard({ thumb, onPick }: { thumb: Thumb; onPick: () => void }) {
  const url = useBlobUrl(thumb.asset.versions[0]?.id);
  return (
    <button
      onClick={onPick}
      className={`relative rounded-xl overflow-hidden border-2 transition-colors ${thumb.isPrimary ? 'border-brand-500 ring-2 ring-brand-200' : 'border-transparent hover:border-gray-200'}`}
    >
      {url
        ? <img src={url} alt="Thumbnail option" className="w-full aspect-[9/16] object-cover" />
        : <div className="w-full aspect-[9/16] bg-gray-100 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-300" /></div>}
      {thumb.isPrimary && (
        <span className="absolute top-1.5 right-1.5 bg-brand-600 text-white rounded-full p-1"><Star className="w-3 h-3 fill-current" /></span>
      )}
    </button>
  );
}

/** Inline review card — approve or reject without leaving the export page. */
function InlineApprovalCard({ approvalId, onDone }: { approvalId: string; onDone: () => void }) {
  const [notes, setNotes] = useState('');
  const approveMutation = useMutation({ mutationFn: () => api.approvals.approve(approvalId, notes || undefined), onSuccess: onDone });
  const rejectMutation = useMutation({ mutationFn: () => api.approvals.reject(approvalId, notes || undefined), onSuccess: onDone });
  const busy = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5 mb-1">
        <ShieldCheck className="w-4 h-4" /> Review before publishing
      </p>
      <p className="text-xs text-amber-700 mb-3">Check the video preview on the left — then approve or reject.</p>
      <textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); }}
        placeholder="Optional notes for this review…"
        className="w-full text-sm border border-amber-200 rounded-lg px-3 py-2 mb-3 resize-none bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
        rows={2}
      />
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => { void approveMutation.mutate(); }}
          disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
          Approve
        </button>
        <button
          onClick={() => { void rejectMutation.mutate(); }}
          disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 bg-white border border-red-200 text-red-700 rounded-xl text-sm font-semibold hover:bg-red-50 disabled:opacity-50 transition-colors"
        >
          {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
          Reject
        </button>
      </div>
      {(approveMutation.isError || rejectMutation.isError) && (
        <p className="text-xs text-red-600 mt-2">
          {((approveMutation.error ?? rejectMutation.error) as { response?: { data?: { message?: string } } } | null)?.response?.data?.message ?? 'Action failed — please try again'}
        </p>
      )}
    </div>
  );
}

const PUBLISH_STEPS = [
  { key: 'compliance', label: 'Compliance audit', icon: ShieldAlert, doneAfterSecs: 25 },
  { key: 'upload',     label: 'Uploading to YouTube', icon: Wifi,        doneAfterSecs: 100 },
  { key: 'processing', label: 'YouTube is processing', icon: Loader2,     doneAfterSecs: 9999 },
] as const;

function PublishStepTimeline({ startedAt, jobStatus }: { startedAt?: string | null; jobStatus: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (jobStatus === 'PENDING') return;
    const t0 = startedAt ? new Date(startedAt).getTime() : Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - t0) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, jobStatus]);

  if (jobStatus === 'PENDING') {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600 py-1">
        <Clock className="w-4 h-4 text-brand-500 shrink-0" />
        Scheduled — waiting for publish time…
      </div>
    );
  }

  const activeIdx = PUBLISH_STEPS.findIndex((s) => elapsed < s.doneAfterSecs);
  const currentIdx = activeIdx === -1 ? PUBLISH_STEPS.length - 1 : activeIdx;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <Loader2 className="w-4 h-4 animate-spin text-brand-600" /> Publishing in progress
        </p>
        <span className="text-xs text-gray-400 font-mono tabular-nums">{fmt(elapsed)}</span>
      </div>
      <div className="space-y-1.5">
        {PUBLISH_STEPS.map((step, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          const StepIcon = step.icon;
          return (
            <div
              key={step.key}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-brand-50 border border-brand-100' : ''}`}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-green-500' : active ? 'bg-brand-600' : 'bg-gray-100'}`}>
                {done
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                  : active
                    ? <StepIcon className="w-3 h-3 text-white animate-spin" />
                    : <span className="text-[10px] text-gray-400 font-bold">{i + 1}</span>}
              </div>
              <span className={`flex-1 ${done ? 'text-gray-400 line-through' : active ? 'text-brand-700 font-semibold' : 'text-gray-400'}`}>
                {step.label}
              </span>
              {active && step.key === 'upload' && elapsed > 60 && (
                <span className="text-[11px] text-gray-400">Large files may take 2–3 min</span>
              )}
              {active && step.key === 'processing' && (
                <span className="text-[11px] text-gray-400">YouTube queued</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-400 mt-3">This page refreshes automatically — no need to reload.</p>
    </div>
  );
}

export default function ClipExportPage() {
  const { shortClipId } = useParams<{ shortClipId: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const handleReconnectYouTube = () => {
    sessionStorage.setItem('cf.oauth.returnUrl', `/shorts-studio/clips/${shortClipId}/export`);
    router.push('/library?tab=channels');
  };

  const { data: status } = useQuery<RenderStatus>({
    queryKey: ['render-status', shortClipId],
    queryFn: () => api.shortsStudio.renderStatus(shortClipId).then((r) => r.data as RenderStatus),
    refetchInterval: (q) => {
      const s = q.state.data?.renderJob?.status;
      return s === 'QUEUED' || s === 'RUNNING' || s === 'CHECKPOINTED' || q.state.data?.clipStatus === 'RENDERING' ? 3000 : false;
    },
  });

  const { data: thumbs = [] } = useQuery<Thumb[]>({
    queryKey: ['clip-thumbs', shortClipId],
    queryFn: () => api.shortsStudio.thumbnails(shortClipId).then((r) => r.data as Thumb[]),
    refetchInterval: (q) => ((q.state.data?.length ?? 0) === 0 ? 5000 : false),
  });

  const { data: pub } = useQuery<PublishState>({
    queryKey: ['publish-state', shortClipId],
    queryFn: () => api.shortsStudio.publishStatus(shortClipId).then((r) => r.data as PublishState),
    refetchInterval: (q) => {
      const s = q.state.data;
      const busy = s?.publishJob && ['PENDING', 'QUEUED', 'RUNNING'].includes(s.publishJob.status);
      const awaiting = s?.approval?.status === 'PENDING' || s?.clipStatus === 'EXPORTED' || s?.clipStatus === 'RENDERED';
      return busy ? 3000 : awaiting ? 8000 : false;
    },
  });

  const invalidatePub = () => { void qc.invalidateQueries({ queryKey: ['publish-state', shortClipId] }); };
  const [scheduledAt, setScheduledAt] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);

  const renderMutation = useMutation({
    mutationFn: () => api.shortsStudio.render(shortClipId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['render-status', shortClipId] }); },
  });
  const pickThumb = useMutation({
    mutationFn: (id: string) => api.shortsStudio.setPrimaryThumbnail(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['clip-thumbs', shortClipId] }); },
  });
  const exportMutation = useMutation({ mutationFn: () => api.shortsStudio.exportClip(shortClipId), onSuccess: invalidatePub });
  const requestPublish = useMutation({ mutationFn: () => api.shortsStudio.requestPublish(shortClipId), onSuccess: invalidatePub });
  const publishMutation = useMutation({
    mutationFn: () => api.shortsStudio.publish(shortClipId, scheduledAt || undefined),
    onSuccess: () => { setScheduledAt(''); setShowSchedule(false); invalidatePub(); },
  });

  const videoUrl = useBlobUrl(status?.render?.versionId);
  const rendering = status?.clipStatus === 'RENDERING' || status?.renderJob?.status === 'RUNNING' || status?.renderJob?.status === 'CHECKPOINTED';
  const renderFailed = status?.renderJob?.status === 'FAILED';
  const checkpoint = status?.renderJob?.checkpointData;
  const timelineStale = status?.timelineStale === true;

  const download = async () => {
    if (!status?.render) return;
    const res = await apiClient.get(`/media/versions/${status.render.versionId}/file`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `short-${shortClipId}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Derived publish state ──────────────────────────────────────────────────
  const clipStatus = pub?.clipStatus ?? '';
  const isExported = !['RENDERED', 'CANDIDATE', 'IN_EDITING', 'READY_FOR_RENDER'].includes(clipStatus);
  const approvalStatus = pub?.approval?.status;
  const isApproved = approvalStatus === 'APPROVED';
  const publishJobActive = pub?.publishJob && ['PENDING', 'QUEUED', 'RUNNING'].includes(pub.publishJob.status);
  const publishedVideoId = pub?.publishJob?.result?.youtubeVideoId;

  // ── Get error message from mutation ───────────────────────────────────────
  const mutationErrMsg = (err: unknown): string =>
    (err as { response?: { data?: { message?: string } } } | null)?.response?.data?.message ?? 'Action failed — please try again';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href={`/shorts-studio/clips/${shortClipId}/edit`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to editor
      </Link>

      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clapperboard className="w-6 h-6 text-brand-600" /> Export &amp; Publish
        </h1>
        <button
          onClick={() => { void renderMutation.mutate(); }}
          disabled={renderMutation.isPending || rendering}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 text-sm font-semibold transition-colors"
        >
          {rendering || renderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {status?.render ? 'Re-render' : 'Render clip'}
        </button>
      </div>

      {/* Stale render warning */}
      {timelineStale && !rendering && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Your edits haven't been rendered yet</p>
            <p className="text-xs text-amber-700 mt-0.5">The clip was edited after the last render. Click <strong>Re-render</strong> to produce the updated video.</p>
          </div>
        </div>
      )}

      {/* Render status bar */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-5 flex items-center gap-3">
        {rendering ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin text-brand-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-800">Rendering…</p>
              <p className="text-xs text-gray-500">
                Pass {status?.renderJob?.ffmpegPass ?? 1}
                {checkpoint?.total ? ` · segment ${checkpoint.segmentsDone ?? 0}/${checkpoint.total}` : ''}
              </p>
            </div>
          </>
        ) : renderFailed ? (
          <div className="flex-1">
            <JobErrorCard errorCode="FFMPEG_EXECUTION_FAILED" onRetry={() => { void renderMutation.mutate(); }} />
          </div>
        ) : status?.render ? (
          <>
            <CheckCircle2 className={`w-5 h-5 shrink-0 ${timelineStale ? 'text-amber-400' : 'text-green-500'}`} />
            <p className="text-sm text-gray-700">
              Rendered · {(status.render.sizeBytes / 1024 / 1024).toFixed(1)} MB
              {status.render.durationMs ? ` · ${Math.round(status.render.durationMs / 1000)}s` : ''}
              {timelineStale && <span className="ml-2 text-amber-600 font-medium">(outdated — re-render needed)</span>}
            </p>
            <button onClick={() => { void download(); }} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 border border-brand-200 text-brand-700 rounded-lg text-sm hover:bg-brand-50">
              <Download className="w-4 h-4" /> Download
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-500">Not rendered yet — click "Render clip" to start.</p>
        )}
      </div>

      {/* ── Publish to YouTube — integrated 3-step flow ── */}
      {status?.render && (
        <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm mb-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 flex items-center gap-1.5">
            <Upload className="w-4 h-4" /> Publish to YouTube
          </h2>

          {/* ── Published ── */}
          {publishedVideoId ? (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
              <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800">Published to YouTube!</p>
                <a
                  href={pub?.publishJob?.result?.url ?? `https://youtube.com/shorts/${publishedVideoId}`}
                  target="_blank" rel="noreferrer"
                  className="text-xs text-brand-600 hover:underline flex items-center gap-1 mt-0.5"
                >
                  Watch on YouTube <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

          ) : publishJobActive ? (
            /* ── Job running / scheduled ── */
            <PublishStepTimeline startedAt={pub?.publishJob?.startedAt} jobStatus={pub?.publishJob?.status ?? 'QUEUED'} />

          ) : (
            <div className="space-y-5">
              {/* Step 1 — Export package */}
              <div className="flex items-start gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${isExported ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'}`}>
                  {isExported ? <CheckCircle2 className="w-4 h-4" /> : '1'}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-800">Export package</p>
                    {isExported && (
                      <button
                        onClick={() => { void exportMutation.mutate(); }}
                        disabled={exportMutation.isPending || timelineStale}
                        className="text-xs text-gray-400 hover:text-brand-600 underline disabled:no-underline disabled:opacity-50"
                      >
                        {exportMutation.isPending ? 'Rebuilding…' : 'Re-export'}
                      </button>
                    )}
                  </div>
                  {isExported
                    ? <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Package ready</p>
                    : (
                      <button
                        onClick={() => { void exportMutation.mutate(); }}
                        disabled={exportMutation.isPending || timelineStale}
                        title={timelineStale ? 'Re-render the clip first — the timeline was edited after the last render' : undefined}
                        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {exportMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                        Build export package
                      </button>
                    )}
                  {exportMutation.isError && (
                    <p className="text-xs text-red-600 mt-1">{mutationErrMsg(exportMutation.error)}</p>
                  )}
                </div>
              </div>

              {/* Step 2 — Approval */}
              {isExported && (
                <div className="flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                    isApproved ? 'bg-green-500 text-white' : approvalStatus === 'PENDING' ? 'bg-amber-400 text-white' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {isApproved ? <CheckCircle2 className="w-4 h-4" /> : '2'}
                  </div>
                  <div className="flex-1">
                    {isApproved ? (
                      <p className="text-sm font-semibold text-green-700 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4" /> Review approved
                      </p>
                    ) : approvalStatus === 'PENDING' && pub?.approval ? (
                      <>
                        <p className="text-sm font-semibold text-gray-800 mb-2">Review required</p>
                        <InlineApprovalCard approvalId={pub.approval.id} onDone={invalidatePub} />
                      </>
                    ) : approvalStatus === 'REJECTED' ? (
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-sm text-red-600">Review rejected.</p>
                        <button
                          onClick={() => { void requestPublish.mutate(); }}
                          disabled={requestPublish.isPending}
                          className="text-sm text-brand-600 hover:underline flex items-center gap-1"
                        >
                          {requestPublish.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          Request new review
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-gray-800 mb-1">Request approval</p>
                        <p className="text-xs text-gray-500 mb-2">An internal review ensures the clip meets YouTube policy before upload.</p>
                        <button
                          onClick={() => { void requestPublish.mutate(); }}
                          disabled={requestPublish.isPending}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {requestPublish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                          Request approval
                        </button>
                      </>
                    )}
                    {requestPublish.isError && (
                      <p className="text-xs text-red-600 mt-1">{mutationErrMsg(requestPublish.error)}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3 — Publish / Schedule */}
              {isApproved && (
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-brand-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    3
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-800 mb-3">Publish to YouTube</p>

                    {!showSchedule ? (
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => { void publishMutation.mutate(); }}
                          disabled={publishMutation.isPending}
                          className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors shadow-sm"
                          style={{ background: 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' }}
                        >
                          {publishMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                          Publish Now
                        </button>
                        <button
                          onClick={() => { setShowSchedule(true); }}
                          className="flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          <CalendarClock className="w-4 h-4" /> Schedule
                        </button>
                      </div>
                    ) : (
                      <div className="bg-[#f5f2fd] rounded-xl p-4 border border-[#e3ddf8]">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                            <CalendarClock className="w-4 h-4" style={{ color: '#6D4AE0' }} /> Schedule for later
                          </p>
                          <button
                            onClick={() => { setShowSchedule(false); setScheduledAt(''); }}
                            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-white/60 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <input
                          type="datetime-local"
                          value={scheduledAt}
                          onChange={(e) => { setScheduledAt(e.target.value); }}
                          min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                          className="w-full border border-[#e3ddf8] bg-white rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-200 mb-2"
                        />
                        <p className="text-[11px] text-gray-400 mb-3">
                          The clip will be uploaded as private and set live at the scheduled time.
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => { void publishMutation.mutate(); }}
                            disabled={publishMutation.isPending || !scheduledAt}
                            className="flex items-center gap-1.5 px-4 py-2 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
                            style={{ background: scheduledAt ? 'linear-gradient(135deg, #6D4AE0 0%, #7c5ae8 100%)' : undefined, backgroundColor: !scheduledAt ? '#9ca3af' : undefined }}
                          >
                            {publishMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
                            Confirm Schedule
                          </button>
                          <button
                            onClick={() => { setShowSchedule(false); setScheduledAt(''); }}
                            className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {publishMutation.isError && (
                      <p className="text-xs text-red-600 mt-2">{mutationErrMsg(publishMutation.error)}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Publish job error (from previous failed job) */}
          {pub?.publishJob?.status === 'FAILED' && !publishJobActive && !publishedVideoId && (
            <JobErrorCard
              error={pub.publishJob.error}
              errorCode={pub.publishJob.errorCode}
              errorDetails={pub.publishJob.errorDetails}
              retryable={pub.publishJob.retryable}
              onRetry={() => { void publishMutation.mutate(); }}
              onReconnect={pub.publishJob.errorCode === 'YOUTUBE_AUTH_FAILED' ? handleReconnectYouTube : undefined}
              className="mt-4"
            />
          )}

          <p className="text-[11px] text-gray-400 mt-4 border-t border-gray-50 pt-3">
            Publishing runs a compliance audit and requires your review — no clip is uploaded without both.
          </p>
        </div>
      )}

      {/* Preview + Thumbnails */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Preview</h2>
          <div className="bg-black rounded-2xl overflow-hidden aspect-[9/16] max-h-[560px] flex items-center justify-center">
            {videoUrl
              // eslint-disable-next-line jsx-a11y/media-has-caption -- AI-generated preview; caption track not produced
              ? <video src={videoUrl} controls className="h-full w-full object-contain" />
              : <p className="text-gray-500 text-sm px-6 text-center">{rendering ? 'Rendering in progress…' : 'The rendered clip will appear here'}</p>}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Thumbnail</h2>
          {thumbs.length === 0 ? (
            <p className="text-sm text-gray-500">Thumbnails are generated automatically after the first render.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {thumbs.map((t) => (
                <ThumbCard key={t.id} thumb={t} onPick={() => { void pickThumb.mutate(t.id); }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
