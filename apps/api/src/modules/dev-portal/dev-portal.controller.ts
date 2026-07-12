import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DevPortalService, CreateKeyDto, CreateWebhookDto } from './dev-portal.service';

interface JwtUser {
  sub: string;
}

/**
 * Portal management endpoints — authenticated via JwtAuthGuard (normal user
 * session). Lets users create/list/delete their developer keys and webhooks.
 */
@Controller('dev')
@UseGuards(JwtAuthGuard)
export class DevPortalController {
  constructor(private readonly devPortal: DevPortalService) {}

  // ── API Keys ─────────────────────────────────────────────────────────────────

  @Post('keys')
  createKey(
    @Request() req: ExpressRequest & { user: JwtUser },
    @Body() dto: CreateKeyDto,
  ) {
    return this.devPortal.createKey(req.user.sub, dto);
  }

  @Get('keys')
  listKeys(@Request() req: ExpressRequest & { user: JwtUser }) {
    return this.devPortal.listKeys(req.user.sub);
  }

  /**
   * Per-key request analytics over the last `days` UTC days (default 30,
   * clamped 1–90): totals + sparse per-day counts for each of my keys.
   */
  @Get('usage')
  usage(
    @Request() req: ExpressRequest & { user: JwtUser },
    @Query('days') days?: string,
  ) {
    return this.devPortal.usage(req.user.sub, days ? parseInt(days, 10) : undefined);
  }

  @Delete('keys/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeKey(
    @Request() req: ExpressRequest & { user: JwtUser },
    @Param('id') id: string,
  ): Promise<void> {
    await this.devPortal.revokeKey(req.user.sub, id);
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────────

  @Post('webhooks')
  createWebhook(
    @Request() req: ExpressRequest & { user: JwtUser },
    @Body() dto: CreateWebhookDto,
  ) {
    return this.devPortal.createWebhook(req.user.sub, dto);
  }

  @Get('webhooks')
  listWebhooks(@Request() req: ExpressRequest & { user: JwtUser }) {
    return this.devPortal.listWebhooks(req.user.sub);
  }

  @Delete('webhooks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteWebhook(
    @Request() req: ExpressRequest & { user: JwtUser },
    @Param('id') id: string,
  ): Promise<void> {
    await this.devPortal.deleteWebhook(req.user.sub, id);
  }

  @Post('webhooks/:id/test')
  async testWebhook(
    @Request() req: ExpressRequest & { user: JwtUser },
    @Param('id') id: string,
  ) {
    await this.devPortal.emit(req.user.sub, 'test.ping', {
      webhookId: id,
      timestamp: new Date().toISOString(),
    });
    return { queued: true };
  }
}
