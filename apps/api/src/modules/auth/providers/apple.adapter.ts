// @file apple.adapter.ts — Sign in with Apple (OIDC) adapter
// Uses jose for JWT operations (id_token verification + client secret generation).
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { createPrivateKey } from 'node:crypto';
import type { OAuthProviderAdapter, BuildAuthUrlArgs, ExchangeArgs, OAuthProfile } from './provider.types';

// Apple JWKS endpoint — keys rotated; fetch fresh on each call.
const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys');
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';

// Cached JWKS set (per process lifetime is fine — apple rotates rarely)
let _appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function appleJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!_appleJwks) _appleJwks = createRemoteJWKSet(APPLE_JWKS_URL);
  return _appleJwks;
}

function normalizePrivateKey(raw: string): string {
  // Env may store the PEM with literal \n sequences instead of real newlines
  return raw.replace(/\\n/g, '\n');
}

@Injectable()
export class AppleAdapter implements OAuthProviderAdapter {
  readonly name = 'apple' as const;
  private readonly logger = new Logger(AppleAdapter.name);

  enabled(): boolean {
    return Boolean(
      process.env['APPLE_CLIENT_ID'] &&
      process.env['APPLE_TEAM_ID'] &&
      process.env['APPLE_KEY_ID'] &&
      process.env['APPLE_PRIVATE_KEY'],
    );
  }

  buildAuthUrl(args: BuildAuthUrlArgs): string {
    const params = new URLSearchParams({
      client_id: process.env['APPLE_CLIENT_ID'] ?? '',
      redirect_uri: args.redirectUri,
      response_type: 'code',
      // Apple requires response_mode=form_post when requesting name/email scopes
      response_mode: 'form_post',
      scope: 'name email',
      state: args.state,
      nonce: args.nonce,
      code_challenge: args.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://appleid.apple.com/auth/authorize?${params.toString()}`;
  }

  async exchange(args: ExchangeArgs): Promise<OAuthProfile> {
    const clientSecret = await this.buildClientSecret();

    // Exchange code for tokens using fetch (no external dep needed for this)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: args.code,
      redirect_uri: args.redirectUri,
      client_id: process.env['APPLE_CLIENT_ID'] ?? '',
      client_secret: clientSecret,
      code_verifier: args.codeVerifier,
    });

    let tokenData: { id_token?: string };
    try {
      const resp = await fetch(APPLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!resp.ok) {
        const text = await resp.text();
        this.logger.warn('Apple token exchange failed', text);
        throw new UnauthorizedException('Apple token exchange failed');
      }
      // @reason: apple token response shape is not typed in any installed package
      tokenData = (await resp.json()) as { id_token?: string };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      this.logger.warn('Apple token exchange error', err);
      throw new UnauthorizedException('Apple token exchange failed');
    }

    if (!tokenData.id_token) throw new UnauthorizedException('Apple did not return an id_token');

    const clientId = process.env['APPLE_CLIENT_ID'] ?? '';
    let payload: Record<string, unknown>;
    try {
      const result = await jwtVerify(tokenData.id_token, appleJwks(), {
        issuer: APPLE_ISSUER,
        audience: clientId,
        algorithms: ['RS256'],
      });
      // @reason: jose payload is JWTPayload which has index signature for custom claims
      payload = result.payload as Record<string, unknown>;
    } catch (err) {
      this.logger.warn('Apple id_token verification failed', err);
      throw new UnauthorizedException('Apple id_token verification failed');
    }

    const sub = typeof payload['sub'] === 'string' ? payload['sub'] : null;
    if (!sub) throw new UnauthorizedException('Apple id_token missing sub');

    // Verify nonce
    const claimedNonce = payload['nonce'];
    if (claimedNonce !== args.nonce) {
      throw new UnauthorizedException('Apple id_token nonce mismatch');
    }

    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    // Apple may return email_verified as string 'true' — coerce to boolean
    const emailVerified = payload['email_verified'] === true || payload['email_verified'] === 'true';
    const name: string | null = null; // Apple sends name only on first auth via form_post body, not in id_token

    return { subject: sub, email, emailVerified, name };
  }

  private async buildClientSecret(): Promise<string> {
    const rawKey = process.env['APPLE_PRIVATE_KEY'] ?? '';
    const teamId = process.env['APPLE_TEAM_ID'] ?? '';
    const clientId = process.env['APPLE_CLIENT_ID'] ?? '';
    const keyId = process.env['APPLE_KEY_ID'] ?? '';

    const privateKey = createPrivateKey(normalizePrivateKey(rawKey));

    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(now)
      .setExpirationTime(now + 180) // 3-minute client secret TTL
      .setAudience(APPLE_ISSUER)
      .setSubject(clientId)
      .sign(privateKey);
  }
}
