import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CalendarEntryStatus, ContentCalendarEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrendService } from '../trend/trend.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { callAIStructured, GoalPlanOutputSchema, type TrendOutput, type GoalPlanOutput } from '@cf/shared';
import { z } from 'zod';

/**
 * Phase 6 Milestone 1 — autonomy foundation.
 *
 * The channel profile is the "long-term memory" the planner reasons over,
 * and the calendar generator is the first autonomous planning loop. It only
 * PLANS: approving an entry creates a DRAFT Video, so every human approval
 * gate downstream (metadata, publish) stays exactly as it is today.
 */

// What the LLM must return. dayOffset is relative to the generation date so
// the model never has to reason about absolute calendar dates.
const CalendarProposalSchema = z.object({
  entries: z
    .array(
      z.object({
        title: z.string().min(4),
        titleVariants: z.array(z.string()).default([]).describe('2-3 alternative title phrasings for A/B testing'),
        angle: z.string().optional().describe('A compelling hook or angle — one punchy sentence that would stop a viewer mid-scroll'),
        format: z.enum(['VIDEO', 'SHORT']).default('VIDEO'),
        dayOffset: z.number().int().min(0).max(27),
        timeOfDay: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .default('17:00'),
        priority: z.number().int().min(0).max(100).default(50),
        keywords: z.array(z.string()).default([]),
        rationale: z.string().optional(),
      }),
    )
    .min(1)
    .max(28),
});

type CalendarProposal = z.infer<typeof CalendarProposalSchema>;

// Self-critique verdicts (M2, spec §3.3): a second reasoning pass that
// scores the first draft against the channel profile before anything lands.
const CritiqueSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().min(0),
      keep: z.boolean(),
      priority: z.number().int().min(0).max(100).optional(),
      reason: z.string().optional(),
    }),
  ),
  summary: z.string(),
});

export interface RecentPerformanceEntry {
  title: string;
  views: number;
  likes: number;
  watchTimeSecs: number;
  recordedAt: string; // ISO string
}

