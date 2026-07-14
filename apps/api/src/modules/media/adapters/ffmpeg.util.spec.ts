import { isAv1Info } from './ffmpeg.util';

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
