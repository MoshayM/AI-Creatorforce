import { Controller, Get, Post, Param, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { IsString, IsArray, IsIn } from 'class-validator';
import type { ClipType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ShortsStudioService } from './shorts-studio.service';
import { YouTubeReadService } from './youtube-read.service';
import { VideoImportService } from './video-import.service';
import { ClipRecommendationService } from './clip-recommendation.service';
import { ShortsGenerationService } from './shorts-generation.service';

class ImportVideoDto {
  @IsString() projectId!: string;
  @IsString() youtubeVideoId!: string;
}

const CLIP_TYPES = ['YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'TIKTOK', 'LINKEDIN_CLIPS', 'FACEBOOK_REELS', 'PODCAST_HIGHLIGHTS'] as const;

class GenerateClipsDto {
  @IsArray() @IsIn(CLIP_TYPES, { each: true }) clipTypes!: ClipType[];
}

// ai.md Section 18 — routes live under /api/v1/shorts-studio (existing global
// prefix + URI versioning). Job status detail stays on the existing /jobs API.
@Controller('shorts-studio')
@UseGuards(JwtAuthGuard)
export class ShortsStudioController {
  constructor(
    private readonly shorts: ShortsStudioService,
    private readonly youtubeRead: YouTubeReadService,
    private readonly videoImport: VideoImportService,
    private readonly recommendations: ClipRecommendationService,
    private readonly generation: ShortsGenerationService,
  ) {}

  // ── Import (18.1) ───────────────────────────────────────────────────────────

  @Get('channels/:channelId/videos')
  async listChannelVideos(
    @Param('channelId') channelId: string,
    @Query('pageToken') pageToken: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.shorts.assertChannelOwnership(channelId, user.sub);
    return this.youtubeRead.listChannelVideos(channelId, pageToken);
  }

  @Get('videos/:youtubeVideoId/metadata')
  async videoMetadata(
    @Param('youtubeVideoId') youtubeVideoId: string,
    @Query('channelId') channelId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.shorts.assertChannelOwnership(channelId, user.sub);
    return this.youtubeRead.getVideoMetadata(channelId, youtubeVideoId);
  }

  @Post('videos/import')
  async importVideo(@Body() dto: ImportVideoDto, @CurrentUser() user: JwtPayload) {
    return this.videoImport.importVideo(user.sub, dto.projectId, dto.youtubeVideoId);
  }

  @Get('projects/:projectId/videos')
  async listImported(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertProjectOwnership(projectId, user.sub);
    return this.shorts.listImportedVideos(projectId);
  }

  // ── Analyze (18.2) ──────────────────────────────────────────────────────────

  @Post('videos/:importedVideoId/analyze')
  async analyze(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.enqueueAnalysis(importedVideoId, user.sub);
  }

  @Get('videos/:importedVideoId/analysis-status')
  async analysisStatus(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.analysisStatus(importedVideoId, user.sub);
  }

  @Get('videos/:importedVideoId/transcript')
  async transcript(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.getTranscriptSegments(importedVideoId, user.sub);
  }

  @Get('videos/:importedVideoId/scenes')
  async scenes(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.getScenes(importedVideoId, user.sub);
  }

  // ── Topics & Highlights (18.2) ──────────────────────────────────────────────

  @Get('videos/:importedVideoId/topics')
  async topics(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.getTopics(importedVideoId, user.sub);
  }

  @Get('videos/:importedVideoId/highlights')
  async highlights(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.getHighlights(importedVideoId, user.sub);
  }

  // ── Generate (18.3) ─────────────────────────────────────────────────────────

  @Get('videos/:importedVideoId/recommendations')
  async recommend(
    @Param('importedVideoId') importedVideoId: string,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.shorts.assertVideoOwnership(importedVideoId, user.sub);
    const n = Math.min(Math.max(parseInt(limit ?? '10', 10) || 10, 1), 20);
    return this.recommendations.recommend(importedVideoId, n);
  }

  @Post('highlights/:highlightId/generate-clips')
  async generateClips(
    @Param('highlightId') highlightId: string,
    @Body() dto: GenerateClipsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (dto.clipTypes.length === 0) throw new BadRequestException('clipTypes must not be empty');
    await this.shorts.assertHighlightOwnership(highlightId, user.sub);
    return this.generation.generateClips(highlightId, dto.clipTypes);
  }

  @Get('projects/:projectId/clips')
  async listClips(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertProjectOwnership(projectId, user.sub);
    return this.generation.listClips(projectId);
  }
}
