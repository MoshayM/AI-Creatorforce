import { Controller, Get, Post, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { Request } from 'express';

interface AuthReq extends Request {
  user: { id: string; email: string };
}

@Controller('editor')
@UseGuards(JwtAuthGuard)
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get(':projectId/timeline')
  async getDraft(@Param('projectId') projectId: string, @Req() req: AuthReq) {
    return this.timeline.getDraft(projectId, req.user.id);
  }

  @Patch(':projectId/timeline')
  async saveDraft(
    @Param('projectId') projectId: string,
    @Body() body: { tracks: unknown; fps?: number; resolution?: unknown; expectedVersion?: number },
    @Req() req: AuthReq,
  ) {
    return this.timeline.saveDraft(projectId, req.user.id, body.tracks, body.fps, body.resolution, body.expectedVersion);
  }

  @Post(':projectId/timeline/versions')
  async freeze(
    @Param('projectId') projectId: string,
    @Body() body: { label: string },
    @Req() req: AuthReq,
  ) {
    return this.timeline.freezeVersion(projectId, req.user.id, body.label);
  }

  @Post(':projectId/timeline/versions/:v/restore')
  async restore(
    @Param('projectId') projectId: string,
    @Param('v') v: string,
    @Req() req: AuthReq,
  ) {
    return this.timeline.restoreVersion(projectId, req.user.id, parseInt(v, 10));
  }
}
