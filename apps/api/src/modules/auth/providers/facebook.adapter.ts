// @file facebook.adapter.ts — Facebook OAuth 2.0 adapter
// NOTE: Facebook does not support PKCE for server-side flows (confidential client).
// The code exchange uses the app_secret directly on the server side.
// This is a documented deviation from the PKCE-based flow used by Google/Apple;
// it is safe because the client_secret stays on the server and never reaches the browser.
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import type { OAuthProviderAdapter, BuildAuthUrlArgs, ExchangeArgs, OAuthProfile } from './provider.types';

const FB_GRAPH_VERSION = 'v19.0';
const FB_AUTH_BASE = `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth`;
const FB_TOKEN_ENDPOINT = `https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`;
const FB_ME_ENDPOINT = `https://graph.facebook.com/${FB_GRAPH_VERSION}/me`;

@Injectable()
export class FacebookAdapter implements OAuthProviderAdapter {
  readonly name = 'facebook' as const;
  private readonly logger = new Logger(FacebookAdapter.name);

  enabled(): boolean {
    return Boolean(
      process.env['FACEBOOK_APP_ID'] && process.env['FACEBOOK_APP_SECRET'],
    );
  }

  buildAuthUrl(args: BuildAuthUrlArgs): string {
    // Facebook: PKCE not supported for server-side confidential flow (see file comment).
    // We still pass state for CSRF protection.
    const params = new URLSearchParams({
      client_id: process.env['FACEBOOK_APP_ID'] ?? '',
      redirect_uri: args.redirectUri,
      state: args.state,
      scope: 'email,public_profile',
      response_type: 'code',
    });
    return `${FB_AUTH_BASE}?${params.toString()}`;
  }

  async exchange(args: ExchangeArgs): Promise<OAuthProfile> {
    // Step 1: Exchange code for access token
    let accessToken: string;
    try {
      const resp = await axios.get<{ access_token: string }>(FB_TOKEN_ENDPOINT, {
        params: {
          client_id: process.env['FACEBOOK_APP_ID'],
          client_secret: process.env['FACEBOOK_APP_SECRET'],
          redirect_uri: args.redirectUri,
          code: args.code,
        },
      });
      accessToken = resp.data.access_token;
    } catch (err) {
      this.logger.warn('Facebook token exchange failed', err);
      throw new UnauthorizedException('Facebook token exchange failed');
    }

    // Step 2: Fetch user profile
    let profile: { id: string; name?: string; email?: string };
    try {
      const resp = await axios.get<{ id: string; name?: string; email?: string }>(FB_ME_ENDPOINT, {
        params: {
          fields: 'id,name,email',
          access_token: accessToken,
        },
      });
      profile = resp.data;
    } catch (err) {
      this.logger.warn('Facebook /me fetch failed', err);
      throw new UnauthorizedException('Facebook profile fetch failed');
    }

    if (!profile.id) throw new UnauthorizedException('Facebook profile missing id');

    return {
      subject: profile.id,
      email: profile.email ?? null,
      // Facebook only returns confirmed emails — treat presence as verified
      emailVerified: Boolean(profile.email),
      name: profile.name ?? null,
    };
  }
}
