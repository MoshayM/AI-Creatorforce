import type { VoiceAdapter, VoiceRequest, GeneratedMedia } from '../media.types';

const BASE_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_VOICE_ID = process.env['VOICE_ELEVENLABS_VOICE_ID'] ?? '21m00Tcm4TlvDq8ikWAM'; // Rachel
const DEFAULT_MODEL = process.env['VOICE_ELEVENLABS_MODEL'] ?? 'eleven_multilingual_v2';
const MAX_CHUNK_CHARS = 4500;
const WORDS_PER_SECOND = 2.5;

/** Split text into request-sized chunks on sentence boundaries. Exported for tests. */
export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
    // A single sentence longer than the limit is hard-split
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.trim().length > 0);
}

/**
 * Real TTS narration via ElevenLabs — activates the moment an admin saves
 * ELEVENLABS_API_KEY in Settings (keys load into process.env at runtime, no
 * restart needed). Long narrations are synthesized in sentence-boundary
 * chunks and concatenated (MP3 frames concatenate cleanly for playback and
 * ffmpeg decoding).
 */
export class ElevenLabsVoiceAdapter implements VoiceAdapter {
  readonly name = 'elevenlabs';

  available(): boolean {
    return !!process.env['ELEVENLABS_API_KEY'];
  }

  async synthesize(req: VoiceRequest): Promise<GeneratedMedia> {
    const voiceId = req.voiceId && !req.voiceId.includes(' ') ? req.voiceId : DEFAULT_VOICE_ID;
    const chunks = chunkText(req.text);
    const parts: Buffer[] = [];

    for (const chunk of chunks) {
      const res = await fetch(`${BASE_URL}/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env['ELEVENLABS_API_KEY'] ?? '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: chunk,
          model_id: DEFAULT_MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: req.speed ?? 1 },
        }),
      });
      if (!res.ok) {
        throw new Error(`ElevenLabs TTS failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      parts.push(Buffer.from(await res.arrayBuffer()));
    }

    const words = req.text.trim().split(/\s+/).length;
    return {
      buffer: Buffer.concat(parts),
      mimeType: 'audio/mpeg',
      ext: 'mp3',
      durationMs: Math.round((words / (WORDS_PER_SECOND * (req.speed ?? 1))) * 1000),
      model: DEFAULT_MODEL,
      notes: chunks.length > 1 ? `Synthesized in ${chunks.length} chunks` : undefined,
    };
  }
}
