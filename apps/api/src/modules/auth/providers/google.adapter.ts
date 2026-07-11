// @file google.adapter.ts — Google OIDC adapter using googleapis OAuth2Client
import { Injectable, InternalServerErrorException, Logger, UnauthorizedException } from '@nestjs/common';
import { google } from 'googleapis';
import type { OAuthProviderAdapter, BuildAuthUrlArgs, ExchangeArgs, OAuthProfile } from './provider.types';

function clientId(): string {
  return (
    process.env['AUTH_GOOGLE_CLIENT_ID'] ??
    process.env['GOOGLE_CLIENT_ID'] ??
    ''
  );
}

function clientSecret(): string {
  return (
    process.env['AUTH_GOOGLE_CLIENT_SECRET'] ??
    process.env['GOOGLE_CLIENT_SECRET'] ??
    ''
  );
}

@Injectable()
export class GoogleAdapter implements OAuthProviderAdapter {
  readonly name = 'google' as const;
  private readonly logger = new Logger(GoogleAdapter.name);

  enabled(): boolean {
    return Boolean(clientId() && clientSecret());
  }

  buildAuthUrl(args: BuildAuthUrlArgs): string {
    const client = new google.auth.OAuth2(clientId(), clientSecret(), args.redirectUri);
    // PKCE S256: code_challenge is already computed by OAuthService.
    // @reason: google-auth-library's generateAuthUrl type does not expose nonce/code_challenge params;
    // we spread additional params cast to the accepted type to pass them through.
    const extraParams: Record<string, string> = {
      nonce: args.nonce,
      code_challenge: args.codeChallenge,
      code_challenge_method: 'S256',
    };
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      state: args.state,
      ...extraParams,
    });
  }

  async exchange(args: ExchangeArgs): Promise<OAuthProfile> {
    const client = new google.auth.OAuth2(clientId(), clientSecret(), args.redirectUri);

    let idToken: string | null | undefined;
    try {
      const { tokens } = await client.getToken({ code: args.code, codeVerifier: args.codeVerifier });
      idToken = tokens.id_token;
    } catch (err) {
      this.logger.warn('Google token exchange failed', err);
      throw new UnauthorizedException('Google token exchange failed');
    }

    if (!idToken) {
      throw new InternalServerErrorException('Google did not return an id_token');
    }

    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId(),
      });
      payload = ticket.getPayload();
    } catch (err) {
      this.logger.warn('Google id_token verification failed', err);
      throw new UnauthorizedException('Google id_token verification failed');
    }

    if (!payload) throw new UnauthorizedException('Empty Google id_token payload');
    if (!payload.sub) throw new UnauthorizedException('Google id_token missing sub');

    // Verify nonce to prevent replay
    if (payload.nonce !== args.nonce) {
      throw new UnauthorizedException('Google id_token nonce mismatch');
    }

    return {
      subject: payload.sub,
      email: payload.email ?? null,
      emailVerified: Boolean(payload.email_verified),
      name: payload.name ?? null,
    };
  }
}
