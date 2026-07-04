import { checkDurations, analyzeLoudness, type QualityFinding } from './quality.util';

// ── checkDurations ────────────────────────────────────────────────────────────

describe('checkDurations', () => {
  it('returns ok findings when everything looks healthy', () => {
    const findings = checkDurations({
      totalSceneSecs: 120,
      voiceDurationMs: 118_000,
      scriptEstimateMins: 2,
      lastCueEndMs: 119_000,
    });
    expect(findings.every((f) => f.level === 'ok')).toBe(true);
  });

  it('warns when total scene duration is below 10 s', () => {
    const findings = checkDurations({ totalSceneSecs: 5 });
    const warn = findings.find((f) => f.check === 'min-duration');
    expect(warn?.level).toBe('warn');
  });

  it('warns when there is no voice asset', () => {
    const findings = checkDurations({ totalSceneSecs: 60 });
    const warn = findings.find((f) => f.check === 'voice-present');
    expect(warn?.level).toBe('warn');
    expect(warn?.message).toMatch(/silent/i);
  });

  it('warns when voice duration deviates > 60 % from script estimate', () => {
    // script estimate = 2 min = 120 s; voice = 200 s → 66.7% deviation
    const findings = checkDurations({
      totalSceneSecs: 120,
      voiceDurationMs: 200_000,
      scriptEstimateMins: 2,
    });
    const warn = findings.find((f) => f.check === 'voice-script-mismatch');
    expect(warn?.level).toBe('warn');
    expect(warn?.message).toMatch(/deviates/i);
  });

  it('does not warn when voice deviation is within 60 %', () => {
    // script estimate = 2 min = 120 s; voice = 140 s → 16.7% deviation — ok
    const findings = checkDurations({
      totalSceneSecs: 120,
      voiceDurationMs: 140_000,
      scriptEstimateMins: 2,
    });
    const entry = findings.find((f) => f.check === 'voice-script-mismatch');
    expect(entry?.level).toBe('ok');
  });

  it('warns when last subtitle cue overruns total scene duration + 5 s grace', () => {
    // totalSceneSecs = 60 → limit = 65 000 ms; lastCueEndMs = 70 000 → overrun
    const findings = checkDurations({
      totalSceneSecs: 60,
      voiceDurationMs: 58_000,
      lastCueEndMs: 70_000,
    });
    const warn = findings.find((f) => f.check === 'subtitle-overrun');
    expect(warn?.level).toBe('warn');
    expect(warn?.message).toMatch(/beyond/i);
  });

  it('does not warn on subtitle cue within the grace window', () => {
    const findings = checkDurations({
      totalSceneSecs: 60,
      voiceDurationMs: 58_000,
      lastCueEndMs: 64_000, // within 60 + 5 s grace
    });
    const entry = findings.find((f) => f.check === 'subtitle-overrun');
    expect(entry?.level).toBe('ok');
  });

  it('emits no subtitle-overrun finding when no subtitle data is provided', () => {
    const findings = checkDurations({ totalSceneSecs: 60, voiceDurationMs: 58_000 });
    expect(findings.find((f) => f.check === 'subtitle-overrun')).toBeUndefined();
  });
});

// ── analyzeLoudness ──────────────────────────────────────────────────────────

/** Build a canned volumedetect output string mimicking ffmpeg stderr. */
function fakeVolumedetect(meanDb: number): string {
  return [
    '[Parsed_volumedetect_0 @ 0x...] n_samples: 1024000',
    `[Parsed_volumedetect_0 @ 0x...] mean_volume: ${meanDb.toFixed(1)} dB`,
    `[Parsed_volumedetect_0 @ 0x...] max_volume: ${(meanDb + 10).toFixed(1)} dB`,
  ].join('\n');
}

describe('analyzeLoudness', () => {
  it('returns a fixed finding with adjusted volume when music is too loud', async () => {
    // voice = -18 dBFS, music = -14 dBFS → music > voice − 6 dB (−14 > −24) → fix
    const voiceOutput = fakeVolumedetect(-18);
    const musicOutput = fakeVolumedetect(-14);

    const ffmpegRun = jest.fn()
      .mockResolvedValueOnce(voiceOutput)  // voice
      .mockResolvedValueOnce(musicOutput); // music

    const { findings, musicVolumeAdjust } = await analyzeLoudness(
      ffmpegRun,
      '/tmp/voice.wav',
      '/tmp/music.wav',
    );

    const fixed = findings.find((f: QualityFinding) => f.check === 'loudness-balance');
    expect(fixed?.level).toBe('fixed');
    expect(musicVolumeAdjust).toBeDefined();
    // Adjust must be clamped to [0.05, 0.22]
    expect(musicVolumeAdjust!).toBeGreaterThanOrEqual(0.05);
    expect(musicVolumeAdjust!).toBeLessThanOrEqual(0.22);
    // With music at -14 and voice at -18, music is too loud → adjust < 0.22
    expect(musicVolumeAdjust!).toBeLessThan(0.22);
  });

  it('returns ok when music is already sufficiently under voice', async () => {
    // voice = -18 dBFS, music = -26 dBFS → music < voice − 6 dB → ok
    const ffmpegRun = jest.fn()
      .mockResolvedValueOnce(fakeVolumedetect(-18))
      .mockResolvedValueOnce(fakeVolumedetect(-26));

    const { findings, musicVolumeAdjust } = await analyzeLoudness(ffmpegRun, '/tmp/voice.wav', '/tmp/music.wav');

    const entry = findings.find((f: QualityFinding) => f.check === 'loudness-balance');
    expect(entry?.level).toBe('ok');
    expect(musicVolumeAdjust).toBeUndefined();
  });

  it('returns a warn finding when output is unparseable', async () => {
    const ffmpegRun = jest.fn().mockResolvedValue('some garbage output with no volume info');

    const { findings } = await analyzeLoudness(ffmpegRun, '/tmp/voice.wav', undefined);

    const warn = findings.find((f: QualityFinding) => f.level === 'warn');
    expect(warn).toBeDefined();
  });

  it('does not throw when ffmpegRun rejects', async () => {
    const ffmpegRun = jest.fn().mockRejectedValue(new Error('ffmpeg not found'));

    // Should resolve (not throw) even when the subprocess fails
    await expect(analyzeLoudness(ffmpegRun, '/tmp/voice.wav', '/tmp/music.wav')).resolves.toBeDefined();

    const { findings } = await analyzeLoudness(ffmpegRun, '/tmp/voice.wav', undefined);
    expect(findings.some((f: QualityFinding) => f.level === 'warn')).toBe(true);
  });

  it('returns empty findings when no paths are provided', async () => {
    const ffmpegRun = jest.fn();
    const { findings, musicVolumeAdjust } = await analyzeLoudness(ffmpegRun);
    expect(findings).toHaveLength(0);
    expect(musicVolumeAdjust).toBeUndefined();
    expect(ffmpegRun).not.toHaveBeenCalled();
  });

  it('returns loudness-voice ok finding when only voice is provided and parseable', async () => {
    const ffmpegRun = jest.fn().mockResolvedValue(fakeVolumedetect(-20));
    const { findings } = await analyzeLoudness(ffmpegRun, '/tmp/voice.wav', undefined);
    const entry = findings.find((f: QualityFinding) => f.check === 'loudness-voice');
    expect(entry?.level).toBe('ok');
  });
});
