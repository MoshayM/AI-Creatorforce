import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './common/prisma/prisma.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ContentModule } from './modules/content/content.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { MetadataModule } from './modules/metadata/metadata.module';
import { PublishingModule } from './modules/publishing/publishing.module';
import { TrendModule } from './modules/trend/trend.module';
import { SeoModule } from './modules/seo/seo.module';
import { AudienceModule } from './modules/audience/audience.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { BillingModule } from './modules/billing/billing.module';
import { AiOpsModule } from './modules/ai-ops/ai-ops.module';
import { TrialModule } from './modules/trial/trial.module';
import { SettingsModule } from './modules/settings/settings.module';
import { VoiceModule } from './modules/voice/voice.module';
import { MusicModule } from './modules/music/music.module';
import { ImageModule } from './modules/image/image.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { GrowthModule } from './modules/growth/growth.module';
import { AssetsModule } from './modules/assets/assets.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { RenderModule } from './modules/render/render.module';
import { MediaModule } from './modules/media/media.module';
import { ShortsStudioModule } from './modules/shorts-studio/shorts-studio.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { WorkersModule } from './workers/workers.module';
import { GatewayModule } from './gateway/gateway.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    BullModule.forRoot({
      connection: {
        host: '127.0.0.1',
        port: 6379,
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: null,
      },
    }),
    PrismaModule,
    AuthModule,
    ChannelsModule,
    ProjectsModule,
    JobsModule,
    ContentModule,
    ComplianceModule,
    MetadataModule,
    PublishingModule,
    TrendModule,
    SeoModule,
    AudienceModule,
    ApprovalsModule,
    BillingModule,
    AiOpsModule,
    TrialModule,
    SettingsModule,
    VoiceModule,
    MusicModule,
    ImageModule,
    AnalyticsModule,
    GrowthModule,
    AssetsModule,
    TimelineModule,
    RenderModule,
    MediaModule,
    ShortsStudioModule,
    CopilotModule,
    WorkersModule,
    GatewayModule,
    NotificationsModule,
    MetricsModule,
  ],
  providers: [],
})
export class AppModule {}
