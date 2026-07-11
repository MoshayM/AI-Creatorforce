import {
  Controller, Get, Post, Patch, Param, Query, Body,
  UseGuards, NotFoundException, HttpCode,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsArray, IsString, ArrayMaxSize } from 'class-validator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AGENT_QUEUE } from '../jobs/jobs.constants';
import { LibraryService } from './library.service';

class ReorderDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  itemIds!: string[];
}

@ApiTags('channels')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('channels')
export class LibraryController {
  constructor(
    private readonly library: LibraryService,
    private readonly prisma: PrismaService,
    @InjectQueue(AGENT_QUEUE) private readonly queue: Queue,
  ) {}

  // ── Ownership guard helper ─────────────────────────────────────────────────

  private async assertOwner(channelId: string, userId: string): Promise<void> {
    const ch = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
      select: { id: true },
    });
    if (!ch) throw new NotFoundException('Channel not found');
  }

  // ── Sync endpoints ─────────────────────────────────────────────────────────

  /**
   * POST /channels/:id/sync
   * Enqueue a CHANNEL_SYNC job (idempotent — returns existing jobId if already running).
   */
  @Post(':id/sync')
  @HttpCode(200)
  async enqueueSync(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assertOwner(id, user.sub);

    // Idempotency: if an active job exists for this channel, return it
    const existing = await this.prisma.agentJob.findFirst({
      where: {
        type: 'CHANNEL_SYNC',
        status: { in: ['PENDING', 'QUEUED', 'RUNNING'] },
        payload: { path: ['channelId'], equals: id },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { jobId: existing.id };

    // Create AgentJob with null projectId (channel-scoped sync)
    const job = await this.prisma.agentJob.create({
      data: {
        projectId: null,
        type: 'CHANNEL_SYNC',
        status: 'PENDING',
        payload: { channelId: id } as never,
      },
    });

    await this.queue.add(
      'CHANNEL_SYNC',
      { jobId: job.id, projectId: '', type: 'CHANNEL_SYNC', payload: { channelId: id } },
      { jobId: job.id, attempts: 1 },
    );

    await this.prisma.agentJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'QUEUED' },
    });

    return { jobId: job.id };
  }

  /**
   * GET /channels/:id/sync-status
   */
  @Get(':id/sync-status')
  async getSyncStatus(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assertOwner(id, user.sub);
    return this.library.syncStatus(id);
  }

  // ── Video endpoints ────────────────────────────────────────────────────────

  /**
   * GET /channels/:id/videos?cursor=&q=&type=video|short&sort=recent|title
   */
  @Get(':id/videos')
  async listVideos(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('sort') sort?: string,
  ) {
    await this.assertOwner(id, user.sub);

    // Whitelist validation — invalid values fall back to defaults per spec
    const validType = type === 'video' || type === 'short' ? type : undefined;
    const validSort = sort === 'recent' || sort === 'title' ? sort : 'recent';

    return this.library.listVideos(id, { cursor, q, type: validType, sort: validSort });
  }

  // ── Playlist endpoints ─────────────────────────────────────────────────────

  /**
   * GET /channels/:id/playlists?cursor=
   */
  @Get(':id/playlists')
  async listPlaylists(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
  ) {
    await this.assertOwner(id, user.sub);
    return this.library.listPlaylists(id, cursor);
  }

  /**
   * GET /channels/:id/playlists/:pid/items?cursor=
   */
  @Get(':id/playlists/:pid/items')
  async listPlaylistItems(
    @Param('id') id: string,
    @Param('pid') pid: string,
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
  ) {
    await this.assertOwner(id, user.sub);
    return this.library.listPlaylistItems(id, pid, cursor);
  }

  /**
   * PATCH /channels/:id/playlists/:pid/order
   * Body: { itemIds: string[] }
   */
  @Patch(':id/playlists/:pid/order')
  @HttpCode(200)
  async reorderPlaylist(
    @Param('id') id: string,
    @Param('pid') pid: string,
    @Body() dto: ReorderDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertOwner(id, user.sub);
    await this.library.reorderPlaylist(id, pid, dto.itemIds);
    return { ok: true };
  }
}
