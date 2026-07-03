import type { VoiceAdapter, VoiceRequest, GeneratedMedia } from '../media.types';
import { encodeWav } from './codec.util';

const WORDS_PER_SECOND = 2.5;
const SAMPLE_RATE = 22050;

/**
 * Always-available fallback voice track: a timing-accurate narration
 * placeholder (soft tone following speech cadence, silence between
 * sentences). Duration matches what real TTS of the text would take, so
 * timelines, subtitles, and renders stay in sync — the track is swapped for
 * real TTS the moment a voice provider key is configured. Provenance is
 * honestly labeled; this is never presented as real narration.
 */
export class OfflineVoiceAdapter implements VoiceAdapter {
  readonly name = 'offline-synth-voice';

  available(): boolean {
    return true;
  }

  synthesize(req: VoiceRequest): Promise<GeneratedMedia> {
    const sentences = req.text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    const speed = req.speed ?? 1;
    const chunks: number[] = [];

    for (const sentence of sentences) {
      const words = sentence.trim().split(/\s+/).length;
      const secs = Math.max(0.8, words / (WORDS_PER_SECOND * speed));
      const n = Math.round(secs * SAMPLE_RATE);
      // Soft hum with word-cadence amplitude modulation
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const cadence = 0.5 + 0.5 * Math.sin(2 * Math.PI * (WORDS_PER_SECOND * speed) * t);
        const env = Math.min(1, i / 800, (n - i) / 800);
        chunks.push(0.08 * env * cadence * Math.sin(2 * Math.PI * 180 * t));
      }
      // Inter-sentence pause
      const pause = Math.round(0.35 * SAMPLE_RATE);
      for (let i = 0; i < pause; i++) chunks.push(0);
    }

    const samples = Float32Array.from(chunks);
    return Promise.resolve({
      buffer: encodeWav(samples, SAMPLE_RATE),
      mimeType: 'audio/wav',
      ext: 'wav',
      durationMs: Math.round((samples.length / SAMPLE_RATE) * 1000),
      model: 'offline-cadence-synth',
      notes: 'Timing placeholder — configure a TTS provider (OPENAI_API_KEY / ELEVENLABS_API_KEY) for real narration.',
    });
  }
}
