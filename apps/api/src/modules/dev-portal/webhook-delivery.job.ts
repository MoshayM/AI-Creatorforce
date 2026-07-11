import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { DevPortalService } from './dev-portal.service';
import { signWebhookPayload } from './dev-portal.utils';

// ── Config ─────────────────────────────────────────────────────────────────────

/** Delivery job polling interval in milliseconds (default: 60 s). */
const JOB_INTERVAL_MS = 60_000;
/** Boot delay before first run (avoids thundering herd). */
const BOOT_DELAY_MS = 10_000;
/** HTTP timeout for each outbound webhook POST (ms). */
const HTTP_TIMEOUT_MS = 10_000;
/** Max deliveries claimed per tick. */
const CLAIM_LIMIT = 50;

/** Whether the delivery job is enabled (default true; disabled in tests). */
function jobEnabled(): boolean {
  if (process.env['NODE_ENV'] === 'test') return false;
  const v = process.env['DEV_WEBHOOKS_ENABLED'];
  return v === undefined || v === 'true' || v === '1';
}

// ── Job ────────────────────────────────────────────────────────────────────────

/**
 * Phase 5 §13: Webhook delivery background job.
 *
 * Polls every 60 s for PENDING deliveries whose nextAttemptAt is in the past.
 * For each delivery:
 *   1. Signs the payload with HMAC-SHA256 (Stripe-style).
 *   2. POSTs to the webhook URL with a 10 s timeout.
 *   3. On success: marks DELIVERED + updates webhook.lastSuccessAt.
 *   4. On failure: increments attempts, schedules next retry via nextBackoff.
 *      If nextBackoff returns -1 → DEAD; after 3 consecutive DEADs the
 *      webhook is auto-DISABLED.
 *
 * Disabled when NODE_ENV=test or DEV_WEBHOOKS_ENABLED=false.
 */
@Injectable()
export class WebhookDeliveryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryJob.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly devPortal: DevPortalService) {}

  onModuleInit(): void {
    if (!jobEnabled()) return;

    const boot = setTimeout(() => {
      void this.tick();
      const interval = setInterval(() => void this.tick(), JOB_INTERVAL_MS);
      this.timers.push(interval);
    }, BOOT_DELAY_MS);

    this.timers.push(boot);
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  private async tick(): Promise<void> {
    try {
      const deliveries = await this.devPortal.claimDueDeliveries(CLAIM_LIMIT);
      if (deliveries.length === 0) return;

      this.logger.debug(`[webhook-delivery] processing ${deliveries.length} deliveries`);

      await Promise.allSettled(deliveries.map((d) => this.deliver(d)));
    } catch (err: unknown) {
      this.logger.error(
        `[webhook-delivery] tick error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async deliver(
    delivery: Awaited<ReturnType<DevPortalService['claimDueDeliveries']>>[number],
  ): Promise<void> {
    const { id: deliveryId, webhookId, payload, attempts, webhook } = delivery;

    // Skip if webhook was disabled after this delivery was enqueued
    if (webhook.status !== 'ACTIVE') {
      this.logger.debug(`[webhook-delivery] skipping delivery ${deliveryId} — webhook disabled`);
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(payload);
    let secret: string;
    try {
      secret = this.devPortal.decryptSecret(webhook.secretEnc);
    } catch (err: unknown) {
      this.logger.error(`[webhook-delivery] failed to decrypt secret for webhook ${webhookId}: ${String(err)}`);
      return;
    }
    const signature = signWebhookPayload(secret, timestamp, body);

    try {
      await axios.post(webhook.url, payload, {
        timeout: HTTP_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'X-CF-Signature': signature,
          'X-CF-Timestamp': String(timestamp),
        },
        // Don't throw on 4xx/5xx — treat as failure to retry
        validateStatus: (status) => status >= 200 && status < 300,
      });

      await this.devPortal.markDelivered(deliveryId, webhookId);
      this.logger.debug(`[webhook-delivery] delivered ${deliveryId} → ${webhook.url}`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const nextAttempts = attempts + 1;
      await this.devPortal.markFailed(deliveryId, webhookId, nextAttempts, errorMsg).catch(
        (e: unknown) => this.logger.error(`[webhook-delivery] markFailed error: ${String(e)}`),
      );
      this.logger.warn(
        `[webhook-delivery] delivery ${deliveryId} failed (attempt ${nextAttempts}): ${errorMsg}`,
      );
    }
  }
}
