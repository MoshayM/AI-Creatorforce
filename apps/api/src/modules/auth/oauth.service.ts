// @file oauth.service.ts — OAuth sign-in and account-linking service
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import type { AuthTokens } from './auth.service';
import type { SessionMeta } from './sessions.service';
import { TrialService } from '../trial/trial.service';
import { ProviderRegistry } from './providers/provider.registry';

// ── Pure exported helpers (unit-testable without DI) ─────────────────────────

export type SignInDecision = 'LOGIN' | 'LINK_REQUIRED' | 'CREATE';

/**
 * Decides the sign-in path for an OAuth callback.
 *
 * - existingLink found → LOGIN (regardless of email match)
 * - no link, verified email matches existing user → LINK_REQUIRED (no silent account takeover)
 * - unverified email match → CREATE (spec: unverified email must NOT auto-match)
 * - otherwise → CREATE
 */
export function decideSignIn(
  existingLink: { userId: string } | null,
  userWithSameEmail: { id: string } | null,
  emailVerified: boolean,
): SignInDecision {
  if (existingLink !== null) return 'LOGIN';
  if (userWithSameEmail !== null && emailVerified) return 'LINK_REQUIRED';
  return 'CREATE';
}

/**
 * Returns false only when removing a link would strand the user with no sign-in method.
 * Specifically: false when the user has no passwordHash AND this is their only link.
 */
export function canUnlink(hasPassword: boolean, linkCount: number): boolean {
  if (!hasPassword && linkCount <= 1) return false;
  return true;
}

/**
 * Generates a PKCE verifier (64 random bytes → base64url) and its S256 challenge.
 */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64url');
  return { verifier, challenge };
}

// ── OAuthService ─────────────────────────────────────────────────────────────

