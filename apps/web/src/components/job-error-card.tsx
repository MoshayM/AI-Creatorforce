'use client';
import { useState } from 'react';
import { AlertCircle, RotateCcw, X, ChevronDown, ChevronRight } from 'lucide-react';

export type JobErrorCode =
  | 'FFMPEG_MISSING'
  | 'FFMPEG_EXECUTION_FAILED'
  | 'VIDEO_VALIDATION_FAILED'
  | 'CODEC_NOT_SUPPORTED'
  | 'VIDEO_IMPORT_FAILED'
  | 'TRANSCRIPTION_FAILED'
  | 'SCENE_DETECTION_FAILED'
  | 'STORAGE_FAILED'
  | 'CHAPTER_SYNC_FAILED'
  | 'YOUTUBE_UPLOAD_FAILED'
  | 'COMPLIANCE_FAILED'
  | 'JOB_FAILED';

interface ErrorCopy {
  title: string;
  desc: string | null; // null = use the job `error` sentence
  fix: string;
}

const CODE_COPY: Record<JobErrorCode, ErrorCopy> = {
  FFMPEG_MISSING: {
    title: 'Video engine unavailable',
    desc: 'The video processing engine is not installed on the server.',
    fix: 'Contact your administrator to repair the installation.',
  },
  FFMPEG_EXECUTION_FAILED: {
    title: 'Video processing failed',
    desc: 'Something went wrong while processing this video.',
    fix: 'Retry — if it keeps failing, report it.',
  },
  VIDEO_VALIDATION_FAILED: {
    title: 'Video cannot be processed',
    desc: null, // use job error sentence
    fix: 'Check the source video and re-import.',
  },
  CODEC_NOT_SUPPORTED: {
    title: 'Unsupported video format',
    desc: 'This video cannot be processed.',
    fix: 'Supported formats: MP4, MOV, MKV, AVI (H.264 recommended). Try re-importing — the importer now prefers H.264.',
  },
  VIDEO_IMPORT_FAILED: {
    title: 'Video import failed',
    desc: null, // use job error sentence
    fix: 'Retry the import; if it persists the video may be region-locked or private.',
  },
  TRANSCRIPTION_FAILED: {
    title: 'Transcript generation failed',
    desc: 'Something went wrong while generating the transcript.',
    fix: 'Retry — if it keeps failing, report it.',
  },
  SCENE_DETECTION_FAILED: {
    title: 'Scene detection failed',
    desc: 'Something went wrong while detecting scenes.',
    fix: 'Retry — if it keeps failing, report it.',
  },
  STORAGE_FAILED: {
    title: 'Storing the video failed',
    desc: 'The processed video could not be saved.',
    fix: 'Check disk space, then retry.',
  },
  CHAPTER_SYNC_FAILED: {
    title: 'Chapter sync failed',
    desc: null, // use the server's sentence — it names the actual YouTube reason
    fix: 'If the channel is read-only, connect it with YouTube access (Channels page) and retry. Only channels you own can be synced.',
  },
  YOUTUBE_UPLOAD_FAILED: {
    title: 'Upload to YouTube failed',
    desc: null, // use the server error — it contains the YouTube API reason
    fix: 'Retry the upload. If it keeps failing, re-connect your YouTube channel in Settings → Channels.',
  },
  COMPLIANCE_FAILED: {
    title: 'Content failed the compliance audit',
    desc: 'This clip did not pass the compliance check and cannot be published.',
    fix: 'Review the script and metadata for policy violations, then re-export.',
  },
  JOB_FAILED: {
    title: 'Video processing failed',
    desc: 'Something went wrong while processing this video.',
    fix: 'Retry — if it keeps failing, report it.',
  },
};

const GENERIC_COPY: ErrorCopy = {
  title: 'Video processing failed',
  desc: 'Something went wrong while processing this video.',
  fix: 'Retry — if it keeps failing, report it.',
};

/** Returns true when the error string looks like a raw technical dump
 *  (ffmpeg output, stack traces, very long strings, or multi-line text).
 *  Safe to render: short, single-line human sentences. */
function isTechnicalError(error: string): boolean {
  if (error.length > 200) return true;
  if (error.includes('\n')) return true;
  if (/ffmpeg|Stream #|Input #|stack|Error:/i.test(error)) return true;
  return false;
}

export interface JobErrorCardProps {
  error?: string | null;
  errorCode?: string | null;
  errorDetails?: Record<string, unknown> | null;
  retryable?: boolean;
  onRetry?: () => void;
  onRemove?: () => void;
  className?: string;
}

export function JobErrorCard({
  error,
  errorCode,
  errorDetails,
  retryable,
  onRetry,
  onRemove,
  className = '',
}: JobErrorCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Resolve copy for the error code
  const copy: ErrorCopy =
    errorCode && errorCode in CODE_COPY
      ? CODE_COPY[errorCode as JobErrorCode]
      : GENERIC_COPY;

  // Resolve description: use copy.desc when set; otherwise try to use the job
  // `error` string — but only if it looks like a clean human sentence.
  let description: string;
  if (copy.desc !== null) {
    description = copy.desc;
  } else if (error && !isTechnicalError(error)) {
    description = error;
  } else {
    // Legacy technical dump or no errorCode — fall back to generic desc
    description = GENERIC_COPY.desc!;
  }

  const showRetry = !!onRetry && retryable !== false;
  const showRemove = !!onRemove;
  const showDetails = !!errorDetails;

  return (
    <div
      role="alert"
      className={`rounded-xl border border-red-200 bg-red-50 p-4 ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-800">{copy.title}</p>
          <p className="text-xs text-red-700 mt-0.5">{description}</p>
          <p className="text-xs text-red-600 mt-1 italic">{copy.fix}</p>

          {(showRetry || showRemove || showDetails) && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {showRetry && (
                <button
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-100 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" /> Retry
                </button>
              )}
              {showRemove && (
                <button
                  onClick={onRemove}
                  className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <X className="w-3 h-3" /> Remove
                </button>
              )}
              {showDetails && (
                <button
                  onClick={() => setDetailsOpen((o) => !o)}
                  className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800 ml-auto"
                >
                  {detailsOpen
                    ? <><ChevronDown className="w-3.5 h-3.5" /> Hide technical details</>
                    : <><ChevronRight className="w-3.5 h-3.5" /> View technical details</>}
                </button>
              )}
            </div>
          )}

          {showDetails && detailsOpen && (
            <div className="mt-3 space-y-2">
              {error && (
                <div>
                  <p className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-1">Error message</p>
                  <pre className="text-[11px] bg-red-100 border border-red-200 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap font-mono text-red-900 max-h-40">
                    {error}
                  </pre>
                </div>
              )}
              <div>
                <p className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-1">Technical details</p>
                <pre className="text-[11px] bg-red-100 border border-red-200 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap font-mono text-red-900 max-h-64">
                  {JSON.stringify(errorDetails, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
