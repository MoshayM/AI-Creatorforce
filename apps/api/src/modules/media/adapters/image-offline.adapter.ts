import type { ImageAdapter, ImageRequest, GeneratedMedia } from '../media.types';
import { encodeGradientPng, seededGradient } from './codec.util';

/**
 * Always-available fallback stills: deterministic brand-toned gradient frames
 * (seeded by the scene prompt, so every scene gets a distinct, stable look).
 * Keeps the pipeline producing a complete video with zero external providers;
 * real image adapters take over automatically once configured.
 */
export class OfflineImageAdapter implements ImageAdapter {
  readonly name = 'offline-gradient-image';

  available(): boolean {
    return true;
  }

  generateImage(req: ImageRequest): Promise<GeneratedMedia> {
    const { top, bottom } = seededGradient(req.prompt);
    return Promise.resolve({
      buffer: encodeGradientPng(req.width, req.height, top, bottom),
      mimeType: 'image/png',
      ext: 'png',
      model: 'offline-gradient',
      notes: 'Placeholder scene frame — configure an image provider (OPENAI_API_KEY) for AI-generated visuals.',
    });
  }
}
