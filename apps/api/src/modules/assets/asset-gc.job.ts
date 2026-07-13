import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../media/storage.service';

// ── Config ────────────────────────────────────────────────────────────────────

/** Daily sweep — grace periods are measured in days, not minutes. */
const JOB_INTERVAL_MS = 24 * 60 * 60_000;
/** Boot delay, offset from the notification/reaper jobs to spread startup load. */
const BOOT_DELAY_MS = 12 * 60_000;
/** Per-run batch cap: bounded work per sweep; the daily cadence drains backlogs. */
const BATCH = 200;

function graceMs(): number {
  const days = parseInt(process.env['ASSET_GC_GRACE_DAYS'] ?? '30', 10);
  return (Number.isFinite(days) && days > 0 ? days : 30) * 24 * 60 * 60_000;
}

/** Whether the GC runs (default true; set false in tests). */
function gcEnabled(): boolean {
  const v = process.env['ASSET_GC_ENABLED'];
  return v === undefined || v === 'true' || v === '1';
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Asset lifecycle GC (Updates/09 §Lifecycle + Updates/40): soft-delete →
 * grace → purge, in two stages per sweep:
 *
 *  A. MARK — a live asset untouched for a full grace period with no
 *     reference anywhere (imports, shorts renders/timeline items/thumbnails,
 *     export history, or a project timeline's JSON clips) is soft-deleted.
 *     Reversible for another grace period; audit-logged.
 *  B. PURGE — a soft-deleted asset past grace that is STILL unreferenced has
 *     its files removed and its row deleted (versions cascade). Anything that
 *     regained a reference — e.g. export history keeping provenance — is
 *     skipped, never force-deleted.
 *
 * Both stages run the same reference check, so nothing referenced is ever
 * purged regardless of how it was soft-deleted (user action or stage A).
 */
@Injectable()
export class AssetGcJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssetGcJob.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    if (process.env['NODE_ENV'] === 'test' || !gcEnabled()) return;

    this.timers.push(
      setTimeout(() => {
        void this.sweep();
      }, BOOT_DELAY_MS),
    );
    this.timers.push(
      setInterval(() => {
        void this.sweep();
      }, JOB_INTERVAL_MS),
    );
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  async sweep(now: Date = new Date()): Promise<{ marked: number; purged: number }> {
    try {
      const cutoff = new Date(now.getTime() - graceMs());

      // Stage A: mark stale, unreferenced live assets
      const staleLive = await this.prisma.asset.findMany({
        where: { deletedAt: null, updatedAt: { lt: cutoff } },
        select: { id: true, projectId: true, kind: true },
        take: BATCH,
      });
      let marked = 0;
      for (const asset of staleLive) {
        if (await this.isReferenced(asset.id, asset.projectId)) continue;
        await this.prisma.asset.update({ where: { id: asset.id }, data: { deletedAt: now } });
        await this.prisma.auditLog.create({
          data: { action: 'gc:asset-marked', target: asset.id, meta: { projectId: asset.projectId, kind: asset.kind } as never },
        });
        marked++;
      }

      // Stage B: purge soft-deleted assets past grace, still unreferenced
      const deadPastGrace = await this.prisma.asset.findMany({
        where: { deletedAt: { lt: cutoff } },
        select: { id: true, projectId: true, kind: true },
        take: BATCH,
      });
      let purged = 0;
      for (const asset of deadPastGrace) {
        if (await this.isReferenced(asset.id, asset.projectId)) continue;
        await this.storage.removePrefix(`assets/${asset.projectId}/${asset.id}`);
        await this.prisma.asset.delete({ where: { id: asset.id } });
        await this.prisma.auditLog.create({
          data: { action: 'gc:asset-purged', target: asset.id, meta: { projectId: asset.projectId, kind: asset.kind } as never },
        });
        purged++;
      }

      if (marked > 0 || purged > 0) {
        this.logger.log(`[asset-gc] marked ${marked}, purged ${purged} (grace ${Math.round(graceMs() / 86_400_000)}d)`);
      }
      return { marked, purged };
    } catch (err) {
      this.logger.warn(`[asset-gc] sweep failed: ${err instanceof Error ? err.message : String(err)}`);
      return { marked: 0, purged: 0 };
    }
  }

  /**
   * True if anything still points at the asset. Version rows are the asset's
   * own content (cascade children), not references. Timeline clips live in
   * JSON, so the project's timelines are string-scanned for the id.
   */
  private async isReferenced(assetId: string, projectId: string): Promise<boolean> {
    const [imports, clipRenders, timelineItems, thumbnails, exports] = await Promise.all([
      this.prisma.importedVideo.count({ where: { sourceAssetId: assetId } }),
      this.prisma.shortClip.count({ where: { renderAssetId: assetId } }),
      this.prisma.shortsTimelineItem.count({ where: { sourceAssetId: assetId } }),
      this.prisma.shortsThumbnail.count({ where: { assetId } }),
      this.prisma.shortsExportHistory.count({ where: { exportAssetId: assetId } }),
    ]);
    if (imports + clipRenders + timelineItems + thumbnails + exports > 0) return true;

    const timelines = await this.prisma.timeline.findMany({
      where: { projectId },
      select: { tracks: true },
    });
    return timelines.some((t) => JSON.stringify(t.tracks).includes(assetId));
  }
}
