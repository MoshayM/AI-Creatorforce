import { MEDIA_ERROR_RETRYABLE, type MediaErrorCode } from '@cf/shared';

/**
 * Base class for all typed media pipeline errors.
 * userMessage: safe to show end users — never contains paths, stderr, or commands.
 * reason: one-line human explanation, also safe for users.
 * details: admin-only technical payload (exitCode, stderrTail, command, etc.).
 */
export class MediaPipelineError extends Error {
  constructor(
    readonly code: MediaErrorCode,
    userMessage: string,
    readonly reason: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(userMessage);
    this.name = new.target.name;
  }

  get retryable(): boolean {
    return MEDIA_ERROR_RETRYABLE[this.code];
  }
}

export class FFmpegMissingError extends MediaPipelineError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('FFMPEG_MISSING', 'Video engine is not installed.', reason, details);
  }
}

export class FFmpegExecutionError extends MediaPipelineError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('FFMPEG_EXECUTION_FAILED', 'Video processing failed.', reason, details);
  }
}

export class VideoValidationError extends MediaPipelineError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('VIDEO_VALIDATION_FAILED', 'This video cannot be processed.', reason, details);
  }
}

export class CodecNotSupportedError extends MediaPipelineError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('CODEC_NOT_SUPPORTED', 'This video uses an unsupported format.', reason, details);
  }
}

export class ImportPipelineError extends MediaPipelineError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('VIDEO_IMPORT_FAILED', 'Video import failed.', reason, details);
  }
}

export class TranscriptionError extends MediaPipelineError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('TRANSCRIPTION_FAILED', 'Transcript generation failed.', reason, details);
  }
}

export class SceneDetectionError extends MediaPipelineError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('SCENE_DETECTION_FAILED', 'Scene detection failed.', reason, details);
  }
}

export class StorageError extends MediaPipelineError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('STORAGE_FAILED', 'Storing the video failed.', reason, details);
  }
}

export class YoutubeAuthFailedError extends MediaPipelineError {
  constructor(reason: string, details?: Record<string, unknown>) {
    super('YOUTUBE_AUTH_FAILED', 'Your YouTube authorization has expired. Please reconnect your channel.', reason, details);
  }
}

/**
 * Map any thrown error to a structured job failure payload for persisting in AgentJob.
 * - MediaPipelineError: extracts typed fields.
 * - Other errors: scrubs ffmpeg/stderr content from the user-facing message.
 */
export function toJobFailure(err: unknown): {
  error: string;
  errorCode: MediaErrorCode;
  errorDetails: Record<string, unknown>;
} {
  if (err instanceof MediaPipelineError) {
    const userMessage = err.message;
    const combined = `${userMessage} ${err.reason}`.trim();
    return {
      error: combined,
      errorCode: err.code,
      errorDetails: {
        ...(err.details ?? {}),
        reason: err.reason,
        stack: (err.stack ?? '').slice(0, 2000),
      },
    };
  }

  const rawMsg = err instanceof Error ? err.message : String(err);
  // Scrub technical noise (ffmpeg paths, stream descriptors, long stderr dumps)
  const isTechnical =
    /ffmpeg|stderr|Stream #\d|Input #\d/i.test(rawMsg) || rawMsg.length > 300;
  const safeMsg = isTechnical ? 'Video processing failed.' : rawMsg;

  return {
    error: safeMsg,
    errorCode: 'JOB_FAILED',
    errorDetails: {
      originalMessage: rawMsg.slice(0, 2000),
      stack: (err instanceof Error ? err.stack ?? '' : '').slice(0, 2000),
    },
  };
}
