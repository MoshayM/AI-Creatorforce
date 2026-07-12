import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { DeveloperKeyGuard, RequireScope } from './developer-key.guard';
import { WalletService } from '../wallet/wallet.service';
import { ChannelsService } from '../channels/channels.service';

interface DevKeyUser {
  sub: string;
  scopes: string[];
  sandbox: boolean;
  developerKeyId: string;
}

/**
 * Public developer API surface — authenticated via DeveloperKeyGuard.
 *
 * These endpoints prove the guard and scope system. They are intentionally
 * minimal; the full resource API will expand in later waves.
 *
 * Sandbox note: sandbox keys are accepted here. Routes that would spend
 * real credits MUST check `req.user.sandbox` and reject or use play-money.
 */
@ApiTags('developer-api')
@ApiSecurity('api-key')
@Controller('dev-api/v1')
@UseGuards(DeveloperKeyGuard)
export class DevApiController {
  constructor(
    private readonly wallet: WalletService,
    private readonly channels: ChannelsService,
  ) {}

  /** Returns the identity and capabilities associated with the API key. */
  @Get('me')
  me(@Request() req: ExpressRequest & { user: DevKeyUser }) {
    const { sub: userId, scopes, sandbox } = req.user;
    return { userId, scopes, sandbox };
  }

  /** Returns the caller's wallet balance. Requires scope: wallet:read */
  @Get('wallet/balance')
  @RequireScope('wallet:read')
  async walletBalance(@Request() req: ExpressRequest & { user: DevKeyUser }) {
    return this.wallet.getBalance(req.user.sub);
  }

  /** Returns the caller's channels (id + title only). Requires scope: channels:read */
  @Get('channels')
  @RequireScope('channels:read')
  async listMyChannels(@Request() req: ExpressRequest & { user: DevKeyUser }) {
    const all = await this.channels.listChannels(req.user.sub);
    return all.map((c) => ({ id: c.id, title: c.title }));
  }
}
