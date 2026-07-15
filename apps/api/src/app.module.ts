import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { PrismaModule } from './common/prisma/prisma.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { HealthModule } from './modules/health/health.module';
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
import { OrgsModule } from './modules/orgs/orgs.module';
import { BiModule } from './modules/bi/bi.module';
import { DevPortalModule } from './modules/dev-portal/dev-portal.module';
import { FlagsModule } from './modules/flags/flags.module';
import { AutomationModule } from './modules/automation/automation.module';
import { EditorModule } from './modules/editor/editor.module';

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
        // No lazyConnect: a lazy connect() that fails (Redis down at first
        // enqueue) is cached by BullMQ as a forever-rejected init promise, so
        // the queue never recovers even after Redis comes back. An eager
        // connection retries until Redis is ready and heals on its own;
        // JobsService fails fast while it isn't.
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
    OrgsModule,
    BiModule,
    DevPortalModule,
    FlagsModule,
    AutomationModule,
    EditorModule,
    MetricsModule,
    HealthModule,
  ],
  // Global guard so any route can opt into rate limiting with @RateLimit(...).
  // No-op on routes without the decorator; fails open if Redis is down.
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class AppModule {}
