// @file provider.types.ts — OAuthProviderAdapter contract
// Adding a future provider = new adapter + registry entry, no schema change (spec acceptance criterion).

export interface OAuthProfile {
  /** Provider-issued stable user identifier */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export interface BuildAuthUrlArgs {
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface ExchangeArgs {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  nonce: string;
}

export interface OAuthProviderAdapter {
  readonly name: 'google' | 'apple' | 'facebook';
  /** Returns true when all required env vars for this provider are present. */
  enabled(): boolean;
  /** Builds the provider authorization URL. */
  buildAuthUrl(args: BuildAuthUrlArgs): string;
  /** Exchanges an authorization code for a normalized user profile. */
  exchange(args: ExchangeArgs): Promise<OAuthProfile>;
}
