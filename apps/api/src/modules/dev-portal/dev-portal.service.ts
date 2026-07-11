import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenEncryptionService } from '../channels/token-encryption.service';
import { generateDeveloperKey, nextBackoff } from './dev-portal.utils';

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_KEYS_PER_USER = 10;
const MAX_WEBHOOKS_PER_USER = 20;

// Consecutive DEAD deliveries before the webhook is auto-disabled.
const WEBHOOK_DEAD_THRESHOLD = 3;

// ── SSRF guard ─────────────────────────────────────────────────────────────────

/**
 * Returns true when the URL is safe to deliver to.
 *
 * Rejects private-range hosts (RFC 1918, link-local, loopback) unless we are
 * in a non-production environment (NODE_ENV !== 'production'), where
 * http://localhost URLs are permitted for developer testing.
 *
 * Blocked ranges:
 *   - 10.0.0.0/8
 *   - 172.16.0.0/12
 *   - 192.168.0.0/16
 *   - 127.0.0.0/8  (loopback)
 *   - 169.254.0.0/16 (link-local / AWS metadata)
 *   - ::1 / [::1] (IPv6 loopback)
 */
function assertSafeWebhookUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Invalid webhook URL');
  }

  // Require https in production; allow http only for localhost in non-prod
  const isProduction = process.env['NODE_ENV'] === 'production';
  if (isProduction && parsed.protocol !== 'https:') {
    throw new BadRequestException('Webhook URL must use https://');
  }
  if (!isProduction && parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('Webhook URL must use http:// or https://');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Allow http://localhost in non-production only
  if (!isProduction && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return;
  }

  // Block IPv6 loopback
  if (hostname === '[::1]' || hostname === '::1') {
    throw new BadRequestException('Webhook URL must not target a private or loopback address');
  }

  // For numeric IPv4, check against private ranges
  const ipv4 = parseIPv4(hostname);
  if (ipv4 !== null) {
    const [a, b] = ipv4;
    // 10.0.0.0/8
    if (a === 10) throw new BadRequestException('Webhook URL must not target a private address');
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) throw new BadRequestException('Webhook URL must not target a private address');
    // 192.168.0.0/16
    if (a === 192 && b === 168) throw new BadRequestException('Webhook URL must not target a private address');
    // 127.0.0.0/8
    if (a === 127) throw new BadRequestException('Webhook URL must not target a loopback address');
    // 169.254.0.0/16 (link-local / cloud metadata endpoint)
    if (a === 169 && b === 254) throw new BadRequestException('Webhook URL must not target a link-local address');
  }
}

function parseIPv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

// ── DTOs (inline — shared types live in packages/shared) ──────────────────────

export interface CreateKeyDto {
  name: string;
  scopes: string[];
  sandbox: boolean;
  rateLimitPerMin?: number;
}

export interface CreateWebhookDto {
  url: string;
  eventTypes: string[];
}

export interface VerifiedKey {
  userId: string;
  scopes: string[];
  sandbox: boolean;
  keyId: string;
  rateLimitPerMin: number;
}

// ── Service ────────────────────────────────────────────────────────────────────

@Injectable()
export class DevPortalService {
  private readonly logger = new Logger(DevPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: TokenEncryptionService,
  ) {}

  // ── API Keys ─────────────────────────────────────────────────────────────────

