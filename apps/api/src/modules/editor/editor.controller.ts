import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { EditorService } from './editor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';

/**
 * Standalone multi-track video editor API.
 *
 * Routes:
 *   POST   /editor/projects/:projectId   — create EditProject (from source or blank)
 *   GET    /editor/projects/:projectId   — list EditProjects for a project
 *   GET    /editor/:id                   — get a single EditProject
 *   PUT    /editor/:id/timeline          — save/validate timeline JSON
 *   GET    /editor/:id/media-bin         — list droppable assets for the timeline
 *   POST   /editor/:id/render            — enqueue EDIT_RENDER job
 *   GET    /editor/:id/render-status     — poll render status + download path
 */
@Controller('editor')
@UseGuards(JwtAuthGuard)
export class EditorController {
  constructor(private readonly editor: EditorService) {}

  // ── Channel-first entry points (no projectId needed) ─────────────────────────

  /** All edit projects the current user owns, across every project. */
  @Get('mine')
  async mine(@CurrentUser() user: JwtPayload) {
    return this.editor.listAllForUser(user.sub);
  }

  /** Create a blank edit; the container project is resolved server-side. */
  @Post('blank')
  async createBlankForUser(
    @Body() body: { title?: string; width?: number; height?: number; fps?: number },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.editor.createBlankForUser(user.sub, body);
  }

  /** Open an imported video in the editor; projectId is resolved from the video. */
  @Post('from-imported/:importedVideoId')
  async fromImported(
    @Param('importedVideoId') importedVideoId: string,
    @Body() body: { title?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.editor.createFromImportedVideo(importedVideoId, user.sub, body.title);
  }

  /** Create an EditProject. Body: { sourceKind, sourceId, title } | { blank: true, title, width, height, fps } */
  @Post('projects/:projectId')
  async create(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      blank?: boolean;
      title?: string;
      width?: number;
      height?: number;
      fps?: number;
      sourceKind?: 'VIDEO' | 'IMPORTED_VIDEO' | 'ASSET';
      sourceId?: string;
    },
    @CurrentUser() user: JwtPayload,
  ) {
    if (body.blank) {
      return this.editor.createBlank(projectId, user.sub, {
        title: body.title,
        width: body.width,
        height: body.height,
        fps: body.fps,
      });
    }
    if (!body.sourceKind || !body.sourceId) {
      // Default to blank if neither provided
      return this.editor.createBlank(projectId, user.sub, { title: body.title });
    }
    return this.editor.createFromSource(projectId, user.sub, {
      sourceKind: body.sourceKind,
      sourceId: body.sourceId,
      title: body.title,
    });
  }

  /** List all EditProjects for a project */
  @Get('projects/:projectId')
  async list(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.editor.listByProject(projectId, user.sub);
  }

  /** Get a single EditProject */
  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.editor.get(id, user.sub);
  }

  /** Save/validate the timeline JSON */
  @Put(':id/timeline')
  async saveTimeline(
    @Param('id') id: string,
    @Body() body: { timeline: unknown },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.editor.saveTimeline(id, user.sub, body.timeline ?? body);
  }

  /** List assets available to drop on the timeline */
  @Get(':id/media-bin')
  async mediaBin(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.editor.mediaBin(id, user.sub);
  }

  /** Enqueue an EDIT_RENDER job. Body: { preset, format?, quality? } */
  @Post(':id/render')
  async render(
    @Param('id') id: string,
    @Body() body: { preset?: string; format?: 'mp4' | 'webm'; quality?: 'draft' | 'standard' | 'high' },
    @CurrentUser() user: JwtPayload,
  ) {
    // Forward the full export options — the service validates preset/format/quality.
    if (body.format || body.quality) {
      return this.editor.render(id, user.sub, {
        preset: (body.preset ?? 'SOURCE') as never,
        format: body.format,
        quality: body.quality,
      });
    }
    return this.editor.render(id, user.sub, body.preset ?? 'SOURCE');
  }

  /** Poll render status + download path */
  @Get(':id/render-status')
  async renderStatus(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.editor.renderStatus(id, user.sub);
  }
}
