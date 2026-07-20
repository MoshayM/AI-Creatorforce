import { Injectable, Logger, BadRequestException } from '@nestjs/common';

/** Supported STT providers — set STT_PROVIDER env var to switch. */
type SttProvider = 'whisper' | 'google' | 'deepgram' | 'azure';

export interface TranscribeResult {
  text: string;
  language?: string;
  durationMs?: number;
}

@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);

  get provider(): SttProvider {
    const p = (process.env['STT_PROVIDER'] ?? 'whisper').toLowerCase() as SttProvider;
    return p;
  }

  /** Returns true when this service can actually transcribe (has credentials). */
  get isAvailable(): boolean {
    switch (this.provider) {
      case 'whisper':
        return !!process.env['OPENAI_API_KEY'];
      case 'google':
        return !!process.env['GOOGLE_SPEECH_KEY'];
      case 'deepgram':
        return !!process.env['DEEPGRAM_API_KEY'];
      case 'azure':
        return !!(process.env['AZURE_SPEECH_KEY'] && process.env['AZURE_SPEECH_REGION']);
      default:
        return false;
    }
  }

  async transcribe(audioBuffer: Buffer, mimeType: string, hintLanguage?: string): Promise<TranscribeResult> {
    if (!this.isAvailable) {
      throw new BadRequestException(
        `Server-side STT is not configured (STT_PROVIDER=${this.provider}). ` +
        'Set OPENAI_API_KEY (Whisper), GOOGLE_SPEECH_KEY, DEEPGRAM_API_KEY, or AZURE_SPEECH_KEY + AZURE_SPEECH_REGION.',
      );
    }

    this.logger.log(`Transcribing ${(audioBuffer.length / 1024).toFixed(1)} KB via ${this.provider}`);
    const start = Date.now();

    try {
      let result: TranscribeResult;
      switch (this.provider) {
        case 'whisper':
          result = await this.whisper(audioBuffer, mimeType, hintLanguage);
          break;
        case 'google':
          result = await this.googleSpeech(audioBuffer, mimeType, hintLanguage);
          break;
        case 'deepgram':
          result = await this.deepgram(audioBuffer, mimeType, hintLanguage);
          break;
        case 'azure':
          result = await this.azure(audioBuffer, mimeType, hintLanguage);
          break;
        default:
          throw new BadRequestException(`Unknown STT_PROVIDER: ${this.provider as string}`);
      }
      result.durationMs = Date.now() - start;
      this.logger.log(`Transcribed in ${result.durationMs}ms: "${result.text.slice(0, 80)}"`);
      return result;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`STT failed (${this.provider}): ${msg}`);
      throw new BadRequestException(`Speech-to-text failed: ${msg}`);
    }
  }

  private async whisper(audioBuffer: Buffer, mimeType: string, language?: string): Promise<TranscribeResult> {
    const apiKey = process.env['OPENAI_API_KEY']!;
    const ext = this.mimeToExt(mimeType);
    const form = new FormData();

    const blob = new Blob([audioBuffer], { type: mimeType });
    form.append('file', blob, `audio.${ext}`);
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    if (language) form.append('language', language.split('-')[0]!);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Whisper HTTP ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { text: string; language?: string };
    return { text: data.text.trim(), language: data.language };
  }

  private async googleSpeech(audioBuffer: Buffer, mimeType: string, language?: string): Promise<TranscribeResult> {
    const apiKey = process.env['GOOGLE_SPEECH_KEY']!;
    const encoding = this.mimeToGoogleEncoding(mimeType);
    const body = {
      config: {
        encoding,
        sampleRateHertz: 16000,
        languageCode: language ?? 'en-US',
        enableAutomaticPunctuation: true,
      },
      audio: { content: audioBuffer.toString('base64') },
    };

    const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google Speech HTTP ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { results?: Array<{ alternatives: Array<{ transcript: string }> }> };
    const text = data.results?.flatMap((r) => r.alternatives[0]?.transcript ?? '').join(' ').trim() ?? '';
    return { text };
  }

  private async deepgram(audioBuffer: Buffer, mimeType: string, language?: string): Promise<TranscribeResult> {
    const apiKey = process.env['DEEPGRAM_API_KEY']!;
    const params = new URLSearchParams({ model: 'nova-3', smart_format: 'true', punctuate: 'true' });
    if (language) params.set('language', language.split('-')[0]!);

    const res = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': mimeType },
      body: audioBuffer,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Deepgram HTTP ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { results?: { channels?: Array<{ alternatives: Array<{ transcript: string }> }> } };
    const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
    return { text };
  }

  private async azure(audioBuffer: Buffer, mimeType: string, language?: string): Promise<TranscribeResult> {
    const key = process.env['AZURE_SPEECH_KEY']!;
    const region = process.env['AZURE_SPEECH_REGION']!;
    const lang = language ?? 'en-US';

    const res = await fetch(
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang}&format=detailed`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': this.mimeToAzureContentType(mimeType),
        },
        body: audioBuffer,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure Speech HTTP ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { DisplayText?: string };
    return { text: data.DisplayText?.trim() ?? '' };
  }

  private mimeToExt(mime: string): string {
    const map: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/webm;codecs=opus': 'webm',
      'audio/ogg': 'ogg',
      'audio/ogg;codecs=opus': 'ogg',
      'audio/mp4': 'mp4',
      'audio/wav': 'wav',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
    };
    const norm = mime.split(';')[0]!.trim().toLowerCase();
    return map[norm] ?? map[mime.toLowerCase()] ?? 'webm';
  }

  private mimeToGoogleEncoding(mime: string): string {
    if (mime.includes('webm') || mime.includes('ogg')) return 'OGG_OPUS';
    if (mime.includes('mp4')) return 'MP4';
    if (mime.includes('wav')) return 'LINEAR16';
    if (mime.includes('mp3') || mime.includes('mpeg')) return 'MP3';
    return 'WEBM_OPUS';
  }

  private mimeToAzureContentType(mime: string): string {
    if (mime.includes('wav')) return 'audio/wav; codecs=audio/pcm; samplerate=16000';
    if (mime.includes('ogg')) return 'audio/ogg; codecs=opus';
    if (mime.includes('mp3') || mime.includes('mpeg')) return 'audio/mpeg';
    return 'audio/webm; codecs=opus';
  }
}
