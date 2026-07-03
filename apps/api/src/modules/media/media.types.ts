/**
 * Provider abstraction for media generation (update.txt: "Never hardcode AI
 * providers. Create adapters."). Business logic depends only on these
 * interfaces; concrete providers register in MediaService and are selected by
 * env config with automatic fallback to always-available offline adapters.
 */

export interface GeneratedMedia {
  buffer: Buffer;
  mimeType: string;
  ext: string;
  durationMs?: number;
  model: string;
  notes?: string;
}

export interface VoiceRequest {
  text: string;
  voiceId?: string;
  speed?: number;
  language?: string;
}

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
}

export interface MusicRequest {
  mood: string;
  genre: string;
  bpm: number;
  energy: 'low' | 'medium' | 'high' | 'dynamic';
  durationSecs: number;
}

export interface SceneVideoRequest {
  imagePath?: string;
  prompt: string;
  durationSecs: number;
  width: number;
  height: number;
}

export interface MediaAdapter {
  readonly name: string;
  /** Cheap static check (keys/binaries present). Runtime errors still fall through to the next adapter. */
  available(): boolean;
}

export interface VoiceAdapter extends MediaAdapter {
  synthesize(req: VoiceRequest): Promise<GeneratedMedia>;
}

export interface ImageAdapter extends MediaAdapter {
  generateImage(req: ImageRequest): Promise<GeneratedMedia>;
}

export interface MusicAdapter extends MediaAdapter {
  compose(req: MusicRequest): Promise<GeneratedMedia>;
}

export interface VideoAdapter extends MediaAdapter {
  renderScene(req: SceneVideoRequest): Promise<GeneratedMedia>;
}
