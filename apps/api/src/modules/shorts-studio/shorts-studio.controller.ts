import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { IsString, IsArray, IsIn, IsOptional } from 'class-validator';
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
import { SemanticSearchService } from './semantic-search.service';
import { SmallVideoGenerationService } from './small-video-generation.service';
import { ChapterSyncService } from './chapter-sync.service';
import { SocialContentService } from './social-content.service';
import { QuoteCardRenderService } from './quote-card-render.service';
import { JobsService } from '../jobs/jobs.service';

class ImportVideoDto {
  /** Channel-first flow (library import). Exactly one of channelId/projectId is required. */
  @IsOptional() @IsString() channelId?: string;
  /** Legacy project-scoped flow, kept for API compatibility. */
  @IsOptional() @IsString() projectId?: string;
  @IsString() youtubeVideoId!: string;
}

const CLIP_TYPES = ['YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'TIKTOK', 'LINKEDIN_CLIPS', 'FACEBOOK_REELS', 'PODCAST_HIGHLIGHTS'] as const;

class GenerateClipsDto {
  @IsArray() @IsIn(CLIP_TYPES, { each: true }) clipTypes!: ClipType[];
}

class UpdateChapterDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() summary?: string;
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
    private readonly search: SemanticSearchService,
    private readonly smallVideos: SmallVideoGenerationService,
    private readonly chapterSync: ChapterSyncService,
    private readonly social: SocialContentService,
    private readonly quoteCards: QuoteCardRenderService,
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
    if (dto.channelId) return this.videoImport.importFromChannel(user.sub, dto.channelId, dto.youtubeVideoId);
    if (dto.projectId) return this.videoImport.importVideo(user.sub, dto.projectId, dto.youtubeVideoId);
    throw new BadRequestException('Provide channelId or projectId');
  }

  @Get('projects/:projectId/videos')
  async listImported(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertProjectOwnership(projectId, user.sub);
    return this.shorts.listImportedVideos(projectId);
  }

  @Get('channels/:channelId/imported')
  async listImportedByChannel(@Param('channelId') channelId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertChannelOwnership(channelId, user.sub);
    return this.shorts.listImportedVideosByChannel(channelId);
  }

  @Delete('videos/:importedVideoId')
  async deleteImported(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.deleteImportedVideo(importedVideoId, user.sub);
  }

  // ── Analyze (18.2) ──────────────────────────────────────────────────────────

  // 202: analysis is queued, not done (docs4/16 — async ops return 202 + job id)
  @Post('videos/:importedVideoId/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
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

  // ── Search & Embeddings (Ai-video edit.md §5, Phase 5) ─────────────────────

  @Get('videos/:importedVideoId/search')
  async searchVideo(
    @Param('importedVideoId') importedVideoId: string,
    @Query('q') q: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.shorts.assertVideoOwnership(importedVideoId, user.sub);
    if (!q?.trim()) throw new BadRequestException('Query parameter "q" is required');
    const n = Math.min(Math.max(parseInt(limit ?? '10', 10) || 10, 1), 25);
    return this.search.search(importedVideoId, q.trim(), n, user.sub);
  }

  @Get('search')
  async searchLibrary(@Query('q') q: string | undefined, @CurrentUser() user: JwtPayload) {
    if (!q?.trim()) throw new BadRequestException('Query parameter "q" is required');
    return this.search.searchLibrary(user.sub, q.trim());
  }

  @Post('videos/:importedVideoId/generate-embeddings')
  async generateEmbeddings(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.enqueueEmbeddingGeneration(importedVideoId, user.sub);
  }

  // ── Chapters (Ai-video edit.md §5/§11, Phase 5) ─────────────────────────────

  @Get('videos/:importedVideoId/chapters')
  async chapters(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.getChapters(importedVideoId, user.sub);
  }

  @Post('videos/:importedVideoId/detect-chapters')
  async detectChapters(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.enqueueChapterDetection(importedVideoId, user.sub);
  }

  @Post('videos/:importedVideoId/church-pack')
  async generateChurchPack(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.enqueueChurchPack(importedVideoId, user.sub);
  }

  @Post('videos/:importedVideoId/small-videos')
  async generateSmallVideos(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertVideoOwnership(importedVideoId, user.sub);
    return this.smallVideos.generateFromChapters(importedVideoId);
  }

  // ── Social content factory (Ai-video edit.md §10, Phase 5) ─────────────────

  @Get('videos/:importedVideoId/social-content')
  async socialContent(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertVideoOwnership(importedVideoId, user.sub);
    return this.social.listForVideo(importedVideoId);
  }

  @Post('videos/:importedVideoId/social-content')
  async generateSocialContent(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    return this.shorts.enqueueSocialContent(importedVideoId, user.sub);
  }

  @Post('social-content/:socialContentId/render-quote-card')
  async renderQuoteCard(@Param('socialContentId') socialContentId: string, @CurrentUser() user: JwtPayload) {
    return this.quoteCards.render(socialContentId, user.sub);
  }

  @Post('videos/:importedVideoId/sync-chapters')
  async syncChapters(@Param('importedVideoId') importedVideoId: string, @CurrentUser() user: JwtPayload) {
    await this.shorts.assertVideoOwnership(importedVideoId, user.sub);
    return this.chapterSync.syncToYouTube(importedVideoId);
  }

  @Patch('chapters/:chapterId')
  async updateChapter(
    @Param('chapterId') chapterId: string,
    @Body() dto: UpdateChapterDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (dto.title === undefined && dto.summary === undefined) {
      throw new BadRequestException('Provide title and/or summary');
    }
    return this.shorts.updateChapter(chapterId, user.sub, dto);
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
    // force=true so user-initiated re-renders always run, bypassing the staleness-skip optimisation
    return this.jobs.enqueue(clip.projectId, 'SHORTS_RENDER', { shortClipId, force: true });
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
    const rs = await this.shorts.renderStatus(shortClipId);
    if (rs.timelineStale) {
      throw new BadRequestException('Timeline has been edited since the last render — click "Re-render" to produce the updated video before exporting');
    }
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
