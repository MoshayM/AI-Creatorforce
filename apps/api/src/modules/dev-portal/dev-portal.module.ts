import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { WalletModule } from '../wallet/wallet.module';
import { ProjectsModule } from '../projects/projects.module';
import { JobsModule } from '../jobs/jobs.module';
import { DevPortalService } from './dev-portal.service';
import { DevPortalController } from './dev-portal.controller';
import { DevApiController } from './dev-api.controller';
import { DeveloperKeyGuard } from './developer-key.guard';
import { WebhookDeliveryJob } from './webhook-delivery.job';

/**
 * Phase 5 §13: Developer Portal module.
 *
 * Provides:
 * - API key management (issue / list / revoke)
 * - Webhook management (register / list / delete / test)
 * - Webhook delivery background job (60 s polling)
 * - DeveloperKeyGuard for the public dev-api/v1 surface
 *
 * Imports Channels/Wallet/Projects/Jobs modules for the dev-api/v1 surface.
 * DevPortalService is exported so BillingModule can inject it @Optional().
 */
@Module({
  imports: [ChannelsModule, WalletModule, ProjectsModule, JobsModule],
  providers: [DevPortalService, DeveloperKeyGuard, WebhookDeliveryJob],
  controllers: [DevPortalController, DevApiController],
  exports: [DevPortalService],
})
export class DevPortalModule {}
