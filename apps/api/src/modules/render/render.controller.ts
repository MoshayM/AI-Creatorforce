import { Controller, Get, Post, Param, Query, Body, UseGuards, Req } from '@nestjs/common';
import { RenderService } from './render.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { Request } from 'express';
import type { RenderPreset } from '@prisma/client';

interface AuthReq extends Request {
  user: { id: string; email: string };
}

@Controller('render')
@UseGuards(JwtAuthGuard)
export class RenderController {
  constructor(private readonly render: RenderService) {}

  @Post()
  async queue(
    @Body() body: { projectId: string; timelineVersion: number; preset: RenderPreset },
    @Req() req: AuthReq,
  ) {
    return this.render.queueRender(body.projectId, body.timelineVersion, body.preset, req.user.id);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: AuthReq) {
    return this.render.getRender(id, req.user.id);
  }

  @Get()
  async list(@Query('projectId') projectId: string, @Req() req: AuthReq) {
    return this.render.listForProject(projectId, req.user.id);
  }
}
