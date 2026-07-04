import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { AssetKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from './storage.service';
import type {
  GeneratedMedia, VoiceAdapter, ImageAdapter, MusicAdapter, VideoAdapter,
  VoiceRequest, ImageRequest, MusicRequest, SceneVideoRequest,
} from './media.types';
import { ElevenLabsVoiceAdapter } from './adapters/voice-elevenlabs.adapter';
import { OpenAiVoiceAdapter } from './adapters/voice-openai.adapter';
import { OfflineVoiceAdapter } from './adapters/voice-offline.adapter';
import { OpenAiImageAdapter } from './adapters/image-openai.adapter';
import { GeminiImageAdapter } from './adapters/image-gemini.adapter';
import { OfflineImageAdapter } from './adapters/image-offline.adapter';
import { OfflineMusicAdapter } from './adapters/music-offline.adapter';
import { FfmpegSceneVideoAdapter } from './adapters/video-ffmpeg.adapter';

export interface StoredAsset {
  assetId: string;
  versionId: string;
  key: string;
  absPath: string;
  provider: string;
  durationMs?: number;
  sizeBytes: number;
  cached: boolean;
  notes?: string;
}

type AdapterChain<T> = { configured: string | undefined; adapters: T[] };

/**
 * AI Orchestrator for media (update.txt): provider selection, automatic
 * fallback, caching, provenance. No module calls a media provider directly —
 * everything goes through this service. Adapter order: the env-configured
 * provider first (VOICE_PROVIDER / IMAGE_PROVIDER / MUSIC_PROVIDER /
 * VIDEO_PROVIDER), then remaining adapters by registration order, offline
 * fallbacks last, so generation never dead-ends.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  private readonly voice: AdapterChain<VoiceAdapter> = {
    configured: process.env['VOICE_PROVIDER'],
    adapters: [new ElevenLabsVoiceAdapter(), new OpenAiVoiceAdapter(), new OfflineVoiceAdapter()],
  };
  private readonly image: AdapterChain<ImageAdapter> = {
    configured: process.env['IMAGE_PROVIDER'],
    // Gemini first: the OpenAI key on this install is revoked (401-latched)
    adapters: [new GeminiImageAdapter(), new OpenAiImageAdapter(), new OfflineImageAdapter()],
  };
  private readonly music: AdapterChain<MusicAdapter> = {
    configured: process.env['MUSIC_PROVIDER'],
    adapters: [new OfflineMusicAdapter()],
  };
  private readonly video: AdapterChain<VideoAdapter> = {
    configured: process.env['VIDEO_PROVIDER'],
    adapters: [new FfmpegSceneVideoAdapter()],
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  generateVoice(projectId: string, label: string, req: VoiceRequest): Promise<StoredAsset> {
    return this.generate(projectId, 'VOICE', label, req, this.orderedAdapters(this.voice), (a, r) => a.synthesize(r));
  }

  generateImage(projectId: string, label: string, req: ImageRequest): Promise<StoredAsset> {
    return this.generate(projectId, 'IMAGE', label, req, this.orderedAdapters(this.image), (a, r) => a.generateImage(r));
  }

  generateMusic(projectId: string, label: string, req: MusicRequest): Promise<StoredAsset> {
    return this.generate(projectId, 'MUSIC', label, req, this.orderedAdapters(this.music), (a, r) => a.compose(r));
  }

  generateSceneVideo(projectId: string, label: string, req: SceneVideoRequest): Promise<StoredAsset> {
    return this.generate(projectId, 'VIDEO', label, req, this.orderedAdapters(this.video), (a, r) => a.renderScene(r));
  }

  private orderedAdapters<T extends { name: string; available(): boolean }>(chain: AdapterChain<T>): T[] {
    const ordered = [...chain.adapters];
    if (chain.configured) {
      ordered.sort((a, b) => (a.name === chain.configured ? -1 : b.name === chain.configured ? 1 : 0));
    }
    return ordered.filter((a) => a.available());
  }

  private async generate<TReq, TAdapter extends { name: string }>(
    projectId: string,
    kind: AssetKind,
    label: string,
    req: TReq,
    adapters: TAdapter[],
    call: (adapter: TAdapter, req: TReq) => Promise<GeneratedMedia>,
  ): Promise<StoredAsset> {
    if (adapters.length === 0) throw new Error(`No available ${kind} provider adapters`);

    // Token optimization: never regenerate completed assets — identical
    // request (kind+label+params) returns the cached version. The preferred
    // adapter is part of the hash so upgrading providers (e.g. admin adds an
    // ElevenLabs key) naturally invalidates placeholder-era caches.
    const requestHash = createHash('sha256')
      .update(`${kind}:${label}:${adapters[0]!.name}:${JSON.stringify(req)}`)
      .digest('hex');
    const cachedVersion = await this.prisma.assetVersion.findFirst({
      where: {
        params: { path: ['requestHash'], equals: requestHash },
        asset: { projectId, kind, deletedAt: null, status: { in: ['READY', 'ACCEPTED'] } },
      },
      include: { asset: true },
      orderBy: { createdAt: 'desc' },
    });
    if (cachedVersion?.r2Key && this.storage.exists(cachedVersion.r2Key)) {
      return {
        assetId: cachedVersion.assetId,
        versionId: cachedVersion.id,
        key: cachedVersion.r2Key,
        absPath: this.storage.resolve(cachedVersion.r2Key),
        provider: cachedVersion.provider ?? 'unknown',
        durationMs: cachedVersion.durationMs ?? undefined,
        sizeBytes: Number(cachedVersion.sizeBytes),
        cached: true,
      };
    }

    const asset = await this.prisma.asset.create({
      data: { projectId, kind, label, status: 'GENERATING' },
    });

    let lastErr: unknown = null;
    for (const adapter of adapters) {
      try {
        const media = await call(adapter, req);
        const key = `assets/${projectId}/${asset.id}/v1/media.${media.ext}`;
        const { absPath, sizeBytes } = await this.storage.put(key, media.buffer);
        const contentHash = createHash('sha256').update(media.buffer).digest('hex');

        const version = await this.prisma.assetVersion.create({
          data: {
            assetId: asset.id,
            version: 1,
            r2Key: key,
            contentHash,
            provider: adapter.name,
            model: media.model,
            prompt: { request: JSON.parse(JSON.stringify(req)) as object } as never,
            params: { requestHash } as never,
            // Write-once provenance (claude.md golden rule 4 / security.md §10)
            provenance: {
              provider: adapter.name,
              model: media.model,
              generatedAt: new Date().toISOString(),
              license: adapter.name.startsWith('offline-') ? 'generated-in-app-royalty-free' : 'provider-tos',
              notes: media.notes ?? null,
            } as never,
            sizeBytes: BigInt(sizeBytes),
            durationMs: media.durationMs ?? null,
          },
        });
        await this.prisma.asset.update({
          where: { id: asset.id },
          data: { status: 'READY', currentVersionId: version.id },
        });

        return {
          assetId: asset.id,
          versionId: version.id,
          key,
          absPath,
          provider: adapter.name,
          durationMs: media.durationMs,
          sizeBytes,
          cached: false,
          notes: media.notes,
        };
      } catch (err) {
        lastErr = err;
        this.logger.warn(`${kind} adapter ${adapter.name} failed, trying next: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
      }
    }

    await this.prisma.asset.update({ where: { id: asset.id }, data: { status: 'FAILED' } });
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
