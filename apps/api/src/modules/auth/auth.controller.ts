import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Res,
  Param,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, IsIn } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { OAuthService } from './oauth.service';
import { ProviderRegistry } from './providers/provider.registry';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';

class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @IsOptional() name?: string;
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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly oauth: OAuthService,
    private readonly registry: ProviderRegistry,
    private readonly jwt: JwtService,
  ) {}

  // ── Existing email/password endpoints ────────────────────────────────────────

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, {
      deviceFingerprint: dto.deviceFingerprint,
      ip: req.ip,
      device: req.headers['user-agent'],
    });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, {
      ip: req.ip,
      device: req.headers['user-agent'],
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
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
  @UseGuards(JwtAuthGuard)
  listSessions(@CurrentUser() user: JwtPayload) {
    return this.sessions.listActive(user.sub, user.sid);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
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
}
