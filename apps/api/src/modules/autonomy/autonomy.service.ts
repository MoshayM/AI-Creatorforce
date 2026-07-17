import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CalendarEntryStatus, ContentCalendarEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrendService } from '../trend/trend.service';
import { callAIStructured, type TrendOutput } from '@cf/shared';
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
        angle: z.string().optional(),
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
  pipeline: Record<string, number>;
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
  ) {}

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
      pipeline: Object.fromEntries(pipelineGroups.map((g) => [g.status, g._count])),
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
              (trends
                ? `CURRENT TRENDS (tie topics to these where sensible):\n${JSON.stringify(trends.trending.slice(0, 6), null, 2)}\n\n`
                : '') +
              `Rules:\n` +
              `- dayOffset 0 = tomorrow; spread slots across the ${weeks} weeks on the channel's best weekdays.\n` +
              `- timeOfDay in 24h UTC, near hour ${profile.bestHourUtc}:00.\n` +
              `- Mix formats roughly like the channel's history (videos vs shorts).\n` +
              `- Every title must be specific and clickable for the "${profile.niche}" niche — no generic placeholders.\n` +
              `- priority = opportunity score 0-100; include 2-5 keywords per entry and a one-line rationale.\n\n` +
              `Respond with EXACTLY this JSON structure (no extra text):\n` +
              `{"entries":[{"title":"...","angle":"...","format":"VIDEO","dayOffset":1,"timeOfDay":"17:00","priority":80,"keywords":["k1","k2"],"rationale":"..."}]}`,
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

    return this.prisma.contentCalendarEntry.update({
      where: { id: entry.id },
      data: { status: 'APPROVED', videoId: video.id },
    });
  }

  async dismiss(entryId: string, userId: string) {
    const entry = await this.getOwnedEntry(entryId, userId);
    return this.prisma.contentCalendarEntry.update({
      where: { id: entry.id },
      data: { status: 'DISMISSED' },
    });
  }
}
