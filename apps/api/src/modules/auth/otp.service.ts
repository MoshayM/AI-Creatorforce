import { Injectable, BadRequestException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from './auth.service';
import type { SessionMeta } from './sessions.service';

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_MAX_PER_WINDOW = 5;

/** Dev-only in-memory store so /auth/otp/dev-peek can surface codes without email. */
const DEV_OTP_STORE = new Map<string, { code: string; expiresAt: number }>();

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

  /**
   * Returns the last OTP code sent to `identifier` — only works when
   * NODE_ENV !== 'production'. Used by the /auth/otp/dev-peek endpoint so
   * developers can sign in without configuring an email provider.
   */
  peekLastCode(identifier: string): string | null {
    if (process.env['NODE_ENV'] === 'production') return null;
    const entry = DEV_OTP_STORE.get(identifier.trim().toLowerCase());
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.code;
  }

  private async sendEmail(to: string, code: string): Promise<void> {
    const html = `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:24px"><h2 style="color:#7b5ec7;margin-top:0">Your sign-in code</h2><p style="font-size:40px;font-weight:700;letter-spacing:10px;color:#1a1a2e;margin:16px 0">${code}</p><p style="color:#555;font-size:14px">Expires in 10 minutes. Never share this code with anyone.</p></div>`;
    const text = `Your one-time sign-in code is: ${code}\n\nExpires in 10 minutes. Never share this code.`;
    const subject = 'Your CreatorForce sign-in code';
    const from = this.config.get<string>('SMTP_FROM') ?? this.config.get<string>('RESEND_FROM') ?? 'noreply@creatorforce.ai';

    // 1. Resend (https://resend.com) — preferred provider, no SMTP setup needed.
    const resendKey = this.config.get<string>('RESEND_API_KEY');
    if (resendKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, html, text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Resend email failed (${res.status}): ${body}`);
      }
      return;
    }

    // 2. SMTP (nodemailer) — configured via SMTP_HOST + SMTP_USER + SMTP_PASS.
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      const transport = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT') ?? 587),
        secure: this.config.get('SMTP_SECURE') === 'true',
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
      await transport.sendMail({ from, to, subject, text, html });
      return;
    }

    // 3. Dev fallback — store in memory for /auth/otp/dev-peek; log to console.
    DEV_OTP_STORE.set(to, { code, expiresAt: Date.now() + OTP_EXPIRY_MS });
    console.warn(
      `\n╔══════════════════════════════════════════════════════╗\n` +
      `║  [OTP DEV] No email provider configured              ║\n` +
      `║  To: ${to.padEnd(46)}║\n` +
      `║  Code: ${code.padEnd(44)}║\n` +
      `║  → GET /api/v1/auth/otp/dev-peek?identifier=${to.padEnd(9)}║\n` +
      `╚══════════════════════════════════════════════════════╝\n`,
    );
  }

  private async sendSms(to: string, code: string): Promise<void> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_FROM');

    if (!sid || !token || !from) {
      // Dev fallback — store for /auth/otp/dev-peek and log visibly.
      DEV_OTP_STORE.set(to, { code, expiresAt: Date.now() + OTP_EXPIRY_MS });
      console.warn(
        `\n╔══════════════════════════════════════════════════════╗\n` +
        `║  [OTP DEV] No SMS provider configured                ║\n` +
        `║  To: ${to.padEnd(46)}║\n` +
        `║  OTP: ${code.padEnd(44)}║\n` +
        `║  → GET /api/v1/auth/otp/dev-peek?identifier=${to.padEnd(9)}║\n` +
        `╚══════════════════════════════════════════════════════╝\n`,
      );
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
          Body: `Your CreatorForce OTP is ${code}. Valid for 10 min. Never share this.`,
        }).toString(),
      },
    );
    if (!res.ok) throw new Error(`SMS send failed: ${res.status}`);
  }
}
