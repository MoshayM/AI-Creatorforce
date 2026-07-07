import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';
import { resolveElevatedRole } from '../../common/rbac';

export interface RegisterDto {
  email: string;
  password: string;
  name?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const isFirst = (await this.prisma.user.count()) === 0;
    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, passwordHash, role: isFirst ? 'OWNER' : 'MEMBER' },
    });

    return this.signToken(user.id, user.email);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.signToken(user.id, user.email);
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }

  async validateJwt(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException();
    const role = await this.effectiveRole(user);
    return { sub: user.id, email: user.email, role };
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

  private async signToken(userId: string, email: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const role = user ? await this.effectiveRole(user) : 'MEMBER';
    const payload: JwtPayload = { sub: userId, email, role };
    return { accessToken: this.jwt.sign(payload) };
  }
}
