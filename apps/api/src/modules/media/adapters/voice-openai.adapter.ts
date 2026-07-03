import type { VoiceAdapter, VoiceRequest, GeneratedMedia } from '../media.types';

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_MODEL = process.env['VOICE_OPENAI_MODEL'] ?? 'gpt-4o-mini-tts';
const WORDS_PER_SECOND = 2.5;

/** Real TTS via the OpenAI audio API — active whenever OPENAI_API_KEY is set. */
export class OpenAiVoiceAdapter implements VoiceAdapter {
  readonly name = 'openai-tts';

  available(): boolean {
    return !!process.env['OPENAI_API_KEY'];
  }

  async synthesize(req: VoiceRequest): Promise<GeneratedMedia> {
    const res = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env['OPENAI_API_KEY']}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        voice: req.voiceId ?? 'alloy',
        input: req.text.slice(0, 4096),
        speed: req.speed ?? 1,
        response_format: 'mp3',
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI TTS failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const words = req.text.trim().split(/\s+/).length;
    return {
      buffer,
      mimeType: 'audio/mpeg',
      ext: 'mp3',
      durationMs: Math.round((words / (WORDS_PER_SECOND * (req.speed ?? 1))) * 1000),
      model: DEFAULT_MODEL,
    };
  }
}
