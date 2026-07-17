import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { VideoImportService } from '../shorts-studio/video-import.service';
import { AutomationSettingsSchema, type AutomationSettings, callAIStructured } from '@cf/shared';
import { z } from 'zod';
import { AutonomyService } from '../autonomy/autonomy.service';

/** Default settings returned when no ChannelAutomation row exists yet */
const DEFAULTS: AutomationSettings = {
  enabled: false,
  autoImport: false,
  autoAnalyze: false,
  autoPublish: false,
  chapterSyncEnabled: false,
  autoPlan: false,
  publishIntervalMinutes: 240,
  maxPublishesPerDay: 2,
  maxImportsPerDay: 3,
};

interface ChannelAutomationRow {
  id: string;
  channelId: string;
  enabled: boolean;
  autoImport: boolean;
  autoAnalyze: boolean;
  autoPublish: boolean;
  chapterSyncEnabled: boolean;
  autoPlan: boolean;
  publishIntervalMinutes: number;
  maxPublishesPerDay: number;
  maxImportsPerDay: number;
  lastPlanAt: Date | null;
  lastTickAt: Date | null;
  aiSuggestion: unknown;
  channel?: { userId: string };
}

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly videoImport: VideoImportService,
    private readonly autonomy: AutonomyService,
  ) {}

  private async assertChannelOwnership(channelId: string, userId: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { userId: true },
    });
    if (!channel || channel.userId !== userId) {
      throw new NotFoundException('Channel not found');
    }
  }

  async get(
    channelId: string,
    userId: string,
  ): Promise<AutomationSettings & { lastTickAt: Date | null; aiSuggestion: unknown }> {
    await this.assertChannelOwnership(channelId, userId);
    const row = await this.prisma.channelAutomation.findUnique({
      where: { channelId },
    }) as ChannelAutomationRow | null;
    if (!row) {
      return { ...DEFAULTS, lastTickAt: null, aiSuggestion: null };
    }
    return {
      enabled: row.enabled,
      autoImport: row.autoImport,
      autoAnalyze: row.autoAnalyze,
      autoPublish: row.autoPublish,
      chapterSyncEnabled: row.chapterSyncEnabled,
      autoPlan: row.autoPlan,
      publishIntervalMinutes: row.publishIntervalMinutes,
      maxPublishesPerDay: row.maxPublishesPerDay,
      maxImportsPerDay: row.maxImportsPerDay,
      lastTickAt: row.lastTickAt,
      aiSuggestion: row.aiSuggestion,
    };
  }

  async update(channelId: string, userId: string, settings: unknown): Promise<AutomationSettings> {
    // Validate first (throws ZodError on invalid input)
    const validated = AutomationSettingsSchema.parse(settings);
    await this.assertChannelOwnership(channelId, userId);
    const row = await this.prisma.channelAutomation.upsert({
      where: { channelId },
      create: { channelId, ...validated },
      update: validated,
    }) as ChannelAutomationRow;
    return {
      enabled: row.enabled,
      autoImport: row.autoImport,
      autoAnalyze: row.autoAnalyze,
      autoPublish: row.autoPublish,
      chapterSyncEnabled: row.chapterSyncEnabled,
      autoPlan: row.autoPlan,
      publishIntervalMinutes: row.publishIntervalMinutes,
      maxPublishesPerDay: row.maxPublishesPerDay,
      maxImportsPerDay: row.maxImportsPerDay,
    };
  }

  async suggest(
    channelId: string,
    userId: string,
  ): Promise<{ suggestion: AutomationSettings; source: 'ai' | 'heuristic' }> {
    await this.assertChannelOwnership(channelId, userId);

    // Calculate upload cadence from the last 90 days
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentCount = await this.prisma.libraryVideo.count({
      where: { channelId, publishedAt: { gte: since }, archived: false },
    });
    const uploadsPerWeek = recentCount / (90 / 7);

    // Heuristic fallback values
    const heuristic: AutomationSettings = {
      enabled: false,
      autoImport: false,
      autoAnalyze: false,
      autoPublish: false,
      chapterSyncEnabled: false,
      autoPlan: false,
      publishIntervalMinutes: Math.max(
        120,
        Math.min(720, Math.round(1440 / Math.max(1, Math.round((uploadsPerWeek / 7) * 2)))),
      ),
      maxPublishesPerDay: Math.max(1, Math.min(4, Math.round(uploadsPerWeek / 7) + 1)),
      maxImportsPerDay: 3,
    };

    const AISuggestionSchema = AutomationSettingsSchema.extend({
      rationale: z.string().optional(),
    });

    let suggestion: AutomationSettings;
    let source: 'ai' | 'heuristic';

    try {
      const result = await callAIStructured(
        [
          {
            role: 'user',
            content: `You are a YouTube channel growth advisor. Based on the following channel upload data, suggest automation settings.

Channel stats:
- Recent uploads (last 90 days): ${recentCount}
- Estimated uploads per week: ${uploadsPerWeek.toFixed(2)}

Suggest automation settings that will help the creator maintain a consistent publishing schedule without overwhelming their audience.
All boolean fields (enabled, autoImport, autoAnalyze, autoPublish, chapterSyncEnabled) should be false â€” only the scheduling parameters should reflect the channel cadence.

Return a JSON object with these exact fields:
- enabled (boolean, false)
- autoImport (boolean, false)
- autoAnalyze (boolean, false)
- autoPublish (boolean, false)
- chapterSyncEnabled (boolean, false)
- autoPlan (boolean, false)
- publishIntervalMinutes (integer 15-1440): minutes between auto-publishes
- maxPublishesPerDay (integer 1-10): max clips published per day
- maxImportsPerDay (integer 1-10): max videos imported per day
- rationale (string): brief explanation`,
          },
        ],
        AISuggestionSchema,
        { systemPrompt: 'You are a YouTube automation advisor. Respond only with valid JSON.' },
      );
      // Strip the optional rationale field â€” not part of AutomationSettings
      const { rationale: _rationale, ...settings } = result;
      suggestion = settings;
      source = 'ai';
    } catch (err) {
      this.logger.warn(
        `AI suggestion failed, using heuristic: ${err instanceof Error ? err.message : String(err)}`,
      );
      suggestion = heuristic;
      source = 'heuristic';
    }

    // Persist to aiSuggestion column (non-fatal)
    try {
      await this.prisma.channelAutomation.upsert({
        where: { channelId },
        create: { channelId, ...DEFAULTS, aiSuggestion: suggestion as never },
        update: { aiSuggestion: suggestion as never },
      });
    } catch (persistErr) {
      this.logger.warn(
        `Failed to persist aiSuggestion: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
      );
    }

    return { suggestion, source };
  }

  async runTick(onLog?: (msg: string) => void): Promise<void> {
    const log = (msg: string) => {
      this.logger.log(msg);
      onLog?.(msg);
    };

    const automations = await this.prisma.channelAutomation.findMany({
      where: { enabled: true },
      include: { channel: { select: { userId: true } } },
    }) as ChannelAutomationRow[];

    log(`[AutomationTick] Processing ${automations.length} enabled channel(s)`);

    for (const automation of automations) {
      try {
        await this.tickChannel(automation, log);
      } catch (err) {
        this.logger.error(
          `[AutomationTick] Channel ${automation.channelId} tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    log('[AutomationTick] Tick complete');
  }

  private async tickChannel(automation: ChannelAutomationRow, log: (msg: string) => void): Promise<void> {
    const { channelId } = automation;

    // Get all projects for this channel
    const projects = await this.prisma.project.findMany({
      where: { channelId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // â”€â”€ a. autoImport â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (automation.autoImport) {
      try {
        const ownerUserId = automation.channel?.userId;
        if (!ownerUserId) {
          this.logger.warn(`[AutomationTick] channel=${channelId} autoImport: no userId on channel, skipping`);
        } else {
          const todayImportCount = await this.prisma.importedVideo.count({
            where: {
              projectId: { in: projectIds },
              createdAt: { gte: todayStart },
            },
          });

          const remaining = automation.maxImportsPerDay - todayImportCount;
          if (remaining > 0) {
            // Find library videos not yet imported (skip Shorts < 62 s)
            const alreadyImported = await this.prisma.importedVideo.findMany({
              where: { projectId: { in: projectIds } },
              select: { youtubeVideoId: true },
            });
            const importedYtIds = new Set(alreadyImported.map((v) => v.youtubeVideoId));

            const candidates = await this.prisma.libraryVideo.findMany({
              where: { channelId, archived: false, durationMs: { gte: 62000 } },
              orderBy: { publishedAt: 'desc' },
              take: remaining * 3,
            });

            let importedCount = 0;
            for (const lv of candidates) {
              if (importedCount >= remaining) break;
              if (importedYtIds.has(lv.youtubeVideoId)) continue;
              try {
                // importFromChannel handles dedup, project resolution, and metadata fallback
                await this.videoImport.importFromChannel(ownerUserId, channelId, lv.youtubeVideoId);
                importedCount++;
                log(`[AutomationTick] channel=${channelId} autoImport: imported ${lv.youtubeVideoId}`);
              } catch (importErr) {
                this.logger.warn(
                  `[AutomationTick] import failed for ${lv.youtubeVideoId}: ${importErr instanceof Error ? importErr.message : String(importErr)}`,
                );
              }
            }
          } else {
            log(
              `[AutomationTick] channel=${channelId} autoImport: daily quota reached (${todayImportCount}/${automation.maxImportsPerDay})`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `[AutomationTick] channel=${channelId} autoImport error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // â”€â”€ b. autoAnalyze â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (automation.autoAnalyze) {
      try {
        const pendingVideos = await this.prisma.importedVideo.findMany({
          where: { projectId: { in: projectIds }, transcriptStatus: 'PENDING' },
          select: { id: true, projectId: true },
          take: 5,
        });

        let analyzed = 0;
        for (const iv of pendingVideos) {
          if (analyzed >= 1) break;

          const existingJob = await this.prisma.agentJob.findFirst({
            where: {
              projectId: iv.projectId,
              type: 'SHORTS_ANALYZE',
              status: { in: ['RUNNING', 'QUEUED'] },
              payload: { path: ['importedVideoId'], equals: iv.id },
            },
          });

          if (existingJob) continue;

          await this.jobs.enqueue(
            iv.projectId,
            'SHORTS_ANALYZE',
            { importedVideoId: iv.id },
            { idempotencyKey: `auto-analyze:${iv.id}` },
          );
          analyzed++;
          log(`[AutomationTick] channel=${channelId} autoAnalyze: enqueued SHORTS_ANALYZE for ${iv.id}`);
        }
      } catch (err) {
        this.logger.error(
          `[AutomationTick] channel=${channelId} autoAnalyze error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // â”€â”€ c. autoPublish â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // CRITICAL: Only publish APPROVED clips. Never bypass approval (golden rule 2).
    if (automation.autoPublish) {
      try {
        // Count today's auto-publishes by this channel using ShortsExportHistory.publishedAt
        const todayPublishCount = await this.prisma.shortsExportHistory.count({
          where: {
            publishedAt: { gte: todayStart },
            shortClip: { projectId: { in: projectIds } },
          },
        });

        if (todayPublishCount >= automation.maxPublishesPerDay) {
          log(
            `[AutomationTick] channel=${channelId} autoPublish: daily quota reached (${todayPublishCount}/${automation.maxPublishesPerDay})`,
          );
        } else {
          // Check pacing: last publish for this channel from ShortsExportHistory.publishedAt
          const lastExport = await this.prisma.shortsExportHistory.findFirst({
            where: {
              publishedAt: { not: null },
              shortClip: { projectId: { in: projectIds } },
            },
            orderBy: { publishedAt: 'desc' },
          });

          const minIntervalMs = automation.publishIntervalMinutes * 60 * 1000;
          const lastPublishAt = lastExport?.publishedAt ?? null;
          const elapsed = lastPublishAt ? Date.now() - lastPublishAt.getTime() : Infinity;

          if (elapsed < minIntervalMs) {
            const waitMinutes = Math.round((minIntervalMs - elapsed) / 60000);
            log(
              `[AutomationTick] channel=${channelId} autoPublish: pacing â€” next publish in ~${waitMinutes} min`,
            );
          } else {
            const approvedClips = await this.prisma.shortClip.findMany({
              where: { projectId: { in: projectIds }, status: 'APPROVED' },
              include: { exports: { orderBy: { createdAt: 'desc' }, take: 1 } },
              take: 5,
            });

            let published = 0;
            for (const clip of approvedClips) {
              if (published >= 1) break;
              const exportRow = clip.exports[0];
              if (!exportRow) {
                log(`[AutomationTick] channel=${channelId} autoPublish: clip ${clip.id} has no export, skipping`);
                continue;
              }

              const exportJob = await this.prisma.agentJob.findFirst({
                where: {
                  projectId: clip.projectId,
                  type: 'SHORTS_EXPORT',
                  status: 'COMPLETED',
                  payload: { path: ['shortClipId'], equals: clip.id },
                },
                include: { approval: true },
              });

              if (!exportJob?.approval || exportJob.approval.status !== 'APPROVED') {
                log(
                  `[AutomationTick] channel=${channelId} autoPublish: clip ${clip.id} has no approved export job, skipping`,
                );
                continue;
              }

              try {
                await this.jobs.enqueue(
                  clip.projectId,
                  'SHORTS_PUBLISH',
                  { shortClipId: clip.id, approvalId: exportJob.approval.id, exportId: exportRow.id },
                  { idempotencyKey: `auto-publish:${clip.id}:${exportRow.id}` },
                );
                published++;
                log(
                  `[AutomationTick] channel=${channelId} autoPublish: enqueued SHORTS_PUBLISH for clip ${clip.id}`,
                );
              } catch (enqueueErr) {
                this.logger.warn(
                  `[AutomationTick] channel=${channelId} autoPublish enqueue error: ${enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr)}`,
                );
              }
            }
          }
        }
      } catch (err) {
        this.logger.error(
          `[AutomationTick] channel=${channelId} autoPublish error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // â”€â”€ d. chapterSyncEnabled â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (automation.chapterSyncEnabled) {
      try {
        const videosNeedingSync = await this.prisma.importedVideo.findMany({
          where: {
            projectId: { in: projectIds },
            chaptersSyncedAt: null,
            chapters: { some: {} },
          },
          select: { id: true, projectId: true },
          take: 3,
        });

        let synced = 0;
        for (const iv of videosNeedingSync) {
          if (synced >= 1) break;
          await this.jobs.enqueue(
            iv.projectId,
            'CHAPTER_DETECTION',
            { importedVideoId: iv.id },
            { idempotencyKey: `auto-chapters:${iv.id}` },
          );
          synced++;
          log(`[AutomationTick] channel=${channelId} chapterSync: enqueued CHAPTER_DETECTION for ${iv.id}`);
        }
      } catch (err) {
        this.logger.error(
          `[AutomationTick] channel=${channelId} chapterSync error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ── e. autoPlan (Phase 6 M2) ─────────────────────────────────────────────
    // Once per ~day: refresh the profile and top up the AI calendar when the
    // channel is low on future slots. Plans only — publishing gates untouched.
    if (automation.autoPlan) {
      const PLAN_INTERVAL_MS = 20 * 60 * 60 * 1000;
      const due =
        !automation.lastPlanAt || Date.now() - automation.lastPlanAt.getTime() >= PLAN_INTERVAL_MS;
      if (due) {
        // Stamp before running so a failing AI call can't retry every 15 min.
        await this.prisma.channelAutomation.update({
          where: { channelId },
          data: { lastPlanAt: new Date() },
        });
        try {
          await this.autonomy.autoPlanTick(channelId, log);
        } catch (err) {
          this.logger.error(
            `[AutomationTick] channel=${channelId} autoPlan error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // Update lastTickAt
    await this.prisma.channelAutomation.update({
      where: { channelId },
      data: { lastTickAt: new Date() },
    });

    log(`[AutomationTick] channel=${channelId} tick complete`);
  }
}
