import { buildSrt, buildVtt, fitCuesToDuration, type CueLike } from './subtitle.util';

// ── buildSrt ──────────────────────────────────────────────────────────────────

describe('buildSrt', () => {
  const cues: CueLike[] = [
    { index: 1, startMs: 0, endMs: 3000, text: 'Hello world' },
    { index: 2, startMs: 3500, endMs: 7200, text: 'Second line' },
  ];

  it('produces correctly formatted SRT timestamps', () => {
    const out = buildSrt(cues);
    expect(out).toContain('00:00:00,000 --> 00:00:03,000');
    expect(out).toContain('00:00:03,500 --> 00:00:07,200');
  });

  it('uses the comma separator (SRT format, not VTT)', () => {
    const out = buildSrt(cues);
    expect(out).not.toMatch(/\d\d:\d\d:\d\d\.\d\d\d/); // no dot separator
    expect(out).toMatch(/\d\d:\d\d:\d\d,\d\d\d/);
  });

  it('includes each cue index and text', () => {
    const out = buildSrt(cues);
    expect(out).toContain('1\n');
    expect(out).toContain('Hello world');
    expect(out).toContain('2\n');
    expect(out).toContain('Second line');
  });

  it('auto-assigns 1-based index when cue.index is undefined', () => {
    const noCueCues: CueLike[] = [
      { startMs: 0, endMs: 1000, text: 'A' },
      { startMs: 1500, endMs: 2500, text: 'B' },
    ];
    const out = buildSrt(noCueCues);
    expect(out.startsWith('1\n')).toBe(true);
    expect(out).toContain('2\n');
  });

  it('joins cues with a blank line separator', () => {
    const out = buildSrt(cues);
    expect(out).toContain('\n\n');
  });

  it('handles a single cue without error', () => {
    const out = buildSrt([{ index: 1, startMs: 500, endMs: 2000, text: 'Only' }]);
    expect(out).toContain('Only');
    expect(out).toContain('00:00:00,500 --> 00:00:02,000');
  });

  it('correctly formats hours when ms >= 3 600 000', () => {
    const out = buildSrt([{ index: 1, startMs: 3_661_000, endMs: 3_661_500, text: 'Late' }]);
    expect(out).toContain('01:01:01,000 --> 01:01:01,500');
  });
});

// ── buildVtt ──────────────────────────────────────────────────────────────────

describe('buildVtt', () => {
  const cues: CueLike[] = [
    { startMs: 0, endMs: 2000, text: 'VTT first' },
    { startMs: 2500, endMs: 5000, text: 'VTT second' },
  ];

  it('starts with the WEBVTT header', () => {
    expect(buildVtt(cues).startsWith('WEBVTT\n')).toBe(true);
  });

  it('uses the dot separator (VTT format, not SRT)', () => {
    const out = buildVtt(cues);
    expect(out).toContain('00:00:00.000 --> 00:00:02.000');
    expect(out).not.toMatch(/\d\d:\d\d:\d\d,\d\d\d/); // no comma separator
  });

  it('includes all cue texts', () => {
    const out = buildVtt(cues);
    expect(out).toContain('VTT first');
    expect(out).toContain('VTT second');
  });
});

// ── fitCuesToDuration ─────────────────────────────────────────────────────────

