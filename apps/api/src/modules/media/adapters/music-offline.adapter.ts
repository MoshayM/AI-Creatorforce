import type { MusicAdapter, MusicRequest, GeneratedMedia } from '../media.types';
import { encodeWav } from './codec.util';

const SAMPLE_RATE = 22050;

// I–V–vi–IV in C major, as frequency triads
const PROGRESSION: number[][] = [
  [261.63, 329.63, 392.0], // C
  [392.0, 493.88, 587.33], // G
  [220.0, 261.63, 329.63], // Am
  [349.23, 440.0, 523.25], // F
];

const ENERGY_GAIN: Record<MusicRequest['energy'], number> = {
  low: 0.10,
  medium: 0.14,
  high: 0.18,
  dynamic: 0.14,
};

/**
 * Royalty-free background music generated in-process (update.txt: "If AI
 * generation unavailable, generate royalty-free selection automatically").
 * Synthesizes an ambient chord-pad loop matched to the brief's BPM, energy
 * and duration, with fade-in/out so it sits under narration.
 */
export class OfflineMusicAdapter implements MusicAdapter {
  readonly name = 'offline-synth-music';

  available(): boolean {
    // Placeholders are opt-in only (master prompt hard rule 1): without this
    // flag a stage with no real provider FAILS instead of fabricating output.
    return process.env['ALLOW_OFFLINE_MEDIA'] === 'true';
  }

  compose(req: MusicRequest): Promise<GeneratedMedia> {
    const durationSecs = Math.min(Math.max(req.durationSecs, 10), 1200);
    const total = Math.round(durationSecs * SAMPLE_RATE);
    const samples = new Float32Array(total);
    const barSecs = (60 / Math.max(40, Math.min(200, req.bpm))) * 4;
    const gain = ENERGY_GAIN[req.energy] ?? 0.14;
    const fade = Math.round(2 * SAMPLE_RATE);

    for (let i = 0; i < total; i++) {
      const t = i / SAMPLE_RATE;
      const chord = PROGRESSION[Math.floor(t / barSecs) % PROGRESSION.length]!;
      let s = 0;
      for (const f of chord) {
        // Pad voicing: fundamental + soft octave, slow tremolo for movement
        s += Math.sin(2 * Math.PI * f * t) * 0.5;
        s += Math.sin(2 * Math.PI * f * 0.5 * t) * 0.3;
      }
      const tremolo = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.5 * t);
      const env = Math.min(1, i / fade, (total - i) / fade);
      samples[i] = gain * env * tremolo * (s / 3);
    }

    return Promise.resolve({
      buffer: encodeWav(samples, SAMPLE_RATE),
      mimeType: 'audio/wav',
      ext: 'wav',
      durationMs: Math.round(durationSecs * 1000),
      model: 'offline-chordpad-synth',
      notes: `Royalty-free generated pad (${req.genre}, ${req.mood}, ${req.bpm} BPM) — swap in an AI music provider for produced tracks.`,
    });
  }
}