  /**
   * Issues a new developer API key.
   *
   * - Enforces a max of 10 active (non-revoked) keys per user.
   * - Returns the plaintext key exactly once — it is NEVER logged or stored.
   */
  async createKey(
    userId: string,
    dto: CreateKeyDto,
  ): Promise<{ key: string; id: string; prefix: string; scopes: string[] }> {
    const activeCount = await this.prisma.developerKey.count({
      where: { userId, revokedAt: null },
    });
    if (activeCount >= MAX_KEYS_PER_USER) {
      throw new BadRequestException(
        `Maximum of ${MAX_KEYS_PER_USER} active developer keys allowed per user`,
      );
    }

    const { key, prefix, hash } = generateDeveloperKey(dto.sandbox);

    const row = await this.prisma.developerKey.create({
      data: {
        userId,
        name: dto.name,
        keyPrefix: prefix,
        keyHash: hash,
        scopes: dto.scopes,
        rateLimitPerMin: dto.rateLimitPerMin ?? 60,
        sandbox: dto.sandbox,
      },
      select: { id: true, scopes: true },
    });

    // Audit log — NEVER include the key or hash
    this.logger.log(`[dev-portal] key created id=${row.id} user=${userId} sandbox=${dto.sandbox}`);

    return { key, id: row.id, prefix, scopes: row.scopes };
  }

  /** Lists non-sensitive fields for all developer keys belonging to a user. */
  async listKeys(userId: string) {
    return this.prisma.developerKey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        rateLimitPerMin: true,
        sandbox: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Revokes a developer key. Throws if the key does not belong to the user. */
  async revokeKey(userId: string, id: string): Promise<void> {
    const key = await this.prisma.developerKey.findFirst({
      where: { id, userId },
      select: { id: true, revokedAt: true },
    });
    if (!key) throw new NotFoundException('Developer key not found');
    if (key.revokedAt) return; // already revoked — idempotent

    await this.prisma.developerKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    this.logger.log(`[dev-portal] key revoked id=${id} user=${userId}`);
  }

  /**
   * Verifies a raw API key string.
   *
   * - Hashes the raw key and looks up the hash.
   * - Returns null when the key is missing or revoked.
   * - Touches lastUsedAt fire-and-forget (non-fatal).
   */
  async verifyKey(rawKey: string): Promise<VerifiedKey | null> {
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const row = await this.prisma.developerKey.findUnique({
      where: { keyHash: hash },
      select: {
        id: true,
        userId: true,
        scopes: true,
        sandbox: true,
        rateLimitPerMin: true,
        revokedAt: true,
      },
    });
    if (!row || row.revokedAt) return null;

    // Fire-and-forget lastUsedAt update — failure must never block the request
    this.prisma.developerKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) => {
        this.logger.warn(`[dev-portal] lastUsedAt update failed key=${row.id}: ${String(err)}`);
      });

