// @file provider.registry.ts — ProviderRegistry: resolves adapters by name
import { Injectable, NotFoundException } from '@nestjs/common';
import type { OAuthProviderAdapter } from './provider.types';
import { GoogleAdapter } from './google.adapter';
import { AppleAdapter } from './apple.adapter';
import { FacebookAdapter } from './facebook.adapter';

export type ProviderName = 'google' | 'apple' | 'facebook';

export interface ProvidersStatus {
  google: boolean;
  apple: boolean;
  facebook: boolean;
}

@Injectable()
export class ProviderRegistry {
  private readonly adapters: Map<ProviderName, OAuthProviderAdapter>;

  constructor(
    private readonly google: GoogleAdapter,
    private readonly apple: AppleAdapter,
    private readonly facebook: FacebookAdapter,
  ) {
    this.adapters = new Map<ProviderName, OAuthProviderAdapter>([
      ['google', google],
      ['apple', apple],
      ['facebook', facebook],
    ]);
  }

  /**
   * Returns the adapter for the given provider name.
   * Throws NotFoundException if the provider is unknown or its required env vars are missing.
   */
  get(name: string): OAuthProviderAdapter {
    const adapter = this.adapters.get(name as ProviderName);
    if (!adapter) throw new NotFoundException(`Unknown OAuth provider: ${name}`);
    if (!adapter.enabled()) {
      throw new NotFoundException(`OAuth provider not configured: ${name}`);
    }
    return adapter;
  }

  /** Returns the enabled/disabled status of all known providers (for GET /auth/providers). */
  status(): ProvidersStatus {
    return {
      google: this.google.enabled(),
      apple: this.apple.enabled(),
      facebook: this.facebook.enabled(),
    };
  }
}
