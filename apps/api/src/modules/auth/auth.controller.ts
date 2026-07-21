import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Res,
  Param,
  Query,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, IsIn } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordResetService } from './password-reset.service';
import { SessionsService } from './sessions.service';
import { OAuthService } from './oauth.service';
import { ProviderRegistry } from './providers/provider.registry';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OwnerGuard } from '../../common/guards/owner.guard';
import { RateLimit } from '../../common/guards/rate-limit.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';

class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() phone?: string;
  /** Client-side device fingerprint for trial abuse scoring (Phase 6 §6). */
  @IsString() @IsOptional() deviceFingerprint?: string;
}

class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

class RefreshDto {
  @IsString() refreshToken!: string;
}

class LogoutDto {
  @IsString() @IsOptional() refreshToken?: string;
}

class OAuthStartDto {
  @IsString() redirectUri!: string;
  @IsOptional() @IsIn(['login', 'link']) mode?: 'login' | 'link';
}

class OAuthCallbackDto {
  @IsString() code!: string;
  @IsString() state!: string;
}

class AppleReturnDto {
  @IsString() code!: string;
  @IsString() state!: string;
}

class OtpSendDto {
  @IsString() identifier!: string;
}

class OtpVerifyDto {
  @IsString() identifier!: string;
  @IsString() code!: string;
}

class UpdatePhoneDto {
  @IsString() @IsOptional() phone?: string | null;
}

class ForgotPasswordDto {
  @IsEmail() email!: string;
}

class ResetPasswordDto {
  @IsString() token!: string;
  @IsString() @MinLength(8) password!: string;
}

class UpdateProfileDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() avatarUrl?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly passwordReset: PasswordResetService,
    private readonly sessions: SessionsService,
    private readonly oauth: OAuthService,
    private readonly registry: ProviderRegistry,
    private readonly jwt: JwtService,
  ) {}

  // ── Existing email/password endpoints ────────────────────────────────────────

  @Post('register')
  @RateLimit({ bucket: 'auth-register', limit: 5, windowSecs: 60 })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, {
      deviceFingerprint: dto.deviceFingerprint,
      ip: req.ip,
      device: req.headers['user-agent'],
    });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'auth-login', limit: 10, windowSecs: 60 })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, {
      ip: req.ip,
      device: req.headers['user-agent'],
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'auth-refresh', limit: 30, windowSecs: 60 })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, {
      ip: req.ip,
      device: req.headers['user-agent'],
    });
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Body() dto: LogoutDto,
  ): Promise<void> {
    await this.auth.logout(user.sub, user.sid, dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.getMe(user.sub);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard, OwnerGuard)
  listSessions(@CurrentUser() user: JwtPayload) {
    return this.sessions.listActive(user.sub, user.sid);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard, OwnerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() user: JwtPayload,
    @Param('id') familyId: string,
  ): Promise<void> {
    await this.sessions.revokeFamily(user.sub, familyId);
  }

  // ── Social sign-in endpoints ─────────────────────────────────────────────────

  /** GET /auth/providers — returns which providers have required env vars configured. */
  @Get('providers')
  providers() {
    return this.registry.status();
  }

  /**
   * POST /auth/:provider/start
   * No guard, but if mode === 'link' the request MUST carry a valid Bearer token.
   */
  @Post(':provider/start')
  async oauthStart(
    @Param('provider') provider: string,
    @Body() dto: OAuthStartDto,
    @Req() req: Request,
  ) {
    let linkUserId: string | undefined;

    if (dto.mode === 'link') {
      // Manually verify the Bearer token — no Passport guard so we can return 401 explicitly
      const authHeader = req.headers['authorization'];
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) throw new UnauthorizedException('Bearer token required for link mode');

      let payload: JwtPayload;
      try {
        payload = this.jwt.verify<JwtPayload>(token);
      } catch {
        throw new UnauthorizedException('Invalid Bearer token');
      }
      linkUserId = payload.sub;
    }

    return this.oauth.start(provider, dto.redirectUri, linkUserId);
  }

  /**
   * POST /auth/:provider/callback
   * Handles both sign-in and account-link flows.
   */
  @Post(':provider/callback')
  @HttpCode(HttpStatus.OK)
  async oauthCallback(
    @Param('provider') provider: string,
    @Body() dto: OAuthCallbackDto,
    @Req() req: Request,
  ) {
    return this.oauth.callback(provider, dto.code, dto.state, {
      ip: req.ip,
      device: req.headers['user-agent'],
    });
  }

  /**
   * POST /auth/apple/return — public endpoint that receives Apple's form_post redirect.
   * Apple uses response_mode=form_post when scopes are requested, so the browser POST-s here.
   * We 302 to <stored redirectUri>?code=...&state=... so the SPA handles the callback.
   */
  @Post('apple/return')
  async appleReturn(
    @Body() dto: AppleReturnDto,
    @Res() res: Response,
  ): Promise<void> {
    const redirectTo = await this.oauth.appleReturn(dto.code, dto.state);
    res.redirect(302, redirectTo);
  }

  /**
   * GET /auth/links — returns linked social providers for the authenticated user.
   */
  @Get('links')
  @UseGuards(JwtAuthGuard)
  getLinks(@CurrentUser() user: JwtPayload) {
    return this.oauth.links(user.sub);
  }

  /**
   * DELETE /auth/link/:provider — unlinks the given provider from the user's account.
   * 409 if it would leave the user with no sign-in method.
   */
  @Delete('link/:provider')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlinkProvider(
    @CurrentUser() user: JwtPayload,
    @Param('provider') provider: string,
  ): Promise<void> {
    await this.oauth.unlink(user.sub, provider);
  }

  // ── OTP sign-in endpoints ─────────────────────────────────────────────────────

  /** POST /auth/otp/send — send a 6-digit sign-in code to email or phone. */
  @Post('otp/send')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ bucket: 'auth-otp-send', limit: 5, windowSecs: 600 })
  async otpSend(@Body() dto: OtpSendDto): Promise<void> {
    await this.otp.send(dto.identifier);
  }

  /** POST /auth/otp/verify — verify code and return session tokens. */
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ bucket: 'auth-otp-verify', limit: 10, windowSecs: 60 })
  otpVerify(@Body() dto: OtpVerifyDto, @Req() req: Request) {
    return this.otp.verify(dto.identifier, dto.code, {
      ip: req.ip,
      device: req.headers['user-agent'],
    });
  }

  /**
   * GET /auth/otp/dev-peek?identifier=... — returns the last OTP code sent to
   * the given email/phone WITHOUT consuming it. Only available when
   * NODE_ENV !== 'production'. Blocked entirely in production.
   */
  @Get('otp/dev-peek')
  @HttpCode(HttpStatus.OK)
  otpDevPeek(@Query('identifier') identifier: string): { code: string } {
    if (process.env['NODE_ENV'] === 'production') {
      throw new ForbiddenException('Dev-peek is not available in production.');
    }
    if (!identifier) throw new NotFoundException('Provide ?identifier=<email-or-phone>');
    const code = this.otp.peekLastCode(identifier);
    if (!code) throw new NotFoundException('No pending OTP for this identifier (expired or not sent via dev fallback).');
    return { code };
  }

  /** PATCH /auth/me/phone — add or update the authenticated user's phone number. */
  @Patch('me/phone')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async updatePhone(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePhoneDto,
  ): Promise<void> {
    await this.auth.updatePhone(user.sub, dto.phone ?? null);
  }

  /** PATCH /auth/me/profile — update display name and/or avatar URL. */
  @Patch('me/profile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<void> {
    await this.auth.updateProfile(user.sub, dto);
  }

  /** POST /auth/forgot-password — send a password reset link to email. */
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ bucket: 'auth-forgot-pw', limit: 3, windowSecs: 600 })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.passwordReset.sendResetEmail(dto.email);
  }

  /** POST /auth/reset-password — set a new password using the emailed token. */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ bucket: 'auth-reset-pw', limit: 5, windowSecs: 60 })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.passwordReset.resetPassword(dto.token, dto.password);
  }
}