@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly auth: AuthService,
    private readonly trial: TrialService,
  ) {}

  /**
   * Initiates an OAuth flow: creates an OAuthState row and returns the
   * provider's auth URL and the opaque state token.
   *
   * @param linkUserId  When set (link flow), the state row stores this userId so the
   *                    callback can attach the incoming identity to the existing account.
   */
  async start(
    providerName: string,
    redirectUri: string,
    linkUserId?: string,
  ): Promise<{ authUrl: string; state: string }> {
    const adapter = this.registry.get(providerName);

    // The stored redirectUri is later used verbatim in a 302 (apple/return) —
    // restrict it to the web app's origin to prevent open redirects.
    const allowedOrigin = process.env['WEB_URL'] ?? 'http://localhost:3007';
    if (new URL(redirectUri).origin !== new URL(allowedOrigin).origin) {
      throw new UnauthorizedException('redirectUri origin not allowed');
    }

    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const { verifier, challenge } = pkcePair();

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await this.prisma.oAuthState.create({
      data: {
        provider: providerName,
        state,
        codeVerifier: verifier,
        nonce,
        redirectUri,
        linkUserId: linkUserId ?? null,
        expiresAt,
      },
    });

    const authUrl = adapter.buildAuthUrl({ state, nonce, codeChallenge: challenge, redirectUri });

    return { authUrl, state };
  }

  /**
   * Handles the OAuth callback.
   *
   * - Link flow (stateRow.linkUserId set): creates AccountLink for that user.
   *   409 if the identity is already linked to a DIFFERENT user.
   * - Sign-in flow:
   *   - LOGIN: issue session tokens.
   *   - LINK_REQUIRED: 409 with { error: 'LINK_REQUIRED', email }.
   *   - CREATE: create user + AccountLink, grant trial, issue session tokens.
   */
  async callback(
    providerName: string,
    code: string,
    state: string,
    meta: SessionMeta,
  ): Promise<
    | { linked: true; provider: string }
    | AuthTokens
    | never
  > {
    // Load and validate the state row
    const stateRow = await this.prisma.oAuthState.findUnique({ where: { state } });
    if (!stateRow || stateRow.usedAt !== null || stateRow.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }

    // Mark as used (single-use enforcement)
    await this.prisma.oAuthState.update({
      where: { state },
      data: { usedAt: new Date() },
    });

    const adapter = this.registry.get(providerName);
    const profile = await adapter.exchange({
      code,
      codeVerifier: stateRow.codeVerifier,
      redirectUri: stateRow.redirectUri,
      nonce: stateRow.nonce,
    });

    // ── Link flow ──────────────────────────────────────────────────────────────
    if (stateRow.linkUserId) {
      const userId = stateRow.linkUserId;

      // Check if this identity is already linked to any user
      const existingLink = await this.prisma.accountLink.findUnique({
        where: { provider_providerSubject: { provider: providerName, providerSubject: profile.subject } },
      });

      if (existingLink && existingLink.userId !== userId) {
        throw new ConflictException(
          'This identity is already linked to a different account',
        );
      }

      if (!existingLink) {
        await this.prisma.accountLink.create({
          data: {
            userId,
            provider: providerName,
            providerSubject: profile.subject,
            email: profile.email ?? null,
          },
        });
      }

      await this.auditLog(userId, 'auth.link', {
        provider: providerName,
        subject: profile.subject,
      });

      return { linked: true, provider: providerName };
    }

    // ── Sign-in flow ───────────────────────────────────────────────────────────
    const existingLink = await this.prisma.accountLink.findUnique({
      where: { provider_providerSubject: { provider: providerName, providerSubject: profile.subject } },
    });

    const userWithSameEmail =
      profile.email
        ? await this.prisma.user.findUnique({ where: { email: profile.email } })
        : null;

    const decision = decideSignIn(
      existingLink ? { userId: existingLink.userId } : null,
      userWithSameEmail ? { id: userWithSameEmail.id } : null,
      profile.emailVerified,
    );

    if (decision === 'LINK_REQUIRED') {
      await this.auditLog(userWithSameEmail!.id, 'auth.link_required', {
        provider: providerName,
        email: profile.email,
      });
      // Throw a ConflictException with a structured body the controller surfaces as JSON
      throw new ConflictException({ error: 'LINK_REQUIRED', email: profile.email });
    }

    if (decision === 'LOGIN') {
      const userId = existingLink!.userId;
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const tokens = await this.issueTokens(user.id, user.email, meta);

      await this.auditLog(userId, 'auth.oauth_login', {
        provider: providerName,
        subject: profile.subject,
      });

      return tokens;
    }

    // CREATE: new user. An unverified provider email must never auto-match an
    // existing account (takeover risk), but it also can't create a duplicate row —
    // route it to the same explicit-linking path instead of a unique-constraint 500.
    if (userWithSameEmail) {
      throw new ConflictException({ error: 'LINK_REQUIRED', email: profile.email });
    }
    const email = this.resolveEmail(providerName, profile.subject, profile.email);
    const isFirst = (await this.prisma.user.count()) === 0;

    const newUser = await this.prisma.user.create({
      data: {
        email,
        name: profile.name ?? null,
        emailVerified: profile.emailVerified ? new Date() : null,
        role: isFirst ? 'OWNER' : 'MEMBER',
      },
    });

    await this.prisma.accountLink.create({
      data: {
        userId: newUser.id,
        provider: providerName,
        providerSubject: profile.subject,
        email: profile.email ?? null,
      },
    });

    // Grant trial — mirror auth.service register pattern: failure must not break sign-in.
    // Note: meta.device is the User-Agent string, not a device fingerprint, so we pass ip only.
    await this.trial
      .grantTrial(newUser.id, newUser.email, { ip: meta.ip, verificationMethod: providerName })
      .catch(() => undefined);

    const tokens = await this.issueTokens(newUser.id, newUser.email, meta);

    await this.auditLog(newUser.id, 'auth.oauth_login', {
      provider: providerName,
      subject: profile.subject,
      created: true,
    });

    return tokens;
  }

  /**
   * Returns the linked providers for the given user.
   * password: true means the user has a passwordHash set (email+password sign-in available).
   */
  async links(userId: string): Promise<{
    password: boolean;
    links: Array<{ provider: string; email: string | null; linkedAt: string }>;
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const rows = await this.prisma.accountLink.findMany({ where: { userId } });

    return {
      password: Boolean(user.passwordHash),
      links: rows.map((r) => ({
        provider: r.provider,
        email: r.email,
        linkedAt: r.linkedAt.toISOString(),
      })),
    };
  }

  /**
   * Removes the AccountLink for the given provider from the user's account.
   * Throws ConflictException if doing so would leave the user with no sign-in method.
   */
  async unlink(userId: string, provider: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const allLinks = await this.prisma.accountLink.findMany({ where: { userId } });
    const target = allLinks.find((l) => l.provider === provider);

    if (!target) {
      // Already unlinked — idempotent
      return;
    }

    if (!canUnlink(Boolean(user.passwordHash), allLinks.length)) {
      throw new ConflictException(
        'Cannot remove the only sign-in method. Add a password or another provider first.',
      );
    }

    await this.prisma.accountLink.delete({ where: { id: target.id } });
    await this.auditLog(userId, 'auth.unlink', { provider });
  }

  /**
   * Apple-specific: looks up the stored redirectUri for a state token so the
   * controller can 302 the Apple form_post redirect to the correct SPA URL.
   * Does NOT mark the state as used — the SPA will post the code to /auth/apple/callback.
   */
  async appleReturn(code: string, state: string): Promise<string> {
    const stateRow = await this.prisma.oAuthState.findUnique({ where: { state } });
    if (!stateRow || stateRow.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
    const redirectUri = stateRow.redirectUri;
    const params = new URLSearchParams({ code, state });
    return `${redirectUri}?${params.toString()}`;
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private issueTokens(
    userId: string,
    email: string,
    meta: SessionMeta,
  ): Promise<AuthTokens> {
    // Delegate to AuthService.issueSessionTokens which handles effectiveRole resolution
    // and session creation consistently with the email/password login path.
    return this.auth.issueSessionTokens(userId, email, meta);
  }

  /**
   * When a provider returns no email, synthesize a stable placeholder address.
   * Per spec: "provider returns no email → account created on subject".
   */
  private resolveEmail(
    provider: string,
    subject: string,
    email: string | null,
  ): string {
    if (email) return email;
    // Synthesize a deterministic, non-deliverable address based on provider+subject.
    // RFC 5321 local-part length limit is 64 chars; subject is a stable opaque ID.
    const safe = subject.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
    return `${provider}_${safe}@users.noemail.local`;
  }

  private async auditLog(
    userId: string,
    action: string,
    meta: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.prisma.auditLog.create({ data: { userId, action, meta } });
  }
}
