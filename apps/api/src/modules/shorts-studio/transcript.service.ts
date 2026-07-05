import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runFfmpeg } from '../media/adapters/ffmpeg.util';
import { YouTubeReadService, type TranscriptCueDTO } from './youtube-read.service';
import { VideoImportService } from './video-import.service';

interface WhisperSegment {
  start: number; // seconds
  end: number;
  text: string;
}

/**
 * TRANSCRIPT_ANALYSIS stage (ai.md Section 3): YouTube captions first, ASR
 * (OpenAI Whisper API) fallback on the extracted audio. Resume rule 16.3:
 * transcript output is keyed by importedVideoId and never regenerated once
 * segments exist.
 */
@Injectable()
export class TranscriptService {
  private readonly logger = new Logger(TranscriptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly youtubeRead: YouTubeReadService,
    private readonly videoImport: VideoImportService,
  ) {}

  async ensureTranscript(importedVideoId: string, onLog?: (msg: string) => void) {
    const video = await this.prisma.importedVideo.findUnique({
      where: { id: importedVideoId },
      include: { project: { select: { channelId: true } } },
    });
    if (!video) throw new NotFoundException('Imported video not found');

    const existing = await this.prisma.transcriptSegment.count({ where: { importedVideoId } });
    if (existing > 0) {
      onLog?.(`Transcript already exists (${existing} segments) — reusing`);
      return { skipped: true, segments: existing, source: video.transcriptStatus };
    }

    // 1) YouTube captions (owner captions, read-only scopes)
    onLog?.('Checking YouTube captions…');
    let cues = await this.youtubeRead.getTranscript(video.project.channelId, video.youtubeVideoId);
    let source: 'YOUTUBE_CAPTIONS' | 'ASR_GENERATED' = 'YOUTUBE_CAPTIONS';

    // 2) ASR fallback on extracted audio
    if (!cues || cues.length === 0) {
      onLog?.('No usable captions — falling back to speech-to-text');
      cues = await this.transcribeWithWhisper(importedVideoId, onLog);
      source = 'ASR_GENERATED';
    }

    if (!cues || cues.length === 0) {
      await this.prisma.importedVideo.update({
        where: { id: importedVideoId },
        data: { transcriptStatus: 'FAILED' },
      });
      throw new Error(
        'Transcript unavailable: the video has no caption track and ASR fallback is not configured (set OPENAI_API_KEY).',
      );
    }

    await this.prisma.$transaction([
      this.prisma.transcriptSegment.createMany({
        data: cues.map((c) => ({
          importedVideoId,
          startMs: Math.round(c.startMs),
          endMs: Math.round(c.endMs),
          text: c.text,
        })),
      }),
      this.prisma.importedVideo.update({
        where: { id: importedVideoId },
        data: { transcriptStatus: source },
      }),
    ]);
    onLog?.(`Transcript stored — ${cues.length} segments (${source === 'YOUTUBE_CAPTIONS' ? 'YouTube captions' : 'ASR'})`);
    return { skipped: false, segments: cues.length, source };
  }

  private async transcribeWithWhisper(
    importedVideoId: string,
    onLog?: (msg: string) => void,
  ): Promise<TranscriptCueDTO[] | null> {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not set — ASR fallback unavailable');
      return null;
    }

    const sourcePath = await this.videoImport.getSourcePath(importedVideoId);
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-asr-'));
    const audioPath = path.join(tmpDir, 'audio.mp3');
    try {
      onLog?.('Extracting audio track…');
      // 64kbps mono keeps hour-long audio under Whisper's 25 MB upload limit
      await runFfmpeg(['-i', sourcePath, '-vn', '-ac', '1', '-b:a', '64k', audioPath]);
      const audio = await fsp.readFile(audioPath);
      if (audio.length > 25 * 1024 * 1024) {
        this.logger.warn(`Audio too large for Whisper API (${Math.round(audio.length / 1024 / 1024)} MB > 25 MB)`);
        return null;
      }

      onLog?.('Transcribing audio (Whisper)…');
      const form = new FormData();
      form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'audio.mp3');
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(`Whisper API error ${res.status}: ${body.slice(0, 300)}`);
        return null;
      }
      const json = (await res.json()) as { segments?: WhisperSegment[] };
      const segments = json.segments ?? [];
      return segments
        .filter((s) => s.text.trim().length > 0)
        .map((s) => ({
          startMs: Math.round(s.start * 1000),
          endMs: Math.round(s.end * 1000),
          text: s.text.trim(),
        }));
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
