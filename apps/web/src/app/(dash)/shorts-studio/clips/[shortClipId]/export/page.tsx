'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Clapperboard, Download, Star, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { api, apiClient } from '@/lib/api';

interface RenderStatus {
  clipStatus: string | null;
  renderJob: { status: 'QUEUED' | 'RUNNING' | 'CHECKPOINTED' | 'COMPLETE' | 'FAILED'; ffmpegPass: number; checkpointData: { segmentsDone?: number; total?: number } | null } | null;
  render: { assetId: string; versionId: string; sizeBytes: number; durationMs: number | null } | null;
}

interface Thumb {
  id: string;
  isPrimary: boolean;
  asset: { versions: Array<{ id: string }> };
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
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt="Thumbnail option" className="w-full aspect-[9/16] object-cover" />
        : <div className="w-full aspect-[9/16] bg-gray-100 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-300" /></div>}
      {thumb.isPrimary && (
        <span className="absolute top-1.5 right-1.5 bg-brand-600 text-white rounded-full p-1"><Star className="w-3 h-3 fill-current" /></span>
      )}
    </button>
  );
}

export default function ClipExportPage() {
  const { shortClipId } = useParams<{ shortClipId: string }>();
  const qc = useQueryClient();

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

  const renderMutation = useMutation({
    mutationFn: () => api.shortsStudio.render(shortClipId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['render-status', shortClipId] }),
  });

  const pickThumb = useMutation({
    mutationFn: (id: string) => api.shortsStudio.setPrimaryThumbnail(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['clip-thumbs', shortClipId] }),
  });

  const videoUrl = useBlobUrl(status?.render?.versionId);
  const rendering = status?.clipStatus === 'RENDERING' || status?.renderJob?.status === 'RUNNING' || status?.renderJob?.status === 'CHECKPOINTED';
  const failed = status?.renderJob?.status === 'FAILED';
  const checkpoint = status?.renderJob?.checkpointData;

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

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link href={`/shorts-studio/clips/${shortClipId}/edit`} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to editor
      </Link>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Clapperboard className="w-6 h-6 text-brand-600" /> Export
        </h1>
        <button
          onClick={() => renderMutation.mutate()}
          disabled={renderMutation.isPending || rendering}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {rendering || renderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {status?.render ? 'Re-render' : 'Render clip'}
        </button>
      </div>

      {/* Status */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-6 flex items-center gap-3">
        {rendering ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
            <div>
              <p className="text-sm font-medium text-gray-800">Rendering…</p>
              <p className="text-xs text-gray-400">
                Pass {status?.renderJob?.ffmpegPass ?? 1}
                {checkpoint?.total ? ` · segment ${checkpoint.segmentsDone ?? 0}/${checkpoint.total}` : ''}
              </p>
            </div>
          </>
        ) : failed ? (
          <>
            <XCircle className="w-5 h-5 text-red-500" />
            <p className="text-sm text-red-600">Render failed — check the project's job log, then try again.</p>
          </>
        ) : status?.render ? (
          <>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <p className="text-sm text-gray-700">
              Rendered · {(status.render.sizeBytes / 1024 / 1024).toFixed(1)} MB
              {status.render.durationMs ? ` · ${Math.round(status.render.durationMs / 1000)}s` : ''}
            </p>
            <button onClick={() => void download()} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 border border-brand-200 text-brand-700 rounded-lg text-sm hover:bg-brand-50">
              <Download className="w-4 h-4" /> Download MP4
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-400">Not rendered yet — click "Render clip" to produce the vertical video.</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Preview */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Preview</h2>
          <div className="bg-black rounded-2xl overflow-hidden aspect-[9/16] max-h-[560px] flex items-center justify-center">
            {videoUrl
              ? <video src={videoUrl} controls className="h-full w-full object-contain" />
              : <p className="text-gray-500 text-sm px-6 text-center">{rendering ? 'Rendering in progress…' : 'The rendered clip will appear here'}</p>}
          </div>
        </div>

        {/* Thumbnails */}
        <div>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Thumbnail</h2>
          {thumbs.length === 0 ? (
            <p className="text-sm text-gray-400">Thumbnails are generated automatically after the first render.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {thumbs.map((t) => (
                <ThumbCard key={t.id} thumb={t} onPick={() => pickThumb.mutate(t.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
