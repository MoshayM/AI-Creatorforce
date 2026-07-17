import { Injectable, BadRequestException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import type { SessionMeta } from './sessions.service';

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_MAX_PER_WINDOW = 5;

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async send(identifier: string): Promise<void> {
    const normalized = identifier.trim().toLowerCase();
    const type: 'EMAIL' | 'PHONE' = normalized.includes('@') ? 'EMAIL' : 'PHONE';

    const windowStart = new Date(Date.now() - OTP_EXPIRY_MS);
    const recentCount = await (this.prisma as any).otpCode.count({
      where: { identifier: normalized, createdAt: { gte: windowStart } },
    });
    if (recentCount >= OTP_MAX_PER_WINDOW) {
      throw new BadRequestException('Too many OTP requests. Please wait a few minutes.');
    }

    const userExists =
      type === 'EMAIL'
        ? !!(await this.prisma.user.findUnique({ where: { email: normalized }, select: { id: true } }))
        : !!(await this.prisma.user.findFirst({ where: { phone: normalized }, select: { id: true } }));

    if (!userExists) return; // silent no-op for security

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await (this.prisma as any).otpCode.create({
      data: { identifier: normalized, codeHash, type, expiresAt },
    });

    if (type === 'EMAIL') {
      await this.sendEmail(normalized, code);
    } else {
      await this.sendSms(normalized, code);
    }
  }

  async verify(
    identifier: string,
    code: string,
    meta: SessionMeta = {},
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const normalized = identifier.trim().toLowerCase();
    const type: 'EMAIL' | 'PHONE' = normalized.includes('@') ? 'EMAIL' : 'PHONE';

    const otpRow = await (this.prisma as any).otpCode.findFirst({
      where: { identifier: normalized, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRow) throw new UnauthorizedException('Invalid or expired code');

    const valid = await bcrypt.compare(code, otpRow.codeHash);
    if (!valid) throw new UnauthorizedException('Invalid or expired code');

    await (this.prisma as any).otpCode.update({
      where: { id: otpRow.id },
      data: { usedAt: new Date() },
    });

    const user =
      type === 'EMAIL'
        ? await this.prisma.user.findUnique({
            where: { email: normalized },
            select: { id: true, email: true },
          })
        : await this.prisma.user.findFirst({
            where: { phone: normalized },
            select: { id: true, email: true },
          });

    if (!user) throw new UnauthorizedException('Account not found');

    await this.prisma.auditLog.create({
      data: { userId: user.id, action: 'auth.otp_login', meta: { identifier: normalized, type } },
    });

    return this.auth.issueSessionTokens(user.id, user.email, meta);
  }

  async registerSend(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (existing) throw new ConflictException('Email already registered. Please sign in instead.');

    const windowStart = new Date(Date.now() - OTP_EXPIRY_MS);
    const recentCount = await (this.prisma as any).otpCode.count({
      where: { identifier: normalized, createdAt: { gte: windowStart } },
    });
    if (recentCount >= OTP_MAX_PER_WINDOW) {
      throw new BadRequestException('Too many OTP requests. Please wait a few minutes.');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    await (this.prisma as any).otpCode.create({
      data: { identifier: normalized, codeHash, type: 'EMAIL', expiresAt },
    });

    await this.sendEmail(normalized, code);
  }

  async registerVerify(
    email: string,
    code: string,
    name?: string,
    meta: SessionMeta = {},
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const normalized = email.trim().toLowerCase();

    const otpRow = await (this.prisma as any).otpCode.findFirst({
      where: { identifier: normalized, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRow) throw new UnauthorizedException('Invalid or expired code');

    const valid = await bcrypt.compare(code, otpRow.codeHash);
    if (!valid) throw new UnauthorizedException('Invalid or expired code');

    await (this.prisma as any).otpCode.update({
      where: { id: otpRow.id },
      data: { usedAt: new Date() },
    });

    return this.auth.registerPasswordless(normalized, name, meta);
  }

  private async sendEmail(to: string, code: string): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      // Dev fallback: print to console
      console.log(`\n[OTP DEV] Sign-in code for ${to}: ${code}\n`);
      return;
    }
    const transport = nodemailer.createTransport({
      host,
      port: Number(this.config.get('SMTP_PORT') ?? 587),
      secure: false,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
    await transport.sendMail({
      from: this.config.get<string>('SMTP_FROM') ?? 'noreply@creatorforce.ai',
      to,
      subject: 'Your CreatorForce sign-in code',
      text: `Your one-time sign-in code is: ${code}\n\nExpires in 10 minutes. Never share this code.`,
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px"><h2 style="color:#7b5ec7;margin-top:0">Your sign-in code</h2><p style="font-size:40px;font-weight:700;letter-spacing:10px;color:#1a1a2e;margin:16px 0">${code}</p><p style="color:#555;font-size:14px">Expires in 10 minutes. Never share this code with anyone.</p></div>`,
    });
  }

  private async sendSms(to: string, code: string): Promise<void> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_FROM');
    if (!sid || !token || !from) {
      console.log(`\n[OTP DEV] SMS code for ${to}: ${code}\n`);
      return;
    }
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: from,
          Body: `Your CreatorForce sign-in code is ${code}. Valid for 10 min.`,
        }).toString(),
      },
    );
    if (!res.ok) throw new Error(`SMS send failed: ${res.status}`);
  }
}