describe('fitCuesToDuration', () => {
  /** Build a simple array of cues whose last cue ends at lastMs. */
  function makeCues(lastMs: number): CueLike[] {
    return [
      { index: 1, startMs: 0, endMs: Math.round(lastMs * 0.4), text: 'A' },
      { index: 2, startMs: Math.round(lastMs * 0.45), endMs: Math.round(lastMs * 0.8), text: 'B' },
      { index: 3, startMs: Math.round(lastMs * 0.85), endMs: lastMs, text: 'C' },
    ];
  }

  describe('no-op cases (scaled: false)', () => {
    it('returns original cues unchanged when last cue fits within target', () => {
      const cues = makeCues(250_000); // last cue at 250 s
      const { cues: out, scaled } = fitCuesToDuration(cues, 300_000); // target 300 s
      expect(scaled).toBe(false);
      expect(out).toBe(cues); // same reference
    });

    it('returns original cues unchanged when last cue is within the grace window', () => {
      // last at 304 000 ms, target 300 000 ms, grace 5 000 ms → 304 000 ≤ 305 000 → no-op
      const cues = makeCues(304_000);
      const { scaled } = fitCuesToDuration(cues, 300_000, 5000);
      expect(scaled).toBe(false);
    });

    it('returns no-op when targetMs is 0', () => {
      const { scaled } = fitCuesToDuration(makeCues(300_000), 0);
      expect(scaled).toBe(false);
    });

    it('returns no-op when targetMs is negative', () => {
      const { scaled } = fitCuesToDuration(makeCues(300_000), -1);
      expect(scaled).toBe(false);
    });

    it('returns no-op for empty cues array', () => {
      const { cues, scaled } = fitCuesToDuration([], 300_000);
      expect(scaled).toBe(false);
      expect(cues).toHaveLength(0);
    });
  });

  describe('scaling cases (scaled: true)', () => {
    it('sets scaled: true when cues overrun by more than graceMs', () => {
      // last cue at 497 s on a 300 s video — 197 s overrun
      const cues = makeCues(497_000);
      const { scaled } = fitCuesToDuration(cues, 300_000);
      expect(scaled).toBe(true);
    });

    it('ensures the last scaled cue ends at or before targetMs', () => {
      const cues = makeCues(497_000);
      const { cues: out } = fitCuesToDuration(cues, 300_000);
      const lastEnd = Math.max(...out.map((c) => c.endMs));
      expect(lastEnd).toBeLessThanOrEqual(300_000);
    });

    it('preserves proportional ordering (startMs of C > startMs of B)', () => {
      const cues = makeCues(497_000);
      const { cues: out } = fitCuesToDuration(cues, 300_000);
      expect(out[2]!.startMs).toBeGreaterThan(out[1]!.startMs);
      expect(out[1]!.startMs).toBeGreaterThan(out[0]!.startMs);
    });

    it('each scaled cue has at least 300 ms visibility', () => {
      const cues = makeCues(497_000);
      const { cues: out } = fitCuesToDuration(cues, 300_000);
      for (const c of out) {
        expect(c.endMs - c.startMs).toBeGreaterThanOrEqual(300);
      }
    });

    it('preserves extra properties from the original cue (generic T)', () => {
      type ExtCue = CueLike & { sectionRef: string };
      const extCues: ExtCue[] = [
        { index: 1, startMs: 0, endMs: 200_000, text: 'X', sectionRef: 'intro' },
        { index: 2, startMs: 210_000, endMs: 497_000, text: 'Y', sectionRef: 'body' },
      ];
      const { cues: out } = fitCuesToDuration(extCues, 300_000);
      expect((out[0] as ExtCue).sectionRef).toBe('intro');
      expect((out[1] as ExtCue).sectionRef).toBe('body');
    });

    it('scales proportionally: mid cue is roughly at the same relative position', () => {
      // With 3 cues, middle cue (B) ends at 80% of 497 s ≈ 397.6 s.
      // After rescaling to 300 s: expected end ≈ 300 * (397600/497000) ≈ 240 s.
      const cues = makeCues(497_000);
      const { cues: out } = fitCuesToDuration(cues, 300_000);
      const factor = 300_000 / 497_000;
      const expectedEndB = Math.round(Math.round(497_000 * 0.8) * factor);
      expect(out[1]!.endMs).toBe(expectedEndB);
    });
  });

  describe('custom graceMs', () => {
    it('triggers scaling when overrun exceeds custom grace', () => {
      // last = 310 000, target = 300 000, grace = 5 000 → 310 000 > 305 000 → scale
      const { scaled } = fitCuesToDuration(makeCues(310_000), 300_000, 5000);
      expect(scaled).toBe(true);
    });

    it('does not scale when overrun is within custom grace', () => {
      // last = 303 000, target = 300 000, grace = 5 000 → 303 000 ≤ 305 000 → no-op
      const { scaled } = fitCuesToDuration(makeCues(303_000), 300_000, 5000);
      expect(scaled).toBe(false);
    });
  });
});
