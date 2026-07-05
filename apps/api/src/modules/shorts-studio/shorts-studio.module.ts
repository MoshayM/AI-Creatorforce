import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { JobsModule } from '../jobs/jobs.module';
import { MediaModule } from '../media/media.module';
import { ShortsStudioService } from './shorts-studio.service';
import { ShortsStudioController } from './shorts-studio.controller';
import { YouTubeReadService } from './youtube-read.service';
import { VideoImportService } from './video-import.service';
import { TranscriptService } from './transcript.service';
import { SceneDetectionService } from './scene-detection.service';
import { TopicSegmentationService } from './topic-segmentation.service';
import { HighlightScoringService } from './highlight-scoring.service';
import { ClipRecommendationService } from './clip-recommendation.service';
import { ShortsGenerationService } from './shorts-generation.service';

@Module({
  imports: [ChannelsModule, JobsModule, MediaModule],
  controllers: [ShortsStudioController],
  providers: [
    ShortsStudioService,
    YouTubeReadService,
    VideoImportService,
    TranscriptService,
    SceneDetectionService,
    TopicSegmentationService,
    HighlightScoringService,
    ClipRecommendationService,
    ShortsGenerationService,
  ],
  exports: [
    ShortsStudioService,
    YouTubeReadService,
    VideoImportService,
    TranscriptService,
    SceneDetectionService,
    TopicSegmentationService,
    HighlightScoringService,
    ClipRecommendationService,
    ShortsGenerationService,
  ],
})
export class ShortsStudioModule {}
