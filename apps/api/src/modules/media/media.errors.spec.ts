import { MediaPipelineError, FFmpegMissingError, FFmpegExecutionError, VideoValidationError, CodecNotSupportedError, ImportPipelineError, TranscriptionError, SceneDetectionError, toJobFailure } from './media.errors';

describe('MediaPipelineError subclasses', () => {
  it('FFmpegMissingError has correct code, userMessage, retryable=false', () => {
    const err = new FFmpegMissingError('binary not found');
    expect(err.code).toBe('FFMPEG_MISSING');
    expect(err.message).toBe('Video engine is not installed.');
    expect(err.reason).toBe('binary not found');
    expect(err.retryable).toBe(false);
    expect(err instanceof MediaPipelineError).toBe(true);
  });

  it('FFmpegExecutionError has retryable=true', () => {
    const err = new FFmpegExecutionError('engine crashed', { exitCode: 1 });
    expect(err.code).toBe('FFMPEG_EXECUTION_FAILED');
    expect(err.retryable).toBe(true);
    expect(err.details).toEqual({ exitCode: 1 });
  });

  it('VideoValidationError has retryable=false', () => {
    const err = new VideoValidationError('no video stream');
    expect(err.code).toBe('VIDEO_VALIDATION_FAILED');
    expect(err.retryable).toBe(false);
  });

  it('CodecNotSupportedError has retryable=false', () => {
    const err = new CodecNotSupportedError('codec not supported');
    expect(err.code).toBe('CODEC_NOT_SUPPORTED');
    expect(err.retryable).toBe(false);
  });

  it('ImportPipelineError has retryable=true', () => {
    const err = new ImportPipelineError('yt-dlp failed');
    expect(err.code).toBe('VIDEO_IMPORT_FAILED');
    expect(err.retryable).toBe(true);
  });

  it('SceneDetectionError has retryable=true', () => {
    const err = new SceneDetectionError('scene detection failed');
    expect(err.code).toBe('SCENE_DETECTION_FAILED');
    expect(err.retryable).toBe(true);
  });
});

describe('toJobFailure', () => {
  it('maps MediaPipelineError to typed failure', () => {
    const err = new FFmpegExecutionError('engine crashed', { exitCode: 1, stderrTail: 'some error' });
    const result = toJobFailure(err);
    expect(result.errorCode).toBe('FFMPEG_EXECUTION_FAILED');
    expect(result.error).toBe('Video processing failed. engine crashed');
    expect(result.errorDetails).toMatchObject({ exitCode: 1, reason: 'engine crashed' });
  });

  it('scrubs ffmpeg noise from generic errors', () => {
    const err = new Error('ffmpeg failed: Stream #0:0 blah blah long message about codecs');
    const result = toJobFailure(err);
    expect(result.errorCode).toBe('JOB_FAILED');
    expect(result.error).toBe('Video processing failed.');
    expect(result.errorDetails).toHaveProperty('originalMessage');
  });

  it('keeps short clean error messages', () => {
    const err = new Error('Project not found');
    const result = toJobFailure(err);
    expect(result.errorCode).toBe('JOB_FAILED');
    expect(result.error).toBe('Project not found');
  });

  it('handles non-Error thrown values', () => {
    const result = toJobFailure('something went wrong');
    expect(result.errorCode).toBe('JOB_FAILED');
    expect(result.error).toBe('something went wrong');
  });

  it('truncates very long messages', () => {
    const err = new Error('x'.repeat(400));
    const result = toJobFailure(err);
    expect(result.error).toBe('Video processing failed.');
  });
});
