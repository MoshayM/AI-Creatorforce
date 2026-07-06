import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { IsString, IsArray, IsIn } from 'class-validator';
import type { ClipType } from '@prisma/client';
import { ApplyCommandsSchema, AssistCapabilitySchema } from '@cf/shared';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { ShortsStudioService } from './shorts-studio.service';
import { YouTubeReadService } from './youtube-read.service';
import { VideoImportService } from './video-import.service';
import { ClipRecommendationService } from './clip-recommendation.service';
import { ShortsGenerationService } from './shorts-generation.service';
import { TimelineService } from './timeline.service';
import { AiEditingAssistantService } from './ai-editing-assistant.service';
import { ThumbnailGenerationService } from './thumbnail-generation.service';
import { ShortsExportService } from './shorts-export.service';
import { JobsService } from '../jobs/jobs.service';

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
    private readonly timeline: TimelineService,
    private readonly assistant: AiEditingAssistantService,
    private readonly thumbnails: ThumbnailGenerationService,
    private readonly exports: ShortsExportService,
    private readonly jobs: JobsService,
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

  @Get('videos/:importedVideoId/clips')
  async videoClips(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.getClipsForVideo(importedVideoId, user.sub);
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

  // ── Timeline / Editor (18.4) ────────────────────────────────────────────────

  @Get('clips/:shortClipId/timeline')
  async clipTimeline(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    return this.timeline.getTimelineForClip(shortClipId, user.sub);
  }

  @Patch('timelines/:timelineId')
  async patchTimeline(
    @Param('timelineId') timelineId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const parsed = ApplyCommandsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid commands');
    await this.timeline.assertTimelineOwnership(timelineId, user.sub);
    return this.timeline.applyCommands(timelineId, user.sub, parsed.data.commands);
  }

  @Post('timelines/:timelineId/ai-suggestions')
  async aiSuggestions(
    @Param('timelineId') timelineId: string,
    @Body() body: { capability?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const capability = AssistCapabilitySchema.safeParse(body?.capability);
    if (!capability.success) throw new BadRequestException('capability must be remove-silence | remove-fillers | improve-pacing');
    await this.timeline.assertTimelineOwnership(timelineId, user.sub);
    return this.assistant.suggest(timelineId, capability.data);
  }

  @Post('timelines/:timelineId/ai-suggestions/apply')
  async applySuggestions(
    @Param('timelineId') timelineId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const parsed = ApplyCommandsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid commands');
    await this.timeline.assertTimelineOwnership(timelineId, user.sub);
    // Audit-tagged as the assistant even though a human accepted it (ai.md 9.2)
    return this.timeline.applyCommands(timelineId, 'AI_ASSISTANT', parsed.data.commands);
  }

  @Get('timelines/:timelineId/history')
  async timelineHistory(@Param('timelineId') timelineId: string, @CurrentUser() user: JwtPayload) {
    return this.timeline.history(timelineId, user.sub);
  }

  @Post('clips/:shortClipId/captions')
  async generateCaptions(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    const clip = await this.shorts.assertClipOwnership(shortClipId, user.sub);
    return this.jobs.enqueue(clip.projectId, 'CAPTION_GENERATION', { shortClipId });
  }

  // ── Render (18.5) ───────────────────────────────────────────────────────────

  @Post('clips/:shortClipId/render')
  async renderClip(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    const clip = await this.shorts.assertClipOwnership(shortClipId, user.sub);
    return this.jobs.enqueue(clip.projectId, 'SHORTS_RENDER', { shortClipId });
  }

  @Get('clips/:shortClipId/render-status')
  async renderStatus(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    const clip = await this.shorts.assertClipOwnership(shortClipId, user.sub);
    return this.shorts.renderStatus(clip.id);
  }

  @Get('clips/:shortClipId/thumbnails')
  async clipThumbnails(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertClipOwnership(shortClipId, user.sub);
    return this.thumbnails.listForClip(shortClipId);
  }

  @Post('thumbnails/:thumbnailId/set-primary')
  async setPrimaryThumbnail(@Param('thumbnailId') thumbnailId: string, @CurrentUser() user: JwtPayload) {
    return this.thumbnails.setPrimary(thumbnailId, user.sub);
  }

  // ── Export & Publish (18.6, 18.7) ───────────────────────────────────────────

  @Post('clips/:shortClipId/export')
  async exportClip(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    const clip = await this.shorts.assertClipOwnership(shortClipId, user.sub);
    return this.jobs.enqueue(clip.projectId, 'SHORTS_EXPORT', { shortClipId });
  }

  @Get('clips/:shortClipId/exports')
  async listExports(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertClipOwnership(shortClipId, user.sub);
    return this.exports.listExports(shortClipId);
  }

  @Post('clips/:shortClipId/request-publish')
  async requestPublish(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertClipOwnership(shortClipId, user.sub);
    return this.exports.requestPublish(shortClipId);
  }

  @Post('clips/:shortClipId/publish')
  async publish(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    const clip = await this.shorts.assertClipOwnership(shortClipId, user.sub);
    // Approval is validated here AND re-validated inside the publish job/connector
    const { approvalId, exportId } = await this.exports.assertPublishable(shortClipId);
    return this.jobs.enqueue(clip.projectId, 'SHORTS_PUBLISH', { shortClipId, approvalId, exportId });
  }

  @Get('clips/:shortClipId/publish-status')
  async publishStatus(@Param('shortClipId') shortClipId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertClipOwnership(shortClipId, user.sub);
    return this.exports.publishState(shortClipId);
  }
}
