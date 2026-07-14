import { isAv1Info, parseMediaProbe, withFfmpegRetries } from './ffmpeg.util';

describe('isAv1Info', () => {
  it('detects an AV1 video stream in ffmpeg -i output', () => {
    const banner =
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':\n" +
      '  Duration: 01:32:59.94, start: 0.000000, bitrate: 407 kb/s\n' +
      '  Stream #0:0[0x1](und): Video: av1 (Main) (av01 / 0x31307661), yuv420p(tv, bt709), 854x480\n' +
      '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo\n';
    expect(isAv1Info(banner)).toBe(true);
  });

  it('does not flag H.264 video or av1-like text outside a video stream line', () => {
    const banner =
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mp4':\n" +
      '  Metadata:\n' +
      '    compatible_brands: isomav01iso2mp41\n' +
      '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080\n' +
      '  Stream #0:1[0x2](und): Audio: wmav1, 44100 Hz, stereo\n';
    expect(isAv1Info(banner)).toBe(false);
  });
});

describe('parseMediaProbe', () => {
  const H264_BANNER =
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'video.mp4':\n" +
    '  Duration: 00:10:30.50, start: 0.000000, bitrate: 2500 kb/s\n' +
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080, 29.97 fps, 29.97 tbr\n' +
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo\n';

  const AV1_BANNER =
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'av1video.mp4':\n" +
    '  Duration: 01:32:59.94, start: 0.000000, bitrate: 407 kb/s\n' +
    '  Stream #0:0[0x1](und): Video: av1 (Main) (av01 / 0x31307661), yuv420p(tv, bt709), 854x480\n' +
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo\n';

  const NO_AUDIO_BANNER =
    "Input #0, matroska,webm, from 'video.mkv':\n" +
    '  Duration: 00:05:00.00, start: 0.000000, bitrate: 1200 kb/s\n' +
    '  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 24 fps\n';

  it('parses H.264 1080p banner correctly', () => {
    const result = parseMediaProbe(H264_BANNER);
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodec).toBe('aac');
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.fps).toBeCloseTo(29.97, 1);
    expect(result.bitrateKbps).toBe(2500);
    // 10 min 30.50s = 630500ms
    expect(result.durationMs).toBe(630500);
  });

  it('parses AV1 banner correctly', () => {
    const result = parseMediaProbe(AV1_BANNER);
    expect(result.videoCodec).toBe('av1');
    expect(result.audioCodec).toBe('aac');
    expect(result.width).toBe(854);
    expect(result.height).toBe(480);
    // 1h 32m 59.94s = 5579940ms
    expect(result.durationMs).toBe(5579940);
  });

  it('returns null audioCodec when no audio stream present', () => {
    const result = parseMediaProbe(NO_AUDIO_BANNER);
    expect(result.audioCodec).toBeNull();
    expect(result.videoCodec).toBe('h264');
    expect(result.durationMs).toBe(300000); // 5m = 300000ms
  });

  it('returns all nulls for empty string', () => {
    const result = parseMediaProbe('');
    expect(result.durationMs).toBeNull();
    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
    expect(result.fps).toBeNull();
    expect(result.bitrateKbps).toBeNull();
    expect(result.videoCodec).toBeNull();
    expect(result.audioCodec).toBeNull();
  });
});

describe('withFfmpegRetries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves immediately when fn succeeds on first try', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withFfmpegRetries(fn, 3, 0);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient EBUSY errors and succeeds on 3rd attempt', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('EBUSY: resource busy or locked'))
      .mockRejectedValueOnce(new Error('EBUSY: resource busy or locked'))
      .mockResolvedValue('done');

    const promise = withFfmpegRetries(fn, 3, 10);
    // advance timers for the delays
    await jest.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const nonTransientErr = new Error('Decoder hevc not found');
    const fn = jest.fn().mockRejectedValue(nonTransientErr);
    await expect(withFfmpegRetries(fn, 3, 10)).rejects.toThrow('Decoder hevc not found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting all attempts on persistent transient error', async () => {
    const err = new Error('Permission denied');
    const fn = jest.fn().mockRejectedValue(err);
    // Attach the rejection expectation BEFORE advancing timers — the final
    // rejection lands during runAllTimersAsync and would otherwise be an
    // unhandled rejection that fails the test run.
    const expectation = expect(withFfmpegRetries(fn, 3, 10)).rejects.toThrow('Permission denied');
    await jest.runAllTimersAsync();
    await expectation;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
