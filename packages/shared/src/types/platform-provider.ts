export type SupportedPlatform =
  | 'YOUTUBE'
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'LINKEDIN'
  | 'TWITTER';

export interface PublishPayload {
  title: string;
  description?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  scheduledAt?: string;
  tags?: string[];
}

export interface PlatformProvider {
  readonly platform: SupportedPlatform;
  connect(userId: string): Promise<{ authUrl: string }>;
  disconnect(userId: string): Promise<void>;
  publish(userId: string, payload: PublishPayload): Promise<{ externalId: string; url: string }>;
  schedule(userId: string, payload: PublishPayload & { scheduledAt: string }): Promise<{ externalId: string }>;
  validate(payload: PublishPayload): Promise<{ valid: boolean; errors?: string[] }>;
}
