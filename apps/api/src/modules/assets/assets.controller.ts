import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { Request } from 'express';
import type { AssetKind, AssetStatus } from '@prisma/client';

interface AuthReq extends Request {
  user: { id: string; email: string };
}

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('project/:projectId')
  async list(@Param('projectId') projectId: string, @Req() req: AuthReq) {
    return this.assets.listForProject(projectId, req.user.id);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: AuthReq) {
    return this.assets.getAsset(id, req.user.id);
  }

  @Post()
  async create(@Body() body: { projectId: string; kind: AssetKind; label: string }, @Req() req: AuthReq) {
    return this.assets.createAsset(body.projectId, body.kind, body.label, req.user.id);
  }

  @Post(':id/versions')
  async addVersion(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthReq) {
    return this.assets.addVersion(id, body as never, req.user.id);
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: AssetStatus }, @Req() req: AuthReq) {
    return this.assets.updateStatus(id, body.status, req.user.id);
  }

  @Delete(':id')
  async softDelete(@Param('id') id: string, @Req() req: AuthReq) {
    return this.assets.softDelete(id, req.user.id);
  }
}
