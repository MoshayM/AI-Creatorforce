import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getDefaultCostRates, getProviderHealthSnapshot } from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

const SYNC_INTERVAL_MS = 5 * 60_000;
const BOOT_DELAY_MS = 60_000;

/**
 * Provider registry (Phase 5 spec §5), mapped to the monolith: the live
 * health/failover/rate-limit machinery already runs inside the shared
 * aiClient — this service PERSISTS its snapshot so the admin surface has
 * current state + history, and seeds the registry/cost rows the profit
 * guard reads. Status transitions become provider_health_events.
 */
@Injectable()
export class ProviderRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProviderRegistryService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env['NODE_ENV'] === 'test') return;
    this.timers.push(setTimeout(() => void this.syncSnapshot(), BOOT_DELAY_MS));
    this.timers.push(setInterval(() => void this.syncSnapshot(), SYNC_INTERVAL_MS));
  }

  onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  /** Seed registry + default cost rates, then persist the live health snapshot. */
  async syncSnapshot(): Promise<void> {
    try {
      const defaults = getDefaultCostRates();
      for (const [name, rate] of Object.entries(defaults)) {
        const provider = await this.prisma.aiProvider.upsert({
          where: { name },
          create: { name },
          update: {},
        });
        const hasRate = await this.prisma.providerCostRate.count({ where: { providerId: provider.id } });
        if (hasRate === 0) {
          await this.prisma.providerCostRate.create({
            data: { providerId: provider.id, inputCostPer1M: rate.input, outputCostPer1M: rate.output },
          });
        }
      }

      for (const snap of getProviderHealthSnapshot()) {
        const provider = await this.prisma.aiProvider.findUnique({ where: { name: snap.provider } });
        if (!provider || provider.status === 'DISABLED') continue;
        const calls = snap.successCount + snap.failureCount;
        const status = snap.available ? 'ACTIVE' : 'DEGRADED';
        if (provider.status !== status) {
          await this.prisma.providerHealthEvent.create({
            data: {
              providerId: provider.id,
              event: status === 'ACTIVE' ? 'recovered' : 'degraded',
              score: snap.score,
              consecutiveFailures: snap.consecutiveFailures,
            },
          });
          this.logger.log(`[provider] ${snap.provider}: ${provider.status} → ${status} (score ${snap.score})`);
        }
        await this.prisma.aiProvider.update({
          where: { id: provider.id },
          data: {
            status,
            avgHealthScore: snap.score,
            failureRate: calls > 0 ? Number((snap.failureCount / calls).toFixed(4)) : 0,
          },
        });
      }
    } catch (err) {
      this.logger.warn(`[provider] snapshot sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listProviders() {
    return this.prisma.aiProvider.findMany({
      orderBy: { name: 'asc' },
      include: {
        costRates: { where: { OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, orderBy: { effectiveFrom: 'desc' } },
        healthEvents: { orderBy: { checkedAt: 'desc' }, take: 5 },
      },
    });
  }
}
