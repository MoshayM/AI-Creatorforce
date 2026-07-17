import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { resolveElevatedRole } from '../../common/rbac';
import { TrialService } from '../trial/trial.service';
import { SessionsService, hashRefreshToken } from './sessions.service';
import type { SessionMeta } from './sessions.service';

export interface RegisterDto {
  email: string;
  password: string;
  name?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly trial: TrialService,
    private readonly sessions: SessionsService,
  ) {}

  async register(
    dto: RegisterDto,
    signals: { deviceFingerprint?: string; ip?: string; device?: string } = {},
  ): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const isFirst = (await this.prisma.user.count()) === 0;
    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, passwordHash, role: isFirst ? 'OWNER' : 'MEMBER' },
    });

    // Phase 6 §5: trial grant on signup — abuse-scored, one per identity;
    // a failure here must never break registration itself.
    await this.trial
      .grantTrial(user.id, user.email, { ...signals, verificationMethod: 'email' })
      .catch(() => undefined);

    const tokens = await this.issueSessionTokens(user.id, user.email, {
      device: signals.device,
      ip: signals.ip,
    });

    await this.audit(user.id, 'auth.register', { email: user.email });

    return tokens;
  }

  async login(dto: LoginDto, meta: SessionMeta = {}): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.issueSessionTokens(user.id, user.email, meta);

    await this.audit(user.id, 'auth.login', { email: user.email });

    return tokens;
  }

  /**
   * Rotates a refresh token and issues a fresh access token.
   * SessionsService.rotate handles reuse-detection and family revocation.
   */
  async refresh(refreshToken: string, meta: SessionMeta = {}): Promise<AuthTokens> {
    const {
      refreshToken: newRefreshToken,
      familyId,
      userId,
    } = await this.sessions.rotate(refreshToken, meta);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const role = await this.effectiveRole(user);

    const payload: JwtPayload = { sub: user.id, email: user.email, role, sid: familyId };
    const accessToken = this.jwt.sign(payload);

    return { accessToken, refreshToken: newRefreshToken };
  }

  /**
   * Revokes the caller's session family.
   * Resolves familyId from the sid JWT claim or falls back to the refresh token hash.
   * Never throws if the session was already revoked.
   */
  async logout(
    userId: string,
    sid?: string,
    refreshToken?: string,
  ): Promise<void> {
    let familyId = sid;

    if (!familyId && refreshToken) {
      const hash = hashRefreshToken(refreshToken);
      const row = await this.prisma.authSession.findUnique({
        where: { refreshTokenHash: hash },
        select: { familyId: true },
      });
      familyId = row?.familyId;
    }

    if (familyId) {
      await this.sessions.revokeFamily(userId, familyId).catch(() => undefined);
    }
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, name: user.name, role: user.role, phone: user.phone ?? null };
  }

  async registerPasswordless(
    email: string,
    name?: string,
    signals: { ip?: string; device?: string } = {},
  ): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const isFirst = (await this.prisma.user.count()) === 0;
    const user = await this.prisma.user.create({
      data: { email, name, passwordHash: null, role: isFirst ? 'OWNER' : 'MEMBER', emailVerified: new Date() },
    });

    await this.trial
      .grantTrial(user.id, user.email, { ...signals, verificationMethod: 'otp' })
      .catch(() => undefined);

    const tokens = await this.issueSessionTokens(user.id, user.email, {
      device: signals.device,
      ip: signals.ip,
    });

    await this.audit(user.id, 'auth.register_otp', { email: user.email });

    return tokens;
  }

  async updatePhone(userId: string, phone: string | null): Promise<void> {
    if (phone) {
      const normalized = phone.trim();
      const existing = await this.prisma.user.findFirst({
        where: { phone: normalized, NOT: { id: userId } },
        select: { id: true },
      });
      if (existing) throw new ConflictException('Phone number already in use');
      await this.prisma.user.update({ where: { id: userId }, data: { phone: normalized } });
    } else {
      await this.prisma.user.update({ where: { id: userId }, data: { phone: null } });
    }
    await this.audit(userId, 'auth.phone_update', { phone: phone ? 'set' : 'removed' });
  }

  async validateJwt(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();
    const role = await this.effectiveRole(user);

    // Back-compat: tokens issued before session management carry no sid — let them through.
    if (payload.sid) {
      const active = await this.sessions.isFamilyActive(payload.sid);
      if (!active) throw new UnauthorizedException('Session has been revoked');
    }

    // Propagate sid so controllers can read it via @CurrentUser().
    return { sub: user.id, email: user.email, role, sid: payload.sid };
  }

  /**
   * Env-configured elevation (billing spec §9.2/§9.9): SUPER_ADMIN_EMAILS /
   * OWNER_EMAILS grant elevated roles without hardcoding identities in
   * source. The elevation is persisted so audits show the real role; removal
   * from the env list demotes SUPER_ADMINs back to OWNER on next validation.
   */
  private async effectiveRole(user: User): Promise<User['role']> {
    const elevated = resolveElevatedRole(user.email);
    const target = elevated ?? (user.role === 'SUPER_ADMIN' ? 'OWNER' : user.role);
    if (target !== user.role) {
      await this.prisma.user.update({ where: { id: user.id }, data: { role: target } });
    }
    return target;
  }

  /**
   * Creates an AuthSession and signs an access JWT embedding the session family ID (sid).
   * Both tokens are returned — the refresh token is stored by the client and exchanged via /auth/refresh.
   * Exposed as public so OAuthService (same module) can reuse it without duplicating session logic.
   */
  async issueSessionTokens(
    userId: string,
    email: string,
    meta: SessionMeta,
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const role = user ? await this.effectiveRole(user) : 'MEMBER';

    const { refreshToken, familyId } = await this.sessions.issue(userId, meta);

    const payload: JwtPayload = { sub: userId, email, role, sid: familyId };
    const accessToken = this.jwt.sign(payload);

    return { accessToken, refreshToken };
  }

  private async audit(
    userId: string,
    action: string,
    meta: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.prisma.auditLog.create({ data: { userId, action, meta } });
  }
}
