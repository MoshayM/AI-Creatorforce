import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { WalletModule } from '../wallet/wallet.module';
import { JobsModule } from '../jobs/jobs.module';
import { MediaModule } from '../media/media.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { PublishingModule } from '../publishing/publishing.module';
import { ShortsStudioService } from './shorts-studio.service';
import { ShortsStudioController } from './shorts-studio.controller';
import { YouTubeReadService } from './youtube-read.service';
import { VideoImportService } from './video-import.service';
import { TranscriptService } from './transcript.service';
import { SceneDetectionService } from './scene-detection.service';
import { TopicSegmentationService } from './topic-segmentation.service';
import { HighlightScoringService } from './highlight-scoring.service';
import { ChapterDetectionService } from './chapter-detection.service';
import { EmbeddingGenerationService } from './embedding-generation.service';
import { SemanticSearchService } from './semantic-search.service';
import { SmallVideoGenerationService } from './small-video-generation.service';
import { ChurchPackService } from './church-pack.service';
import { ChapterSyncService } from './chapter-sync.service';
import { SocialContentService } from './social-content.service';
import { QuoteCardRenderService } from './quote-card-render.service';
import { ClipRecommendationService } from './clip-recommendation.service';
import { ShortsGenerationService } from './shorts-generation.service';
import { TimelineService } from './timeline.service';
import { AiEditingAssistantService } from './ai-editing-assistant.service';
import { CaptionGenerationService } from './caption-generation.service';
import { SmartReframeService } from './smart-reframe.service';
import { ShortsRenderService } from './shorts-render.service';
import { ThumbnailGenerationService } from './thumbnail-generation.service';
import { ShortsExportService } from './shorts-export.service';

@Module({
  imports: [ChannelsModule, JobsModule, MediaModule, ApprovalsModule, ComplianceModule, PublishingModule, WalletModule],
  controllers: [ShortsStudioController],
  providers: [
    ShortsStudioService,
    YouTubeReadService,
    VideoImportService,
    TranscriptService,
    SceneDetectionService,
    TopicSegmentationService,
    HighlightScoringService,
    ChapterDetectionService,
    EmbeddingGenerationService,
    SemanticSearchService,
    SmallVideoGenerationService,
    ChurchPackService,
    ChapterSyncService,
    SocialContentService,
    QuoteCardRenderService,
    ClipRecommendationService,
    ShortsGenerationService,
    TimelineService,
    AiEditingAssistantService,
    CaptionGenerationService,
    SmartReframeService,
    ShortsRenderService,
    ThumbnailGenerationService,
    ShortsExportService,
  ],
  exports: [
    ShortsStudioService,
    YouTubeReadService,
    VideoImportService,
    TranscriptService,
    SceneDetectionService,
    TopicSegmentationService,
    HighlightScoringService,
    ChapterDetectionService,
    EmbeddingGenerationService,
    SemanticSearchService,
    SmallVideoGenerationService,
    ChurchPackService,
    ChapterSyncService,
    SocialContentService,
    QuoteCardRenderService,
    ClipRecommendationService,
    ShortsGenerationService,
    TimelineService,
    AiEditingAssistantService,
    CaptionGenerationService,
    SmartReframeService,
    ShortsRenderService,
    ThumbnailGenerationService,
    ShortsExportService,
  ],
})
export class ShortsStudioModule {}
