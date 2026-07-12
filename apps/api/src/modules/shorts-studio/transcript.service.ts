import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runFfmpeg } from '../media/adapters/ffmpeg.util';
import { YouTubeReadService, type TranscriptCueDTO } from './youtube-read.service';
import { VideoImportService } from './video-import.service';
import { AnalysisCacheService } from './analysis-cache.service';

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
    private readonly analysisCache: AnalysisCacheService,
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

    // 0) §12 content-hash cache: byte-identical source already transcribed
    // (same file re-imported) — copy rows, no caption fetch or ASR.
    const cached = await this.analysisCache.copyTranscript(importedVideoId, onLog);
    if (cached) {
      return { skipped: false, segments: cached.segments, source: cached.source, fromCache: true };
    }

    // 1) Owner captions via the Data API (needs force-ssl scope)
    onLog?.('Checking YouTube captions…');
    let cues = await this.youtubeRead.getTranscript(video.project.channelId, video.youtubeVideoId);
    let source: 'YOUTUBE_CAPTIONS' | 'ASR_GENERATED' = 'YOUTUBE_CAPTIONS';

    // 2) Public (auto-)captions via yt-dlp — no scope needed, free
    if (!cues || cues.length === 0) {
      onLog?.('Fetching public auto-captions…');
      cues = await this.videoImport.downloadAutoCaptions(video.youtubeVideoId);
    }

    // 3) ASR fallback on extracted audio (chunked for long videos)
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
        'Transcript unavailable: no caption track (owner or public auto-captions) and speech-to-text failed or is not configured (OPENAI_API_KEY).',
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
    try {
      // Whisper caps uploads at 25 MB, so long videos are transcribed in
      // ~20-minute chunks; chunk timestamps are stitched using the exact
      // audio duration Whisper reports back per chunk.
      onLog?.('Extracting audio track…');
      await runFfmpeg([
        '-i', sourcePath, '-vn', '-ac', '1', '-b:a', '64k',
        '-f', 'segment', '-segment_time', '1200', '-reset_timestamps', '1',
        path.join(tmpDir, 'chunk-%03d.mp3'),
      ]);
      const chunks = (await fsp.readdir(tmpDir)).filter((f) => f.startsWith('chunk-')).sort();
      if (chunks.length === 0) return null;

      const cues: TranscriptCueDTO[] = [];
      let offsetMs = 0;
      for (let i = 0; i < chunks.length; i++) {
        onLog?.(`Transcribing audio ${i + 1}/${chunks.length} (Whisper)…`);
        const audio = await fsp.readFile(path.join(tmpDir, chunks[i]!));
        if (audio.length > 25 * 1024 * 1024) {
          this.logger.warn(`Chunk ${chunks[i]} exceeds Whisper's 25 MB limit — skipping`);
          offsetMs += 1_200_000;
          continue;
        }
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
          return cues.length > 0 ? cues : null;
        }
        const json = (await res.json()) as { segments?: WhisperSegment[]; duration?: number };
        for (const s of json.segments ?? []) {
          if (s.text.trim().length === 0) continue;
          cues.push({
            startMs: offsetMs + Math.round(s.start * 1000),
            endMs: offsetMs + Math.round(s.end * 1000),
            text: s.text.trim(),
          });
        }
        offsetMs += json.duration ? Math.round(json.duration * 1000) : 1_200_000;
      }
      return cues.length > 0 ? cues : null;
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
