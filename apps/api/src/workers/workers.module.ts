import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SupervisorWorker } from './supervisor.worker';
import { ContentModule } from '../modules/content/content.module';
import { ComplianceModule } from '../modules/compliance/compliance.module';
import { MetadataModule } from '../modules/metadata/metadata.module';
import { PublishingModule } from '../modules/publishing/publishing.module';
import { TrendModule } from '../modules/trend/trend.module';
import { SeoModule } from '../modules/seo/seo.module';
import { AudienceModule } from '../modules/audience/audience.module';
import { ApprovalsModule } from '../modules/approvals/approvals.module';
import { JobsModule, AGENT_QUEUE } from '../modules/jobs/jobs.module';
import { VoiceModule } from '../modules/voice/voice.module';
import { MusicModule } from '../modules/music/music.module';
import { ImageModule } from '../modules/image/image.module';
import { AnalyticsModule } from '../modules/analytics/analytics.module';
import { GrowthModule } from '../modules/growth/growth.module';
import { AssetsModule } from '../modules/assets/assets.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: AGENT_QUEUE }),
    ContentModule,
    ComplianceModule,
    MetadataModule,
    PublishingModule,
    TrendModule,
    SeoModule,
    AudienceModule,
    ApprovalsModule,
    JobsModule,
    VoiceModule,
    MusicModule,
    ImageModule,
    AnalyticsModule,
    GrowthModule,
    AssetsModule,
    GatewayModule,
  ],
  providers: [SupervisorWorker],
})
export class WorkersModule {}