    return {
      userId: row.userId,
      scopes: row.scopes,
      sandbox: row.sandbox,
      keyId: row.id,
      rateLimitPerMin: row.rateLimitPerMin,
    };
  }

  // ── Webhooks ─────────────────────────────────────────────────────────────────

  /**
   * Registers a new webhook endpoint.
   *
   * - Validates the URL for SSRF safety.
   * - Generates a 32-byte random signing secret, returns it plaintext exactly
   *   once, stores it AES-256-GCM encrypted (needed for HMAC signing at
   *   delivery time; a hash alone would be insufficient).
   */
  async createWebhook(
    userId: string,
    dto: CreateWebhookDto,
  ): Promise<{ secret: string; id: string; url: string; eventTypes: string[] }> {
    assertSafeWebhookUrl(dto.url);

    const activeCount = await this.prisma.developerWebhook.count({
      where: { userId, status: 'ACTIVE' },
    });
    if (activeCount >= MAX_WEBHOOKS_PER_USER) {
      throw new BadRequestException(
        `Maximum of ${MAX_WEBHOOKS_PER_USER} active webhooks allowed per user`,
      );
    }

    const secret = randomBytes(32).toString('hex'); // 64 hex chars
    const secretEnc = this.encryption.encrypt(secret);

    const row = await this.prisma.developerWebhook.create({
      data: {
        userId,
        url: dto.url,
        eventTypes: dto.eventTypes,
        secretEnc,
        status: 'ACTIVE',
      },
      select: { id: true, url: true, eventTypes: true },
    });

    this.logger.log(`[dev-portal] webhook created id=${row.id} user=${userId}`);

    return { secret, id: row.id, url: row.url, eventTypes: row.eventTypes };
  }

  /** Lists webhooks for a user (no secret returned). */
  async listWebhooks(userId: string) {
    return this.prisma.developerWebhook.findMany({
      where: { userId },
      select: {
        id: true,
        url: true,
        eventTypes: true,
        status: true,
        failureCount: true,
        lastSuccessAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Deletes a webhook and all its delivery history. Throws if not found/owned. */
  async deleteWebhook(userId: string, id: string): Promise<void> {
    const wh = await this.prisma.developerWebhook.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!wh) throw new NotFoundException('Webhook not found');
    await this.prisma.developerWebhook.delete({ where: { id } });
    this.logger.log(`[dev-portal] webhook deleted id=${id} user=${userId}`);
  }

  // ── Event emission ────────────────────────────────────────────────────────────

  /**
   * Creates PENDING delivery rows for every ACTIVE webhook of `userId` that
   * is subscribed to `eventType`.
   *
   * This method NEVER delivers inline — the delivery worker polls the table.
   */
  async emit(userId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    const webhooks = await this.prisma.developerWebhook.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, eventTypes: true },
    });

    const subscribed = webhooks.filter(
      (wh) => wh.eventTypes.length === 0 || wh.eventTypes.includes(eventType),
    );
    if (subscribed.length === 0) return;

    await this.prisma.developerWebhookDelivery.createMany({
      data: subscribed.map((wh) => ({
        webhookId: wh.id,
        eventType,
        payload: payload as Prisma.InputJsonObject,
        status: 'PENDING',
        nextAttemptAt: new Date(),
      })),
    });
  }

  // ── Delivery internals (used by webhook-delivery.job.ts) ──────────────────────

  /**
   * Claims and returns due PENDING delivery rows.
   * Called by the delivery worker — not part of the public API surface.
   */
  async claimDueDeliveries(limit = 50) {
    return this.prisma.developerWebhookDelivery.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: new Date() },
      },
      include: {
        webhook: {
          select: { id: true, url: true, secretEnc: true, status: true, failureCount: true },
        },
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
  }

  /** Marks a delivery as DELIVERED and updates webhook.lastSuccessAt. */
  async markDelivered(deliveryId: string, webhookId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.developerWebhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'DELIVERED' },
      }),
      this.prisma.developerWebhook.update({
        where: { id: webhookId },
        data: { lastSuccessAt: new Date() },
      }),
    ]);
  }

  /**
   * Records a failed delivery attempt and schedules the next retry.
   * Moves to DEAD when nextBackoff returns -1, and increments webhook failureCount.
   * Auto-disables the webhook when failureCount reaches WEBHOOK_DEAD_THRESHOLD.
   */
  async markFailed(
    deliveryId: string,
    webhookId: string,
    attempts: number,
    error: string,
  ): Promise<void> {
    const delay = nextBackoff(attempts);
    if (delay === -1) {
      // Dead-letter
      await this.prisma.$transaction(async (tx) => {
        await tx.developerWebhookDelivery.update({
          where: { id: deliveryId },
          data: { status: 'DEAD', attempts, lastError: error },
        });
        const wh = await tx.developerWebhook.update({
          where: { id: webhookId },
          data: { failureCount: { increment: 1 } },
          select: { failureCount: true },
        });
        if (wh.failureCount >= WEBHOOK_DEAD_THRESHOLD) {
          await tx.developerWebhook.update({
            where: { id: webhookId },
            data: { status: 'DISABLED' },
          });
          this.logger.warn(`[dev-portal] webhook auto-disabled id=${webhookId} failureCount=${wh.failureCount}`);
        }
      });
    } else {
      await this.prisma.developerWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts,
          lastError: error,
          nextAttemptAt: new Date(Date.now() + delay),
          // status stays PENDING
        },
      });
    }
  }

  /** Decrypts the webhook signing secret for delivery signing. */
  decryptSecret(secretEnc: string): string {
    return this.encryption.decrypt(secretEnc);
  }
}
