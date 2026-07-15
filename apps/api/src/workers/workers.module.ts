import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SupervisorWorker } from './supervisor.worker';
import { MetricsModule } from '../modules/metrics/metrics.module';
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
import { MediaModule } from '../modules/media/media.module';
import { ShortsStudioModule } from '../modules/shorts-studio/shorts-studio.module';
import { WalletModule } from '../modules/wallet/wallet.module';
import { AiOpsModule } from '../modules/ai-ops/ai-ops.module';
import { OrgsModule } from '../modules/orgs/orgs.module';
import { TrialModule } from '../modules/trial/trial.module';
import { GatewayModule } from '../gateway/gateway.module';
import { ChannelsModule } from '../modules/channels/channels.module';
import { AutomationModule } from '../modules/automation/automation.module';
import { EditorModule } from '../modules/editor/editor.module';

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
    MediaModule,
    ShortsStudioModule,
    WalletModule,
    AiOpsModule,
    OrgsModule,
    TrialModule,
    GatewayModule,
    ChannelsModule,
    MetricsModule,
    AutomationModule,
    EditorModule,
  ],
  providers: [SupervisorWorker],
})
export class WorkersModule implements OnModuleInit {
  constructor(
    @InjectQueue(AGENT_QUEUE) private readonly agentQueue: Queue,
  ) {}

  async onModuleInit() {
    try {
      // Schedule the automation heartbeat — runs every 15 minutes
      await this.agentQueue.add(
        'AUTOMATION_TICK',
        {},
        {
          repeat: { every: 15 * 60 * 1000 },
          jobId: 'automation-tick-repeatable',
        },
      );
      console.log('[WorkersModule] Automation heartbeat scheduled (every 15 min)');
    } catch (err) {
      // Non-fatal: Redis may be down at startup; the heartbeat will register when Redis recovers
      console.warn('[WorkersModule] Could not schedule automation heartbeat:', err instanceof Error ? err.message : String(err));
    }
  }
}
