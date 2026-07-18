import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../common/prisma/prisma.service';

const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendResetEmail(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true, name: true },
    });
    // Always return 204 — don't reveal whether account exists
    if (!user) return;

    // @reason: passwordResetToken added via db push; TS types not regenerated while API is running
    const prt = (this.prisma as any).passwordResetToken;

    // Invalidate any existing unused tokens for this user
    await prt.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + EXPIRY_MS);

    await prt.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const baseUrl = this.config.get<string>('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3007';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await this.sendEmail(user.email, user.name ?? 'Creator', resetUrl);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('Reset link is invalid or has expired. Please request a new one.');
    }

    if (newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { tokenHash },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  private async sendEmail(to: string, name: string, resetUrl: string): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      console.log(`\n[PASSWORD RESET DEV] Reset URL for ${to}:\n${resetUrl}\n`);
      return;
    }
    const transport = nodemailer.createTransport({
      host,
      port: Number(this.config.get('SMTP_PORT') ?? 587),
      secure: false,
      auth: { user: this.config.get('SMTP_USER'), pass: this.config.get('SMTP_PASS') },
    });
    await transport.sendMail({
      from: this.config.get('SMTP_FROM') ?? 'noreply@creatorforce.ai',
      to,
      subject: 'Reset your CreatorForce password',
      text: `Hi ${name},\n\nClick this link to reset your password (expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="color:#7b5ec7;margin-top:0">Reset your password</h2><p style="color:#333">Hi ${name},</p><p style="color:#555">Click the button below to set a new password. This link expires in 1 hour.</p><a href="${resetUrl}" style="display:inline-block;margin:16px 0;padding:12px 28px;background:#7a63cb;color:#fff;text-decoration:none;border-radius:9999px;font-weight:600">Reset Password</a><p style="color:#888;font-size:12px">If you didn't request this, you can safely ignore this email.</p></div>`,
    });
  }
}
