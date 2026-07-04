import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import type { AssetKind, AssetStatus } from '@prisma/client';

// The JWT payload carries the user id in `sub`; a previous `req.user.id`
// pattern here resolved to undefined, which Prisma silently drops from
// where-filters — the ownership checks below rely on `sub`.
@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('project/:projectId')
  async list(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.assets.listForProject(projectId, user.sub);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.assets.getAsset(id, user.sub);
  }

  @Post()
  async create(@Body() body: { projectId: string; kind: AssetKind; label: string }, @CurrentUser() user: JwtPayload) {
    return this.assets.createAsset(body.projectId, body.kind, body.label, user.sub);
  }

  @Post(':id/versions')
  async addVersion(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: JwtPayload) {
    return this.assets.addVersion(id, body as never, user.sub);
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: AssetStatus }, @CurrentUser() user: JwtPayload) {
    return this.assets.updateStatus(id, body.status, user.sub);
  }

  @Delete(':id')
  async softDelete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.assets.softDelete(id, user.sub);
  }
}
