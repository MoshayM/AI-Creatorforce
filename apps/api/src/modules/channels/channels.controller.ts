import {
  Controller, Get, Post, Delete, Patch, Param, Body, Query,
  UseGuards, Redirect, HttpCode, Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ChannelsService, isAccessLevel } from './channels.service';

class ConnectDto {
  @IsString() code!: string;
  @IsString() redirectUri!: string;
}

class ConnectByUrlDto {
  @IsString() channelUrl!: string;
}

class RefreshDto {
  @IsString() channelId!: string;
}

const WEB_URL = process.env['WEB_URL'] ?? 'http://localhost:3007';
const API_URL = process.env['API_URL'] ?? 'http://localhost:4007';

@ApiTags('channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('channels')
export class ChannelsController {
  private readonly logger = new Logger(ChannelsController.name);

  constructor(private readonly svc: ChannelsService) {}

  @Get('status')
  getStatus(@CurrentUser() user: JwtPayload) {
    return this.svc.getStatus(user.sub);
  }

  @Get('auth-url')
  getAuthUrl(
    @Query('redirectUri') redirectUri: string,
    @Query('access') access: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    const level = isAccessLevel(access) ? access : 'PUBLISH';
    this.logger.log(`[OAuth] auth-url requested — userId=${user.sub} access=${level}`);
    return { url: this.svc.getAuthUrl(redirectUri, user.sub, level) };
  }

  // Public — no JWT; Google redirects here without auth headers.
  // userId is recovered from the base64url-encoded `state` param.
  @Get('oauth/callback')
  @Redirect()
  @Public()
  async oauthCallback(@Query('code') code: string, @Query('state') state: string, @Query('error') oauthError?: string) {
    // Handle user denying access on Google's consent screen
    if (oauthError) {
      this.logger.warn(`[OAuth] Access denied by user — error=${oauthError}`);
      return { url: `${WEB_URL}/channel-access?error=${encodeURIComponent(oauthError)}` };
    }

    if (!code || !state) {
      this.logger.error(`[OAuth] Callback missing code or state`);
      return { url: `${WEB_URL}/channel-access?error=missing_params` };
    }

    this.logger.log(`[OAuth] Callback received — exchanging code`);

    try {
      // State is JSON {u: userId, a: accessLevel}; legacy states were the bare userId
      const decoded = Buffer.from(state, 'base64url').toString('utf8');
      let userId = decoded;
      try {
        const parsed = JSON.parse(decoded) as { u?: string };
        if (parsed.u) userId = parsed.u;
      } catch { /* legacy plain-userId state */ }
      const redirectUri = `${API_URL}/api/v1/channels/oauth/callback`;
      await this.svc.connectChannel(userId, code, redirectUri);
      this.logger.log(`[OAuth] Connection successful — redirecting to settings`);
      return { url: `${WEB_URL}/channel-access?connected=true` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      this.logger.error(`[OAuth] Connection failed — ${message}`);

      // Map known error messages to short error codes for the frontend
      let code = 'oauth_failed';
      if (message.includes('No YouTube channel')) code = 'no_channel';
      else if (message.includes('exchange') || message.includes('invalid_grant')) code = 'invalid_grant';
      else if (message.includes('redirect_uri_mismatch')) code = 'redirect_mismatch';
      else if (message.includes('invalid_client')) code = 'invalid_client';

      return { url: `${WEB_URL}/channel-access?error=${code}` };
    }
  }

  @Post('connect-by-url')
  connectByUrl(@Body() dto: ConnectByUrlDto, @CurrentUser() user: JwtPayload) {
    return this.svc.connectChannelByUrl(user.sub, dto.channelUrl);
  }

  @Post('connect')
  connect(@Body() dto: ConnectDto, @CurrentUser() user: JwtPayload) {
    return this.svc.connectChannel(user.sub, dto.code, dto.redirectUri);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.svc.listChannels(user.sub);
  }

  @Delete(':id')
  disconnect(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.disconnectChannel(id, user.sub);
  }

  @Post(':id/remove')
  @HttpCode(200)
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.svc.removeChannel(id, user.sub);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @CurrentUser() user: JwtPayload) {
    return this.svc.refreshChannelToken(dto.channelId, user.sub);
  }

  @Patch(':id')
  updateChannel(
    @Param('id') id: string,
    @Body() body: { niche?: string; brandKit?: Record<string, unknown>; voiceProfile?: Record<string, unknown> },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.svc.updateChannel(id, user.sub, body);
  }
}