export interface ChannelProfileSnapshot {
  niche: string;
  subscriberCount: number;
  totalUploads: number;
  uploadsPerWeek90d: number;
  avgViews90d: number;
  bestWeekdays: string[];
  bestHourUtc: number;
  formatMix: { videos: number; shorts: number };
  topTitles: string[];
  /** Top 5 videos by view count (90d window), with counts for the AI to reason over. */
  topPerformers?: Array<{ title: string; views: number; kind: string }>;
  pipeline: Record<string, number>;
  avgCtr?: number | null;
  avgRetentionSecs?: number | null;
  /** Rolling last-20 published video outcomes, newest first. */
  recentPerformance?: RecentPerformanceEntry[];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CALENDAR_SYSTEM =
  `You are an autonomous YouTube content planner. You propose realistic, channel-specific content calendars. ` +
  `Slots must respect the channel's real cadence (never propose more than ~1.5x their historical uploads/week), ` +
  `favour their best-performing weekdays and hours, and tie topics to current trends when given. ` +
  `Today's date: ${new Date().toISOString().split('T')[0]}.`;

@Injectable()
export class AutonomyService {
  private readonly logger = new Logger(AutonomyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trend: TrendService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async audit(userId: string, action: string, meta: Record<string, unknown>): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: { userId, action, meta: meta as never } });
    } catch {
      // Non-fatal — never let audit failure break the operation
    }
  }

  private async assertChannelOwnership(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, userId: true, title: true, niche: true, subscriberCount: true, videoCount: true },
    });
    if (!channel || channel.userId !== userId) {
      throw new NotFoundException('Channel not found');
    }
    return channel;
  }

  // ── Channel profile (long-term memory, M1-lite) ───────────────────────────

  async getProfile(channelId: string, userId: string, refresh = false) {
    await this.assertChannelOwnership(channelId, userId);
    if (!refresh) {
      const cached = await this.prisma.channelProfile.findUnique({ where: { channelId } });
      if (cached) return cached;
    }
    return this.buildProfile(channelId);
  }

  /** Aggregate the channel's history into a compact snapshot the planner can reason over. */
  async buildProfile(channelId: string) {
    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      select: { niche: true, subscriberCount: true, videoCount: true },
    });

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recent = await this.prisma.libraryVideo.findMany({
      where: { channelId, archived: false, publishedAt: { gte: since } },
      select: { kind: true, publishedAt: true, viewCount: true, title: true },
      orderBy: { viewCount: 'desc' },
    });

    // Publish-slot histograms from the last 90 days of uploads
    const dayCounts = new Array<number>(7).fill(0);
    const hourCounts = new Array<number>(24).fill(0);
    let views = 0;
    for (const v of recent) {
      if (v.publishedAt) {
        dayCounts[v.publishedAt.getUTCDay()] = (dayCounts[v.publishedAt.getUTCDay()] ?? 0) + 1;
        hourCounts[v.publishedAt.getUTCHours()] = (hourCounts[v.publishedAt.getUTCHours()] ?? 0) + 1;
      }
      views += v.viewCount;
    }
    const bestWeekdays = dayCounts
      .map((count, day) => ({ count, day }))
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((d) => WEEKDAYS[d.day]!) ;
    const bestHourUtc = hourCounts.indexOf(Math.max(...hourCounts));

    // Real analytics feed (M2/M5): pull AnalyticsSnapshot CTR + retention when available.
    const snapshots = await (this.prisma as any).analyticsSnapshot.findMany({
      where: { channelId, capturedAt: { gte: since }, ytVideoId: { not: null } },
      select: { metrics: true },
      orderBy: { capturedAt: 'desc' },
      take: 100,
    }) as Array<{ metrics: unknown }>;

    type MetricsShape = { ctr?: number; avgViewDurationSecs?: number; likeCount?: number; views?: number };
    const validMetrics = snapshots
      .map((s) => s.metrics as MetricsShape)
      .filter((m) => m && typeof m === 'object');

    const ctrItems = validMetrics.filter((m) => typeof m.ctr === 'number');
    const retItems = validMetrics.filter((m) => typeof m.avgViewDurationSecs === 'number');
    const avgCtr = ctrItems.length > 0
      ? ctrItems.reduce((acc, m) => acc + (m.ctr ?? 0), 0) / ctrItems.length
      : null;
    const avgRetentionSecs = retItems.length > 0
      ? retItems.reduce((acc, m) => acc + (m.avgViewDurationSecs ?? 0), 0) / retItems.length
      : null;

    const pipelineGroups = await this.prisma.video.groupBy({
      by: ['status'],
      where: { channelId },
      _count: true,
    });

    const profile: ChannelProfileSnapshot = {
      niche: channel.niche ?? 'General',
      subscriberCount: channel.subscriberCount,
      totalUploads: channel.videoCount,
      uploadsPerWeek90d: Math.round((recent.length / (90 / 7)) * 10) / 10,
      avgViews90d: recent.length ? Math.round(views / recent.length) : 0,
      bestWeekdays: bestWeekdays.length ? bestWeekdays : ['Saturday', 'Wednesday'],
      bestHourUtc: bestHourUtc >= 0 && hourCounts[bestHourUtc]! > 0 ? bestHourUtc : 17,
      formatMix: {
        videos: recent.filter((v) => v.kind === 'video').length,
        shorts: recent.filter((v) => v.kind === 'short').length,
      },
      topTitles: recent.slice(0, 5).map((v) => v.title),
      topPerformers: recent
        .filter((v) => v.viewCount > 0)
        .slice(0, 5)
        .map((v) => ({ title: v.title, views: v.viewCount, kind: v.kind })),
      pipeline: Object.fromEntries(pipelineGroups.map((g) => [g.status, g._count])),
      avgCtr,
      avgRetentionSecs,
    };

    return this.prisma.channelProfile.upsert({
      where: { channelId },
      create: { channelId, profile: profile as unknown as Prisma.InputJsonValue },
      update: { profile: profile as unknown as Prisma.InputJsonValue, computedAt: new Date() },
    });
  }

  // ── Calendar generation ───────────────────────────────────────────────────

  async generateCalendar(
    channelId: string,
    userId: string,
    opts: { weeks?: number; perWeek?: number; dryRun?: boolean },
  ) {
    await this.assertChannelOwnership(channelId, userId);
    const result = await this.generateCalendarInternal(channelId, opts);
    void this.audit(userId, 'autonomy.calendar.generate', {
      channelId,
      weeks: opts.weeks,
      perWeek: opts.perWeek,
      source: result.source,
      entryCount: result.entries.length,
      dryRun: result.dryRun ?? false,
    });
    return result;
  }

  /**
   * M4 — Enqueue a `CALENDAR_PROPOSAL` job and return its id.
   * The supervisor worker calls `generateCalendarForJob()` once it picks up the
   * job, so generation runs inside the credit-reservation / audit-log pipeline
   * exactly like RESEARCH and SCRIPT.
   */
  async generateCalendarQueued(
    channelId: string,
    userId: string,
    opts: { weeks?: number; perWeek?: number; dryRun?: boolean },
  ) {
    await this.assertChannelOwnership(channelId, userId);

    // Calendar jobs need a projectId row — reuse the AI Content Calendar project
    // (same project approve() uses) so all calendar work lives together.
    let project = await this.prisma.project.findFirst({
      where: { channelId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!project) {
      const channel = await this.prisma.channel.findUniqueOrThrow({
        where: { id: channelId },
        select: { userId: true, niche: true },
      });
      project = await this.prisma.project.create({
        data: {
          userId: channel.userId,
          channelId,
          title: 'AI Content Calendar',
          niche: channel.niche,
        },
        select: { id: true },
      });
    }

    const job = await this.jobs.enqueue(
      project.id,
      'CALENDAR_PROPOSAL',
      { channelId, ...opts },
      { idempotencyKey: `calendar-proposal:${channelId}:${Date.now()}` },
    );
    return { jobId: job.id };
  }

  /** Public wrapper for the supervisor worker — skips ownership check. */
  async generateCalendarForJob(
    channelId: string,
    opts: { weeks?: number; perWeek?: number; dryRun?: boolean },
  ) {
    return this.generateCalendarInternal(channelId, opts);
  }

  /** Ownership-free core — also driven by the automation tick (autoPlan). */
  private async generateCalendarInternal(
    channelId: string,
    opts: { weeks?: number; perWeek?: number; dryRun?: boolean },
  ) {
    const channel = await this.prisma.channel.findUniqueOrThrow({
      where: { id: channelId },
      select: { id: true, title: true },
    });
    const weeks = Math.min(Math.max(opts.weeks ?? 2, 1), 4);
    const perWeek = Math.min(Math.max(opts.perWeek ?? 3, 1), 7);
    const total = weeks * perWeek;

    const profileRow = await this.buildProfile(channelId);
    const profile = profileRow.profile as unknown as ChannelProfileSnapshot;

    // Trend context is best-effort — planning still works without it.
    let trends: TrendOutput | null = null;
    try {
      trends = await this.trend.analyze(profile.niche, profile.subscriberCount);
    } catch (err) {
      this.logger.warn(`Trend context unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Top performer context — prefer recentPerformance (platform-published videos with
    // confirmed view counts); fall back to topPerformers from LibraryVideo 90d window.
    const topPerformerTitles: string[] = profile.recentPerformance && profile.recentPerformance.length > 0
      ? [...profile.recentPerformance]
          .sort((a, b) => b.views - a.views)
          .slice(0, 5)
          .map((p) => `${p.title} (${p.views.toLocaleString()} views)`)
      : (profile.topPerformers ?? [])
          .map((p) => `${p.title} (${p.views.toLocaleString()} views, ${p.kind})`);

    let proposal: CalendarProposal;
    let source: 'ai' | 'heuristic' = 'ai';
    try {
      proposal = await callAIStructured(
        [
          {
            role: 'user',
            content:
              `Plan a ${weeks}-week content calendar (${total} slots, ~${perWeek}/week) for the YouTube channel "${channel.title}".\n\n` +
              `CHANNEL PROFILE:\n${JSON.stringify(profile, null, 2)}\n\n` +
              (topPerformerTitles.length > 0
                ? `TOP PERFORMING PAST VIDEOS (by views — lean into similar topics/formats where appropriate):\n${topPerformerTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n`
                : '') +
              (trends
                ? `CURRENT TRENDS (tie topics to these where sensible):\n${JSON.stringify(trends.trending.slice(0, 6), null, 2)}\n\n`
                : '') +
              `Rules:\n` +
              `- dayOffset 0 = tomorrow; spread slots across the ${weeks} weeks on the channel's best weekdays.\n` +
              `- timeOfDay in 24h UTC, near hour ${profile.bestHourUtc}:00.\n` +
              `- Mix formats roughly like the channel's history (videos vs shorts).\n` +
              `- Every title must be specific and clickable for the "${profile.niche}" niche — no generic placeholders.\n` +
              `- priority = opportunity score 0-100; include 2-5 keywords per entry and a one-line rationale.\n` +
              `- For each entry, provide titleVariants: 2-3 alternative title phrasings for A/B testing.\n\n` +
              `Respond with EXACTLY this JSON structure (no extra text):\n` +
              `{"entries":[{"title":"...","titleVariants":["Alt title 1","Alt title 2"],"angle":"...","format":"VIDEO","dayOffset":1,"timeOfDay":"17:00","priority":80,"keywords":["k1","k2"],"rationale":"..."}]}`,
          },
        ],
        CalendarProposalSchema,
        { systemPrompt: CALENDAR_SYSTEM, maxTokens: 4000 },
      );
    } catch (err) {
      this.logger.warn(`AI calendar failed, using heuristic: ${err instanceof Error ? err.message : String(err)}`);
      proposal = this.heuristicProposal(profile, weeks, perWeek);
      source = 'heuristic';
    }

    // Self-critique (M2): a second pass judges the draft against the profile.
    // Best-effort — the original draft ships if the critic is unavailable.
    let critique: string | null = null;
    if (source === 'ai') {
      try {
        const result = await this.critiqueProposal(proposal, profile);
        proposal = result.proposal;
        critique = result.summary;
      } catch (err) {
        this.logger.warn(`Self-critique skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Anchor dayOffset 0 to tomorrow so the whole plan is in the future.
    const anchor = new Date();
    anchor.setUTCDate(anchor.getUTCDate() + 1);
    anchor.setUTCHours(0, 0, 0, 0);

    const batchId = randomUUID();
    const rows = proposal.entries.slice(0, total).map((e) => {
      const [h, m] = e.timeOfDay.split(':').map(Number);
      const plannedAt = new Date(anchor);
      plannedAt.setUTCDate(plannedAt.getUTCDate() + e.dayOffset);
      plannedAt.setUTCHours(h ?? 17, m ?? 0, 0, 0);
      return {
        channelId,
        batchId,
        title: e.title,
        titleVariants: e.titleVariants ?? [],
        angle: e.angle ?? null,
        format: e.format,
        plannedAt,
        priority: e.priority,
        keywords: e.keywords,
        rationale: e.rationale ?? null,
        source,
      };
    });

    if (opts.dryRun) {
      return { batchId: null, source, dryRun: true, critique, profile, entries: rows };
    }

    await this.prisma.contentCalendarEntry.createMany({ data: rows });
    const entries = await this.prisma.contentCalendarEntry.findMany({
      where: { batchId },
      orderBy: { plannedAt: 'asc' },
    });
    return { batchId, source, dryRun: false, critique, profile, entries };
  }

  /** Second reasoning pass: drop weak slots, re-score the rest. */
  private async critiqueProposal(
    proposal: CalendarProposal,
    profile: ChannelProfileSnapshot,
  ): Promise<{ proposal: CalendarProposal; summary: string }> {
    const critique = await callAIStructured(
      [
        {
          role: 'user',
          content:
            `You are reviewing a colleague's proposed YouTube content calendar. Judge every entry against the channel profile: ` +
            `is the topic specific and on-niche, is the slot consistent with the channel's cadence and best publish times, ` +
            `is the priority honest?\n\n` +
            `CHANNEL PROFILE:\n${JSON.stringify(profile, null, 2)}\n\n` +
            `PROPOSED ENTRIES (judge by array index):\n${JSON.stringify(proposal.entries, null, 2)}\n\n` +
            `For each index return keep=true/false, optionally a corrected priority (0-100) and a one-line reason. ` +
            `Drop generic, off-niche, or unrealistic entries. Then give a one-paragraph summary of the calendar's quality.\n\n` +
            `Respond with EXACTLY this JSON structure (no extra text):\n` +
            `{"verdicts":[{"index":0,"keep":true,"priority":75,"reason":"..."}],"summary":"..."}`,
        },
      ],
      CritiqueSchema,
      { systemPrompt: CALENDAR_SYSTEM, maxTokens: 2000 },
    );

    const byIndex = new Map(critique.verdicts.map((v) => [v.index, v]));
    const kept = proposal.entries
      .map((entry, i) => ({ entry, verdict: byIndex.get(i) }))
      .filter(({ verdict }) => verdict?.keep !== false)
      .map(({ entry, verdict }) => ({
        ...entry,
        priority: verdict?.priority ?? entry.priority,
        rationale: verdict?.reason ? `${entry.rationale ?? ''} [critic: ${verdict.reason}]`.trim() : entry.rationale,
      }));

    // A critic that rejects everything is judging itself — keep the draft.
    if (kept.length === 0) {
      return { proposal, summary: `${critique.summary} (all entries rejected — original draft kept)` };
    }
    return { proposal: { entries: kept }, summary: critique.summary };
  }

  /**
   * Automation-tick hook (M2): refresh the profile and top up the calendar
   * when a channel opted into autoPlan and is running low on future slots.
   * Returns true when a generation ran. Once-per-day pacing is the caller's
   * job (ChannelAutomation.lastPlanAt).
   */
  async autoPlanTick(channelId: string, log: (msg: string) => void): Promise<boolean> {
    const MIN_UPCOMING = 3;
    const upcoming = await this.prisma.contentCalendarEntry.count({
      where: {
        channelId,
        status: { in: ['PROPOSED', 'APPROVED'] },
        plannedAt: { gte: new Date() },
      },
    });
    if (upcoming >= MIN_UPCOMING) {
      log(`[AutoPlan] channel=${channelId} has ${upcoming} upcoming slots — no top-up needed`);
      return false;
    }

    const profileRow = await this.buildProfile(channelId);
    const profile = profileRow.profile as unknown as ChannelProfileSnapshot;
    const perWeek = Math.min(Math.max(Math.round(profile.uploadsPerWeek90d) || 2, 1), 7);

    const result = await this.generateCalendarInternal(channelId, { weeks: 2, perWeek });
    log(`[AutoPlan] channel=${channelId} topped up ${result.entries.length} slot(s) (${result.source})`);
    return true;
  }

  /** Cadence-based fallback when no AI provider is reachable. */
  private heuristicProposal(profile: ChannelProfileSnapshot, weeks: number, perWeek: number): CalendarProposal {
    const dayIndexes = profile.bestWeekdays
      .map((d) => WEEKDAYS.indexOf(d))
      .filter((i) => i >= 0);
    const preferShorts = profile.formatMix.shorts > profile.formatMix.videos;
    const entries: CalendarProposal['entries'] = [];
    for (let w = 0; w < weeks; w++) {
      for (let s = 0; s < perWeek; s++) {
        const day = dayIndexes[s % Math.max(dayIndexes.length, 1)] ?? 6;
        // Offset within the plan: start of week w, next occurrence of `day`
        const dayOffset = Math.min(w * 7 + ((day + 7 - 1) % 7), 27);
        entries.push({
          title: `${profile.niche} update — week ${w + 1}, slot ${s + 1}`,
          angle: 'Heuristic slot from your historical cadence (AI unavailable)',
          format: preferShorts && s % 2 === 1 ? 'SHORT' : 'VIDEO',
          dayOffset,
          timeOfDay: `${String(profile.bestHourUtc).padStart(2, '0')}:00`,
          priority: 40,
          keywords: [profile.niche.toLowerCase()],
          titleVariants: [],
          rationale: 'Matches your best publish weekday and hour from the last 90 days.',
        });
      }
    }
    return { entries };
  }

  // ── Calendar CRUD ─────────────────────────────────────────────────────────

  async listCalendar(
    channelId: string,
    userId: string,
    opts: { status?: CalendarEntryStatus; from?: Date; to?: Date },
  ) {
    await this.assertChannelOwnership(channelId, userId);
    return this.prisma.contentCalendarEntry.findMany({
      where: {
        channelId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.from || opts.to
          ? { plannedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
          : {}),
      },
      orderBy: { plannedAt: 'asc' },
    });
  }

  private async getOwnedEntry(entryId: string, userId: string): Promise<ContentCalendarEntry> {
    const entry = await this.prisma.contentCalendarEntry.findUnique({
      where: { id: entryId },
      include: { channel: { select: { userId: true } } },
    });
    if (!entry || entry.channel.userId !== userId) {
      throw new NotFoundException('Calendar entry not found');
    }
    return entry;
  }

  /**
   * Approving a planned slot creates a DRAFT Video so the normal production
   * pipeline (research → script → approval → publish) takes over. The video
   * is parked under the channel's newest project, or a dedicated
   * "AI Content Calendar" project when none exists.
   */
  async approve(entryId: string, userId: string) {
    const entry = await this.getOwnedEntry(entryId, userId);

    let project = await this.prisma.project.findFirst({
      where: { channelId: entry.channelId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!project) {
      const channel = await this.prisma.channel.findUniqueOrThrow({
        where: { id: entry.channelId },
        select: { userId: true, niche: true },
      });
      project = await this.prisma.project.create({
        data: {
          userId: channel.userId,
          channelId: entry.channelId,
          title: 'AI Content Calendar',
          niche: channel.niche,
        },
        select: { id: true },
      });
    }

    const video = await this.prisma.video.create({
      data: {
        projectId: project.id,
        channelId: entry.channelId,
        title: entry.title,
        description: [entry.angle, entry.rationale].filter(Boolean).join('\n\n') || null,
        tags: entry.keywords,
        status: 'DRAFT',
        scheduledAt: entry.plannedAt,
      },
    });

    // M3: if the channel opted into autoResearch, kick off RESEARCH immediately
    // so the pipeline can start while the human moves on. Best-effort — never
    // blocks the approve response.
    try {
      const channelAutomation = await this.prisma.channelAutomation.findUnique({
        where: { channelId: entry.channelId },
        select: { autoResearch: true },
      });
      if (channelAutomation?.autoResearch) {
        await this.jobs.enqueue(
          project.id,
          'RESEARCH',
          { topic: entry.title },
          { idempotencyKey: `auto-research:${video.id}` },
        );
        this.logger.log(`[AutoResearch] Enqueued RESEARCH for video=${video.id} (calendar entry=${entry.id})`);
      }
    } catch (err) {
      this.logger.warn(`[AutoResearch] Failed to enqueue RESEARCH (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }

    const updated = await this.prisma.contentCalendarEntry.update({
      where: { id: entry.id },
      data: { status: 'APPROVED', videoId: video.id },
    });
    void this.audit(userId, 'autonomy.entry.approve', { channelId: entry.channelId, entryId: entry.id, title: entry.title });
    return updated;
  }

  async dismiss(entryId: string, userId: string) {
    const entry = await this.getOwnedEntry(entryId, userId);
    const updated = await this.prisma.contentCalendarEntry.update({
      where: { id: entry.id },
      data: { status: 'DISMISSED' },
    });
    void this.audit(userId, 'autonomy.entry.dismiss', { channelId: entry.channelId, entryId: entry.id, title: entry.title });
    return updated;
  }

  async bulkApprove(channelId: string, userId: string, ids: string[]): Promise<{ updated: number }> {
    await this.assertChannelOwnership(channelId, userId);
    const result = await this.prisma.contentCalendarEntry.updateMany({
      where: { id: { in: ids }, channelId, status: 'PROPOSED' },
      data: { status: 'APPROVED' },
    });
    void this.audit(userId, 'autonomy.entry.bulk_approve', { channelId, count: result.count });
    return { updated: result.count };
  }

  async bulkDismiss(channelId: string, userId: string, ids: string[]): Promise<{ updated: number }> {
    await this.assertChannelOwnership(channelId, userId);
    const result = await this.prisma.contentCalendarEntry.updateMany({
      where: { id: { in: ids }, channelId, status: 'PROPOSED' },
      data: { status: 'DISMISSED' },
    });
    void this.audit(userId, 'autonomy.entry.bulk_dismiss', { channelId, count: result.count });
    return { updated: result.count };
  }

  // ── Calendar lifecycle ────────────────────────────────────────────────────

  /**
   * M5 — Auto-expire: called from the automation tick.
   * Finds PROPOSED entries whose plannedAt has passed by more than 1 day
   * (grace window avoids racing with same-day approval) and dismisses them.
   * Triggers autoPlanTick() afterwards so the pipeline stays filled.
   */
  async expireOverdue(channelId: string, log: (msg: string) => void): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const overdue = await this.prisma.contentCalendarEntry.findMany({
      where: { channelId, status: 'PROPOSED', plannedAt: { lt: cutoff } },
      select: { id: true, title: true },
    });

    if (!overdue.length) return;

    await this.prisma.contentCalendarEntry.updateMany({
      where: { id: { in: overdue.map((e) => e.id) } },
      data: { status: 'DISMISSED' },
    });

    log(`[autonomy] Expired ${overdue.length} overdue PROPOSED slot(s): ${overdue.map((e) => e.title).join(', ')}`);
    this.logger.log(`expireOverdue: channel=${channelId} expired=${overdue.length}`);

    try {
      await this.autoPlanTick(channelId, (msg) => this.logger.log(msg));
    } catch (err) {
      this.logger.warn(`expireOverdue: autoPlanTick failed after expiry — ${String(err)}`);
    }
  }

  /**
   * M5 — Calendar stats: aggregate counts and derived metrics for the UI.
   * Verifies channel ownership before querying.
   */
  async getCalendarStats(channelId: string, userId: string) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, userId },
      select: { id: true },
    });
    if (!channel) throw new ForbiddenException('Channel not found');

    const now = new Date();
    const next7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [statusGroups, upcoming7d, avgPriorityAgg] = await Promise.all([
      this.prisma.contentCalendarEntry.groupBy({
        by: ['status'],
        where: { channelId },
        _count: { id: true },
      }),
      this.prisma.contentCalendarEntry.count({
        where: { channelId, status: { in: ['PROPOSED', 'APPROVED'] }, plannedAt: { gte: now, lte: next7d } },
      }),
      this.prisma.contentCalendarEntry.aggregate({
        where: { channelId, status: { in: ['PROPOSED', 'APPROVED'] } },
        _avg: { priority: true },
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const g of statusGroups) {
      counts[g.status] = g._count.id;
    }

    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    const approved = counts['APPROVED'] ?? 0;
    const dismissed = counts['DISMISSED'] ?? 0;
    const proposed = counts['PROPOSED'] ?? 0;
    const scheduled = counts['SCHEDULED'] ?? 0;
    const reviewed = approved + dismissed;
    const approvalRate = reviewed > 0 ? Math.round((approved / reviewed) * 100) : null;

    return {
      total,
      proposed,
      approved,
      dismissed,
      scheduled,
      upcoming7d,
      approvalRate,
      avgPriority: avgPriorityAgg._avg.priority != null ? Math.round(avgPriorityAgg._avg.priority) : null,
    };
  }

  /**
   * M3 — Escalation: called from the automation tick.
   * Finds PROPOSED entries that have been waiting > STALE_DAYS without review
   * and fires an in-app notification to the channel owner so they don't miss them.
   * Safe to call every tick — the NotificationsService dedupes within 24 h.
   */
  async escalateStale(channelId: string, log: (msg: string) => void): Promise<void> {
    const STALE_DAYS = 3;
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

    const stale = await this.prisma.contentCalendarEntry.findMany({
      where: { channelId, status: 'PROPOSED', createdAt: { lte: cutoff } },
      include: { channel: { select: { userId: true, title: true } } },
      orderBy: { plannedAt: 'asc' },
      take: 10,
    });

    if (!stale.length) {
      log(`[Escalation] channel=${channelId} no stale proposals`);
      return;
    }

    const userId = stale[0]!.channel.userId;
    const channelTitle = stale[0]!.channel.title ?? 'your channel';
    const count = stale.length;
    const oldest = stale[0]!;

    await this.notifications.notify(
      userId,
      'CALENDAR_STALE',
      `${count} content proposal${count > 1 ? 's' : ''} awaiting review`,
      `"${oldest.title}" and ${count - 1} other${count > 1 ? 's' : ''} for ${channelTitle} have been waiting more than ${STALE_DAYS} days. Visit Autonomy to approve or dismiss.`,
      { channelId, count, oldestEntryId: oldest.id },
    );

    void this.audit(userId, 'autonomy.escalation.stale', { channelId, count, oldestEntryId: oldest.id });
    log(`[Escalation] channel=${channelId} notified userId=${userId} — ${count} stale proposal(s)`);
  }

  /** M6 — Update an entry's title (e.g. swap in a variant). */
  async updateEntryTitle(entryId: string, userId: string, title: string): Promise<void> {
    const entry = await this.prisma.contentCalendarEntry.findUnique({
      where: { id: entryId },
      include: { channel: { select: { userId: true } } },
    });
    if (!entry || entry.channel.userId !== userId) throw new ForbiddenException('Entry not found');
    await this.prisma.contentCalendarEntry.update({ where: { id: entryId }, data: { title } });
  }

  /**
   * Performance feedback loop (spec M2/M5): record actual video performance
   * so the next profile refresh incorporates real outcome data.
   */
  async recordPerformanceFeedback(
    channelId: string,
    userId: string,
    data: {
      ytVideoId: string;
      views: number;
      likeCount?: number;
      ctr?: number;
      avgViewDurationSecs?: number;
    },
  ) {
    await this.assertChannelOwnership(channelId, userId);
    await (this.prisma as any).analyticsSnapshot.create({
      data: {
        channelId,
        ytVideoId: data.ytVideoId,
        metrics: {
          views: data.views,
          likeCount: data.likeCount ?? 0,
          ctr: data.ctr ?? null,
          avgViewDurationSecs: data.avgViewDurationSecs ?? null,
          source: 'manual_feedback',
        } as any,
      },
    });
    await this.buildProfile(channelId);
    void this.audit(userId, 'autonomy.feedback.record', { channelId, ytVideoId: data.ytVideoId, views: data.views });
    this.logger.log(`[feedback] channelId=${channelId} ytVideoId=${data.ytVideoId} views=${data.views}`);
    return { ok: true };
  }

  /**
   * Phase 6 Performance Feedback Loop — record actual publish outcomes and
   * fold them back into the ChannelProfile so the next calendar generation
   * has real signal to reason over.
   *
   * Call this from the approvals service once a video approval completes with
   * status APPROVED and job type SHORTS_PUBLISH or PUBLISH.
   *
   * - Appends an entry to `recentPerformance` (rolling window of 20).
   * - Updates `avgViews90d` with an 80/20 weighted blend so one outlier
   *   doesn't skew the whole profile.
   */
  async recordVideoPerformance(
    channelId: string,
    data: { videoId: string; views: number; likes: number; watchTimeSecs: number },
  ): Promise<void> {
    // Fetch the video title for the performance entry label.
    const video = await this.prisma.video.findUnique({
      where: { id: data.videoId },
      select: { title: true },
    });
    const title = video?.title ?? data.videoId;

    // Load the existing profile (or build fresh if absent).
    let profileRow = await this.prisma.channelProfile.findUnique({ where: { channelId } });
    if (!profileRow) {
      profileRow = await this.buildProfile(channelId);
    }

    const profile = profileRow.profile as unknown as ChannelProfileSnapshot;

    // Build the new entry.
    const newEntry: RecentPerformanceEntry = {
      title,
      views: data.views,
      likes: data.likes,
      watchTimeSecs: data.watchTimeSecs,
      recordedAt: new Date().toISOString(),
    };

    // Rolling window — prepend newest, keep last 20.
    const existing = profile.recentPerformance ?? [];
    const recentPerformance = [newEntry, ...existing].slice(0, 20);

    // Weighted blend: 80% historical average + 20% new data point.
    const avgViews90d = Math.round(profile.avgViews90d * 0.8 + data.views * 0.2);

    const updated: ChannelProfileSnapshot = { ...profile, avgViews90d, recentPerformance };

    await this.prisma.channelProfile.upsert({
      where: { channelId },
      create: { channelId, profile: updated as unknown as Prisma.InputJsonValue },
      update: { profile: updated as unknown as Prisma.InputJsonValue, computedAt: new Date() },
    });

    this.logger.log(
      `[recordVideoPerformance] channelId=${channelId} videoId=${data.videoId} views=${data.views} likes=${data.likes} watchTimeSecs=${data.watchTimeSecs}`,
    );
  }

  /**
   * Cross-channel optimization engine (spec §2 Scope): analyzes all channels
   * belonging to the user and returns AI-generated cross-channel recommendations.
   */
  async getCrossChannelInsights(userId: string) {
    const channels = await this.prisma.channel.findMany({
      where: { userId },
      select: { id: true, title: true, niche: true, subscriberCount: true, videoCount: true },
    });

    if (channels.length === 0) return { insights: [], summary: 'No channels found.', channelCount: 0 };

    const profiles = await Promise.all(
      channels.map(async (ch) => {
        const profile = await this.prisma.channelProfile.findUnique({ where: { channelId: ch.id } });
        return {
          channelId: ch.id,
          title: ch.title,
          niche: ch.niche ?? 'General',
          subscriberCount: ch.subscriberCount,
          profile: profile?.profile ?? null,
        };
      }),
    );

    if (channels.length === 1) {
      return {
        insights: [
          {
            category: 'single_channel',
            recommendation: 'Add more channels to unlock cross-channel optimization insights.',
            priority: 'info',
          },
        ],
        summary: 'Only one channel found. Cross-channel analysis requires multiple channels.',
        channelCount: 1,
      };
    }

    const CrossChannelSchema = z.object({
      insights: z
        .array(
          z.object({
            category: z.enum(['timing', 'format', 'topic', 'cadence', 'synergy', 'gap']),
            recommendation: z.string(),
            channels: z.array(z.string()).optional(),
            priority: z.enum(['high', 'medium', 'low']),
          }),
        )
        .min(1)
        .max(8),
      summary: z.string(),
    });

    const result = await callAIStructured(
      [
        {
          role: 'user',
          content:
            `Analyze these YouTube channels for cross-channel optimization:\n${JSON.stringify(profiles, null, 2)}\n\n` +
            `Focus on: timing synergies, format gaps, topic overlaps/gaps, cadence mismatches, collaboration opportunities. Be specific and actionable.`,
        },
      ],
      CrossChannelSchema,
      {
        systemPrompt: 'You are a YouTube growth strategist analyzing multiple channels for cross-channel optimization.',
        maxTokens: 2000,
      },
    );

    return { ...result, channelCount: channels.length };
  }

  /**
   * M3 — Exception escalation: called by SupervisorWorker when any pipeline job
   * fails. Sends an in-app notification to the channel owner so they know what
   * broke and can intervene.
   */
  async escalateJobFailure(
    projectId: string,
    jobType: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: { channel: { select: { userId: true, title: true } } },
      });
      if (!project) return;

      const userId = project.channel.userId;
      const channelTitle = project.channel.title ?? 'your channel';

      await this.notifications.notify(
        userId,
        'JOB_FAILED',
        `Content pipeline step failed`,
        `The "${jobType}" step for "${project.title}" on ${channelTitle} could not complete. Error: ${errorMessage.slice(0, 200)}. Please check the project and retry.`,
        { projectId, jobType, error: errorMessage.slice(0, 500) },
      );

      await this.audit(userId, 'autonomy.job.failure_escalated', {
        projectId,
        jobType,
        channelId: project.channelId,
        error: errorMessage.slice(0, 500),
      });
    } catch {
      // Non-fatal
    }
  }

  /**
   * Returns recent autonomy audit log entries for a channel.
   * Queries the shared AuditLog table for actions prefixed with 'autonomy.'.
   */
  async getAuditLog(channelId: string, userId: string, take = 50) {
    await this.assertChannelOwnership(channelId, userId);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: { startsWith: 'autonomy.' },
        meta: { path: ['channelId'], equals: channelId },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(take, 100),
      select: { id: true, action: true, meta: true, createdAt: true },
    });
    return logs;
  }

  async goalDecompose(channelId: string, userId: string, goal: string, timeframeWeeks: number): Promise<GoalPlanOutput> {
    const [profileRow, channel] = await Promise.all([
      this.buildProfile(channelId),
      this.prisma.channel.findUnique({ where: { id: channelId }, select: { title: true } }),
    ]);
    const profile = profileRow.profile as unknown as ChannelProfileSnapshot;

    const profileSummary = [
      `Channel: ${channel?.title ?? channelId}`,
      `Avg views/video: ${profile.avgViews90d ?? 'unknown'}`,
      `Upload cadence: ${profile.uploadsPerWeek90d?.toFixed(1) ?? '?'} videos/week`,
      `Top formats: ${Object.entries(profile.formatMix).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k).join(', ')}`,
      `Best weekday: ${profile.bestWeekdays[0] ?? 'any'}`,
      `Avg CTR: ${profile.avgCtr ? (profile.avgCtr * 100).toFixed(1) + '%' : 'unknown'}`,
      `Avg retention: ${profile.avgRetentionSecs ? Math.round(profile.avgRetentionSecs) + 's' : 'unknown'}`,
    ].join('\n');

    return callAIStructured(
      [{
        role: 'user',
        content: `Decompose this YouTube channel growth goal into a concrete ${timeframeWeeks}-week plan.\n\nGoal: ${goal}\nTimeframe: ${timeframeWeeks} weeks\n\nChannel profile:\n${profileSummary}\n\nCreate a realistic, actionable plan with weekly video topics. Each week should have 1-3 specific video ideas with titles, rationale, and estimated impact. Include measurable milestones and success metrics.\n\nReturn ONLY valid JSON matching the schema (no markdown, no code fences):\n{"goal":"${goal}","timeframeWeeks":${timeframeWeeks},"summary":"Brief 1-2 sentence strategy overview","milestones":[{"week":4,"milestone":"Reach 5k views/video average","metric":"Views per video > 5000"}],"weeklyPlan":[{"week":1,"theme":"Foundation week","videos":[{"title":"Specific video title","rationale":"Why this video","estimatedImpact":75,"productionComplexity":"medium","suggestedFormat":"tutorial"}],"cumulativeGrowthEstimate":"+100 subs"}],"resources":{"hoursPerWeek":10,"toolsNeeded":["Screen recorder"],"contentTypes":["tutorial","shorts"]},"successMetrics":["metric 1"],"risks":["risk 1"]}`,
      }],
      GoalPlanOutputSchema,
      {
        systemPrompt: 'You are a YouTube growth strategist. Create specific, actionable, data-driven content plans. Each video suggestion must have a concrete title — not a template.',
        maxTokens: 6000,
      },
    );
  }
}
