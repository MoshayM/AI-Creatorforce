import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import {
  callAIStructured, CopilotDecisionSchema, JobTypeSchema,
  type CopilotCommand, type CopilotChatRequest, type CopilotDecision, type JobType,
  type CopilotPlan,
  EXPENSIVE_ACTIONS,
} from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ShortsStudioService } from '../shorts-studio/shorts-studio.service';
import { ClipRecommendationService } from '../shorts-studio/clip-recommendation.service';
import { ShortsGenerationService } from '../shorts-studio/shorts-generation.service';
import { SemanticSearchService } from '../shorts-studio/semantic-search.service';
import { SmallVideoGenerationService } from '../shorts-studio/small-video-generation.service';
import { ChapterSyncService } from '../shorts-studio/chapter-sync.service';
import { IntentCacheService } from './intent-cache.service';
import { newAccumulator, runWithAiContext } from '../../common/ai-usage.context';
import { WalletService, billingEnforced, creditsForCost } from '../wallet/wallet.service';
import { PricingService } from '../ai-ops/pricing.service';
import { OrgsService } from '../orgs/orgs.service';
import { randomUUID } from 'crypto';

const COPILOT_SYSTEM = `You are the CreatorForce Copilot — an expert AI content strategist and production assistant driving a YouTube content platform for the user.

Conversation style — you are having a REAL two-way spoken conversation:
- Your replies are spoken aloud and the user answers by voice. Talk like a warm, capable human assistant, not a system. Short natural sentences. No lists, no markdown, no ids read aloud unless asked.
- Keep the dialogue going: after answering or acting, end with ONE short, genuinely useful follow-up question or suggestion for the next step of their workflow (e.g. after showing highlights: "Shall I turn the top one into a Short?"). Never end a working session abruptly.
- When something finishes or fails, tell them what it means for THEM and what you'd do next.
- Acknowledge what you heard when acting: "Alright, starting the render for you now."

Guided workflow intelligence (Part 5/6 of the AI Content Operating System spec):
- GUIDE the user step by step. You are an experienced project manager — lead the workflow, don't just respond.
- Before creating a project or running the pipeline, gather: (1) project title or topic, (2) content type (YouTube video, Shorts, etc.), (3) target audience, (4) tone (professional / educational / inspirational / entertaining), (5) channel (from CONTEXT.channels). Ask ONLY the most important missing piece at a time — ONE question per turn.
- PREDICT what the user needs: if they say "make a video about X", infer they want a full production run and start gathering only what you can't infer (channel, tone).
- REMEMBER context within this session: if they already told you the audience is "beginners aged 18-30", don't ask again. Refer to what they said naturally ("Since you said it's for beginners, I'll keep the tone friendly").
- SUGGEST best practices proactively: "For tech tutorials, 8–12 minutes tends to rank best. Want me to target that length?"
- EXPLAIN why you need clarification: "I need to know the channel so I can pick the right voice style for your brand."
- After a project is created, AUTOMATICALLY offer to start the full pipeline: "Great, the project is set up. Want me to start the full AI production now — research, script, voice, music and video?"
- If the user says yes to running the pipeline right after create_project, emit run_production immediately in the NEXT turn.

Rules:
- Command JSON shape: {"action":"<command_name>", ...args flat in the same object}. Example: {"action":"render_clip","shortClipId":"abc123"} — NOT {"name":...,"parameters":{...}} and NOT {"type":...}.
- ALWAYS reply in the language the user is speaking/writing (Hindi in → Hindi out, Assamese in → Assamese out, etc.), and set "language" to its BCP-47 tag (e.g. "hi-IN", "as-IN", "en-US"). The platform speaks your reply aloud in that language.
- Emit AT MOST ONE command per turn, chosen from the schema. If no action is needed, set command to null and just answer.
- If the request is ambiguous (which project? which video? which approval?), set command to null and ask ONE clarifying question — never guess ids.
- Use ids from the CONTEXT block only. Never invent ids.
- Confirmation-gated actions (production runs, video analysis, renders, approving content, changing the voiceover language) will require the user's yes — still emit the command; the platform handles the confirmation step.
- reply is what the user reads/hears: say what you understood and what will happen, in one or two sentences. Plain language, no JSON.
- For multi-step workflows (e.g. "analyze video and create shorts", "run full pipeline") include a "plan" object with a "goal" string and an ordered "steps" array. Each step: {"label":"...", "agentName":"...(optional)", "status":"pending"}. Example: plan:{"goal":"Create YouTube Shorts","steps":[{"label":"Analyze video for viral moments","agentName":"VideoAnalysisAgent","status":"pending"},{"label":"Generate clip candidates","agentName":"ClipsAgent","status":"pending"},{"label":"Render vertical video","agentName":"RenderAgent","status":"pending"}]}
- Include "navigate" with the best app route when your response involves a specific page. Route map: /shorts-studio, /projects, /publishing, /analytics, /library, /research, /settings, /approvals. Omit for pure conversational replies.
- JSON response format: {"reply":"...","language":"...","command":{...}|null,"plan":{...}|undefined,"navigate":"..."|undefined}

Command palette:
- list_projects — show the user's projects
- get_status {projectId} — job/pipeline status for a project
- run_production {projectId, scope, topic?} — run the long-form pipeline (scope: FULL|SCRIPT|VOICE|MUSIC|IMAGES|VIDEO)
- retry_stage {projectId, stage} — re-run one pipeline stage (stage is a JobType like RESEARCH, RENDER, MUSIC_GENERATE)
- cancel_job {jobId}
- create_project {channelId, title, niche?, topic?} — create a new content project; gather title and channel first (pick channelId from CONTEXT.channels), niche/topic optionally; after creating, offer to immediately run the full AI pipeline
- analyze_video {importedVideoId} — run the Shorts analysis pipeline
- list_highlights {importedVideoId, limit} — top Shorts moments for an analyzed video
- list_chapters {importedVideoId} — YouTube-style chapters detected for an analyzed video
- search_video {importedVideoId, query} — find moments by meaning ("find John 3:16", "where do they talk about grace") and get their timestamps
- search_library {query} — search ALL the user's analyzed videos at once ("which sermons mention grace?")
- generate_small_videos {importedVideoId} — create one horizontal 1–10 min video candidate per detected chapter (render each afterwards with render_clip)
- generate_church_pack {importedVideoId} — bible references, discussion questions, and a devotional for every chapter (requires the user's confirmation)
- sync_chapters_to_youtube {importedVideoId} — publish the chapter timestamps into the video's YouTube description (edits the live video; requires the user's confirmation)
- generate_social_content {importedVideoId} — quote cards, a carousel, a blog post, and a newsletter from the video's analysis (requires the user's confirmation)
- video_cost {importedVideoId} — how much AI spend this video's analysis and content have used
- generate_clips {highlightId, clipTypes} — create candidate Shorts clips (clipTypes values: YOUTUBE_SHORTS, INSTAGRAM_REELS, TIKTOK, LINKEDIN_CLIPS, FACEBOOK_REELS, PODCAST_HIGHLIGHTS)
- render_clip {shortClipId} — render a clip to vertical video
- generate_captions {shortClipId}
- clip_status {shortClipId}
- list_approvals — pending human reviews
- approve_content {approvalId, notes?} — approve a pending review (this IS the human publish gate; requires the user's confirmation)
- reject_content {approvalId, notes?} — reject a pending review
- set_voice_language {projectId, language, applyToVoiceover} — make the project's scripts AND narration voiceover use the user's speaking language (asking permission first is mandatory; the confirmation step is that permission)

Respond only with valid JSON.`;

/** ms → "m:ss" / "h:mm:ss" for spoken/read timestamp lists. */
function stamp(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

export interface CopilotResponse {
  reply: string;
  /** BCP-47 tag of the user's language — the client speaks the reply in it. */
  language?: string;
  executed?: { action: string; result: unknown };
  needsConfirmation?: CopilotCommand;
  /**
   * Credit quote shown WITH the confirmation gate (docs4/49 transparent-AI:
   * a paid action is accepted against a visible estimate). Resolved from the
   * pricing rules; null when no rule prices this action (cost varies by usage).
   */
  estimatedCredits?: number | null;
  /** True when the intent was resolved from the phrase cache — zero tokens (§12). */
  fromCache?: boolean;
  /** LLM tokens this turn actually consumed (0 on cache hits). */
  tokensUsed?: number;
  /** Multi-step task plan shown to the user (emitted by the LLM when multi-agent work is needed). */
  plan?: CopilotPlan;
  /** App route to navigate to — frontend calls router.push() when present. */
  navigate?: string;
}

type ActionSource = 'UI' | 'COPILOT' | 'VOICE';

interface RecordMeta {
  source: ActionSource;
  fromCache: boolean;
  tokensUsed: number;
  lastUserText: string;
}

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly approvals: ApprovalsService,
    private readonly shorts: ShortsStudioService,
    private readonly recommendations: ClipRecommendationService,
    private readonly generation: ShortsGenerationService,
    private readonly semanticSearch: SemanticSearchService,
    private readonly smallVideos: SmallVideoGenerationService,
    private readonly chapterSync: ChapterSyncService,
    private readonly intentCache: IntentCacheService,
    private readonly walletService: WalletService,
    private readonly pricingService: PricingService,
    private readonly orgs: OrgsService,
  ) {}

  // §8.2 safety: simple per-user rate limit (20 copilot turns/minute)
  private readonly turnLog = new Map<string, number[]>();

  private assertRateLimit(userId: string) {
    const now = Date.now();
    const turns = (this.turnLog.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (turns.length >= 20) throw new BadRequestException('Copilot rate limit reached — try again in a minute.');
    turns.push(now);
    this.turnLog.set(userId, turns);
  }

  async chat(userId: string, req: CopilotChatRequest): Promise<CopilotResponse> {
    this.assertRateLimit(userId);
    const source: ActionSource = req.inputMode === 'voice' ? 'VOICE' : 'COPILOT';
    const lastUserText = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    // Confirmation round-trip: the client re-sends the exact command the user
    // approved — no second LLM call, no reinterpretation.
    if (req.confirmedCommand) {
      const result = await this.executeRecorded(userId, req.confirmedCommand, {
        source, fromCache: false, tokensUsed: 0, lastUserText,
      });
      return {
        reply: result.summary,
        executed: { action: req.confirmedCommand.action, result: result.data },
      };
    }

    // Token Governor (§12): repeated phrases resolve to intents with zero
    // tokens. Confirmation turns always run live — the gate is never cached.
    let decision: CopilotDecision | null = null;
    let fromCache = false;
    let tokensUsed = 0;
    if (!req.pendingCommand) {
      decision = await this.intentCache.get(lastUserText);
      fromCache = decision !== null;
    }

    if (!decision) {
      const context = await this.buildContext(userId);
      const pendingNote = req.pendingCommand
        ? `\n\nPENDING CONFIRMATION: this command awaits the user's yes/no: ${JSON.stringify(req.pendingCommand)}. If their latest message confirms it (yes/haan/ok/go ahead, any language), return EXACTLY that command. If they decline, set command to null and acknowledge.`
        : '';
      // §5.3 reserve→settle around the one LLM call of this turn (cache hits
      // never get here — zero tokens, zero holds).
      const accumulator = newAccumulator();
      let reservationId: string | null = null;
      // Phase 5 §7 price lock: rule price quoted here IS the settle amount
      let lockedPrice: { creditCost: number; ruleId: string } | null = null;
      // Phase 5 §10: when set, the hold sits on the org shared wallet and the
      // team/org budget must be reconciled on settle/release.
      let orgBilling: { orgId: string; teamId: string | null; reserved: number } | null = null;
      if (billingEnforced()) {
        lockedPrice = await this.pricingService.resolvePrice({ action: 'chat' }).catch(() => null);
        const estimate = lockedPrice?.creditCost ?? Math.max(1, Number(process.env['COPILOT_RESERVE_CREDITS']) || 5);
        if (req.orgId) {
          // Org billing: orgSpend gates SPEND role + budget, holds on the org
          // wallet, and records budget consumption for the reserved amount.
          const spend = await this.orgs.orgSpend(userId, req.orgId, {
            amount: estimate,
            action: 'chat',
            memberUserId: userId,
          });
          if (spend.status === 'NEEDS_APPROVAL') {
            // Managers were notified inside orgSpend; the turn cannot proceed
            // until one approves and the user retries.
            throw new BadRequestException('ORG_APPROVAL_REQUIRED');
          }
          reservationId = spend.reservationId;
          orgBilling = { orgId: req.orgId, teamId: spend.teamId, reserved: estimate };
        } else {
          const reservation = await this.walletService.reserve(userId, estimate, `copilot:${randomUUID()}`, 'AI_REQUEST');
          reservationId = reservation.id;
        }
      }
      // Build the message array for the LLM. The context block MUST be merged
      // into the last user message — Anthropic (and most providers) reject
      // consecutive same-role messages, so adding a second 'user' turn after
      // the user's actual query causes a 400 on every first turn.
      const contextSuffix = `\n\n---\nCONTEXT (current platform state — use ids from here only):\n${context}${pendingNote}\n\nRespond with valid JSON only: {"reply":"...","language":"...","command":{...}|null,"plan":{...}|undefined,"navigate":"..."|undefined}`;
      const rawMsgs = req.messages.slice(-8).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const lastUserIdx = rawMsgs.reduce<number>((acc, m, i) => (m.role === 'user' ? i : acc), -1);
      const llmMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
        lastUserIdx >= 0
          ? rawMsgs.map((m, i) => i === lastUserIdx ? { ...m, content: m.content + contextSuffix } : m)
          : [...rawMsgs, { role: 'user', content: `CONTEXT:\n${context}${pendingNote}` }];

      try {
        decision = await runWithAiContext({ userId, accumulator }, () => callAIStructured(
          llmMessages,
          CopilotDecisionSchema,
          {
            systemPrompt: COPILOT_SYSTEM,
            maxTokens: 1024,
            onUsage: (e) => { tokensUsed += e.tokensIn + e.tokensOut; },
          },
        ));
      } catch (err) {
        if (reservationId) {
          await this.walletService.releaseReservation(reservationId).catch(() => undefined);
          // The hold debited nothing — roll the budget consumption back too.
          if (orgBilling) {
            await this.orgs
              .recordConsumption(orgBilling.orgId, orgBilling.teamId ?? undefined, -orgBilling.reserved)
              .catch(() => undefined);
          }
        }
        throw err;
      }
      if (reservationId) {
        const settleCredits = lockedPrice ? lockedPrice.creditCost : creditsForCost(accumulator.costUsd);
        await this.walletService.settleReservation(reservationId, settleCredits, {
          source: 'copilot',
          ...(lockedPrice ? { priceLocked: true, pricingRuleId: lockedPrice.ruleId } : {}),
          ...(orgBilling ? { orgId: orgBilling.orgId, memberUserId: userId } : {}),
        }).catch((e) => this.logger.warn(`copilot settle failed: ${e instanceof Error ? e.message : String(e)}`));
        // Budget consumption was recorded for the reserved estimate — adjust
        // to what actually settled so the period reflects real spend.
        if (orgBilling && settleCredits !== orgBilling.reserved) {
          await this.orgs
            .recordConsumption(orgBilling.orgId, orgBilling.teamId ?? undefined, settleCredits - orgBilling.reserved)
            .catch(() => undefined);
        }
      }
      if (!req.pendingCommand) await this.intentCache.maybeStore(lastUserText, decision);
    }

    if (!decision.command) {
      await this.record(userId, 'chat.reply', null, 'EXECUTED', { source, fromCache, tokensUsed, lastUserText }, false);
      return {
        reply: decision.reply,
        language: decision.language,
        fromCache,
        tokensUsed,
        ...(decision.plan ? { plan: decision.plan } : {}),
        ...(decision.navigate ? { navigate: decision.navigate } : {}),
      };
    }

    // A spoken/typed "yes" to the pending command IS the confirmation —
    // execute directly instead of gating again.
    const confirmsPending =
      req.pendingCommand && JSON.stringify(decision.command) === JSON.stringify(req.pendingCommand);

    // Expensive/destructive commands stop at the confirmation gate (§8.2) —
    // cache hits included: only the LLM interpretation is reused, never the gate.
    if (!confirmsPending && EXPENSIVE_ACTIONS.includes(decision.command.action)) {
      await this.record(userId, decision.command.action, decision.command, 'NEEDS_CONFIRMATION', { source, fromCache, tokensUsed, lastUserText }, false);
      // Quote the action so the confirmation is an acceptance of a visible
      // estimate (transparent-AI invariant); null → no rule, cost varies.
      const quote = await this.pricingService
        .resolvePrice({ action: decision.command.action })
        .catch(() => null);
      return {
        reply: decision.reply,
        language: decision.language,
        needsConfirmation: decision.command,
        estimatedCredits: quote?.creditCost ?? null,
        fromCache,
        tokensUsed,
        ...(decision.plan ? { plan: decision.plan } : {}),
        ...(decision.navigate ? { navigate: decision.navigate } : {}),
      };
    }

    const result = await this.executeRecorded(userId, decision.command, { source, fromCache, tokensUsed, lastUserText });
    return {
      reply: `${decision.reply}\n\n${result.summary}`.trim(),
      language: decision.language,
      executed: { action: decision.command.action, result: result.data },
      fromCache,
      tokensUsed,
      ...(decision.plan ? { plan: decision.plan } : {}),
      ...(decision.navigate ? { navigate: decision.navigate } : {}),
    };
  }

  /** Execute a command and land the outcome (success or failure) in the actions audit trail. */
  async executeRecorded(
    userId: string,
    command: CopilotCommand,
    meta: RecordMeta,
  ): Promise<{ summary: string; data: unknown; actionId: string | null }> {
    try {
      const result = await this.execute(userId, command);
      const actionId = await this.record(userId, command.action, command, 'EXECUTED', meta, true);
      return { ...result, actionId };
    } catch (err) {
      await this.record(userId, command.action, command, 'FAILED', meta, false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /**
   * Unified action audit (Ai-video edit.md §8/§14): every turn — UI, chat, or
   * voice — lands as an ActionRecord; voice turns also keep their transcript;
   * session memory stores compressed intent history, never raw conversation.
   * Recording failures are logged, never surfaced — audit must not break chat.
   */
  private async record(
    userId: string,
    intentType: string,
    payload: CopilotCommand | null,
    status: 'EXECUTED' | 'NEEDS_CONFIRMATION' | 'FAILED',
    meta: RecordMeta,
    executed: boolean,
    error?: string,
  ): Promise<string | null> {
    try {
      const projectId =
        payload && 'projectId' in payload && typeof payload.projectId === 'string' ? payload.projectId : null;
      const action = await this.prisma.actionRecord.create({
        data: {
          userId,
          projectId,
          source: meta.source,
          intentType,
          intentPayload: (payload ?? {}) as never,
          status,
          fromCache: meta.fromCache,
          tokensUsed: meta.tokensUsed,
          error,
        },
      });
      if (meta.source === 'VOICE' && meta.lastUserText) {
        await this.prisma.voiceCommand.create({
          data: {
            userId,
            projectId,
            rawTranscript: meta.lastUserText,
            resolvedIntent: (payload ?? undefined) as never,
            executed,
          },
        });
      }
      const existing = await this.prisma.copilotSessionMemory.findUnique({ where: { userId } });
      const lastIntentIds = [...(existing?.lastIntentIds ?? []), action.id].slice(-20);
      const summary = [...(existing?.summary ? [existing.summary] : []), intentType].join(' → ').split(' → ').slice(-8).join(' → ');
      await this.prisma.copilotSessionMemory.upsert({
        where: { userId },
        create: { userId, summary, lastIntentIds },
        update: { summary, lastIntentIds },
      });
      return action.id;
    } catch (err) {
      this.logger.warn(`action audit write failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Compact project-state JSON (§3.6 token rules): ids the model may use. */
  private async buildContext(userId: string): Promise<string> {
    const [projects, videos, recentJobs, channels] = await Promise.all([
      this.prisma.project.findMany({
        where: { userId },
        select: { id: true, title: true, status: true },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      }),
      this.prisma.importedVideo.findMany({
        where: { project: { userId } },
        select: { id: true, title: true, _count: { select: { topicSegments: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.agentJob.findMany({
        where: { project: { userId } },
        select: { id: true, type: true, status: true, projectId: true },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.channel.findMany({
        where: { userId },
        select: { id: true, title: true },
        take: 8,
      }),
    ]);
    return JSON.stringify({
      projects,
      importedVideos: videos.map((v) => ({ id: v.id, title: v.title.slice(0, 60), topics: v._count.topicSegments })),
      recentJobs,
      channels,
    });
  }

  /** Every branch re-validates ownership through the same services the REST API uses. */
  async execute(userId: string, command: CopilotCommand): Promise<{ summary: string; data: unknown }> {
    this.logger.log(`[copilot] ${userId} → ${command.action}`);
    await this.audit(userId, command);

    switch (command.action) {
      case 'list_projects': {
        const projects = await this.prisma.project.findMany({
          where: { userId },
          select: { id: true, title: true, status: true, channel: { select: { title: true } }, _count: { select: { jobs: true } } },
          orderBy: { updatedAt: 'desc' },
        });
        const lines = projects.map((p) => `• ${p.title} (${p.status.toLowerCase()}, ${p._count.jobs} jobs, channel ${p.channel.title})`);
        return { summary: projects.length ? `Your projects:\n${lines.join('\n')}` : 'You have no projects yet.', data: projects };
      }

      case 'get_status': {
        await this.assertProject(command.projectId, userId);
        const jobs = await this.prisma.agentJob.findMany({
          where: { projectId: command.projectId },
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: { type: true, status: true, error: true, createdAt: true },
        });
        const running = jobs.filter((j) => ['PENDING', 'QUEUED', 'RUNNING'].includes(j.status));
        const lines = jobs.map((j) => `• ${j.type}: ${j.status.toLowerCase()}${j.error ? ` — ${j.error.slice(0, 80)}` : ''}`);
        return {
          summary: `${running.length ? `${running.length} job(s) currently active.` : 'Nothing running right now.'}\nRecent jobs:\n${lines.join('\n')}`,
          data: jobs,
        };
      }

      case 'run_production': {
        await this.assertProject(command.projectId, userId);
        const job = await this.jobs.enqueue(command.projectId, 'FULL_PRODUCTION', {
          scope: command.scope,
          ...(command.topic ? { topic: command.topic } : {}),
        });
        return { summary: `Production pipeline started (scope ${command.scope}). Track it on the project page.`, data: { jobId: job.id } };
      }

      case 'retry_stage': {
        await this.assertProject(command.projectId, userId);
        const stage = JobTypeSchema.options.find((t) => t === command.stage.toUpperCase());
        if (!stage) throw new BadRequestException(`Unknown stage "${command.stage}"`);
        const job = await this.jobs.enqueue(command.projectId, stage as JobType, {});
        return { summary: `Re-running ${stage}.`, data: { jobId: job.id } };
      }

      case 'cancel_job': {
        const job = await this.prisma.agentJob.findFirst({
          where: { id: command.jobId, project: { userId } },
        });
        if (!job) throw new NotFoundException('Job not found');
        await this.jobs.cancel(command.jobId);
        return { summary: `Cancelled ${job.type}.`, data: { jobId: command.jobId } };
      }

      case 'create_project': {
        const channel = await this.prisma.channel.findFirst({
          where: { id: command.channelId, userId },
          select: { id: true, title: true },
        });
        if (!channel) throw new NotFoundException('Channel not found — use a channelId from CONTEXT.channels.');
        const project = await this.prisma.project.create({
          data: {
            userId,
            channelId: command.channelId,
            title: command.title,
            status: 'ACTIVE',
            ...(command.niche ? { niche: command.niche } : {}),
            ...(command.topic ? { description: command.topic } : {}),
          },
          select: { id: true, title: true },
        });
        return {
          summary: `Created project "${project.title}" on channel "${channel.title}". Ready to start the full AI pipeline whenever you say so.`,
          data: { projectId: project.id, title: project.title, channelTitle: channel.title },
        };
      }

      case 'analyze_video': {
        const job = await this.shorts.enqueueAnalysis(command.importedVideoId, userId);
        return { summary: 'Shorts analysis pipeline started — import, transcript, scenes, topics, highlights.', data: { jobId: job.id } };
      }

      case 'list_highlights': {
        await this.shorts.assertVideoOwnership(command.importedVideoId, userId);
        const recs = await this.recommendations.recommend(command.importedVideoId, command.limit);
        const lines = recs.map((r, i) =>
          `${i + 1}. [${Math.round(r.finalScore)}] ${r.titleSuggestion} (${Math.round(r.durationMs / 1000)}s, highlightId ${r.highlightId})`);
        return { summary: lines.length ? `Top highlights:\n${lines.join('\n')}` : 'No highlights yet — run the analysis first.', data: recs };
      }

      case 'list_chapters': {
        // Deterministic-first (§12): stored analysis data, zero LLM tokens
        await this.shorts.assertVideoOwnership(command.importedVideoId, userId);
        const chapters = await this.prisma.chapter.findMany({
          where: { importedVideoId: command.importedVideoId },
          orderBy: { startMs: 'asc' },
          select: { id: true, startMs: true, endMs: true, title: true, summary: true },
        });
        const lines = chapters.map((c, i) => `${i + 1}. [${stamp(c.startMs)}] ${c.title}`);
        return {
          summary: lines.length ? `Chapters:\n${lines.join('\n')}` : 'No chapters yet — run the analysis (or chapter detection) first.',
          data: chapters,
        };
      }

      case 'search_video': {
        await this.shorts.assertVideoOwnership(command.importedVideoId, userId);
        const found = await this.semanticSearch.search(command.importedVideoId, command.query, 5, userId);
        if (found.needsEmbeddings) {
          return {
            summary: 'This video has no embeddings yet — run embedding generation (or re-run the analysis) and I can search it.',
            data: found,
          };
        }
        const lines = found.results.map((r, i) =>
          `${i + 1}. [${stamp(r.startMs)}] ${r.text.slice(0, 100)}${r.chapter ? ` (chapter: ${r.chapter})` : ''}`);
        return {
          summary: lines.length ? `Closest moments for "${command.query}":\n${lines.join('\n')}` : `Nothing close to "${command.query}" in this video.`,
          data: found,
        };
      }

      case 'search_library': {
        const found = await this.semanticSearch.searchLibrary(userId, command.query);
        if (found.embeddedSegments === 0) {
          return { summary: 'None of your videos have embeddings yet — run embedding generation on an analyzed video first.', data: found };
        }
        const lines = found.videos.map((v, i) =>
          `${i + 1}. ${v.title.slice(0, 60)} — best at [${stamp(v.matches[0]?.startMs ?? 0)}]: ${v.matches[0]?.text.slice(0, 80) ?? ''}`);
        return {
          summary: lines.length
            ? `Videos matching "${command.query}":\n${lines.join('\n')}`
            : `Nothing in your library comes close to "${command.query}".`,
          data: found,
        };
      }

      case 'generate_small_videos': {
        await this.shorts.assertVideoOwnership(command.importedVideoId, userId);
        const result = await this.smallVideos.generateFromChapters(command.importedVideoId);
        return {
          summary: `Small videos ready: ${result.created} new, ${result.reused} already existed${result.skippedTooShort ? `, ${result.skippedTooShort} chapter(s) under a minute skipped` : ''}. Say "render" on any of them when you want the files.`,
          data: {
            created: result.created,
            reused: result.reused,
            skippedTooShort: result.skippedTooShort,
            clips: result.clips.map((c) => ({ id: c.id, sourceStartMs: c.sourceStartMs, sourceEndMs: c.sourceEndMs })),
          },
        };
      }

      case 'generate_church_pack': {
        const video = await this.shorts.assertVideoOwnership(command.importedVideoId, userId);
        const job = await this.jobs.enqueue(video.projectId, 'CHURCH_PACK_GENERATION', {
          importedVideoId: command.importedVideoId,
        });
        return {
          summary: 'Generating the church pack — bible references, discussion questions, and a devotional for every chapter. Check the Chapters tab in a moment.',
          data: { jobId: job.id },
        };
      }

      case 'sync_chapters_to_youtube': {
        await this.shorts.assertVideoOwnership(command.importedVideoId, userId);
        const synced = await this.chapterSync.syncToYouTube(command.importedVideoId);
        return {
          summary: `Done — ${synced.chapters} chapter timestamps are now in the YouTube description. They'll show on the player shortly.`,
          data: synced,
        };
      }

      case 'generate_social_content': {
        const video = await this.shorts.assertVideoOwnership(command.importedVideoId, userId);
        const job = await this.jobs.enqueue(video.projectId, 'SOCIAL_CONTENT_GENERATION', {
          importedVideoId: command.importedVideoId,
        });
        return {
          summary: 'Creating your social pack — quote cards, a carousel, a blog post, and a newsletter. Check the Social tab in a moment.',
          data: { jobId: job.id },
        };
      }

      case 'video_cost': {
        // Deterministic-first (§12): ledger aggregate, zero LLM tokens
        await this.shorts.assertVideoOwnership(command.importedVideoId, userId);
        const agg = await this.prisma.tokenUsage.aggregate({
          where: { importedVideoId: command.importedVideoId },
          _sum: { tokensIn: true, tokensOut: true, costUsd: true },
          _count: true,
        });
        const cost = agg._sum.costUsd ?? 0;
        return {
          summary: agg._count > 0
            ? `This video has used about $${cost.toFixed(3)} of AI across ${agg._count} calls (${(agg._sum.tokensIn ?? 0).toLocaleString()} tokens in, ${(agg._sum.tokensOut ?? 0).toLocaleString()} out).`
            : 'No attributed AI spend for this video yet — cost tracking starts with its next analysis or generation run.',
          data: { calls: agg._count, tokensIn: agg._sum.tokensIn ?? 0, tokensOut: agg._sum.tokensOut ?? 0, costUsd: Number(cost.toFixed(4)) },
        };
      }

      case 'generate_clips': {
        await this.shorts.assertHighlightOwnership(command.highlightId, userId);
        const clips = await this.generation.generateClips(command.highlightId, command.clipTypes);
        return {
          summary: `Created ${clips.length} candidate clip(s): ${clips.map((c) => `${c.clipType} (${c.id})`).join(', ')}.`,
          data: clips.map((c) => ({ id: c.id, clipType: c.clipType, status: c.status })),
        };
      }

      case 'render_clip': {
        const clip = await this.shorts.assertClipOwnership(command.shortClipId, userId);
        const job = await this.jobs.enqueue(clip.projectId, 'SHORTS_RENDER', { shortClipId: command.shortClipId });
        return { summary: 'Render started — vertical video with captions burned in.', data: { jobId: job.id } };
      }

      case 'generate_captions': {
        const clip = await this.shorts.assertClipOwnership(command.shortClipId, userId);
        const job = await this.jobs.enqueue(clip.projectId, 'CAPTION_GENERATION', { shortClipId: command.shortClipId });
        return { summary: 'Caption generation started.', data: { jobId: job.id } };
      }

      case 'clip_status': {
        await this.shorts.assertClipOwnership(command.shortClipId, userId);
        const status = await this.shorts.renderStatus(command.shortClipId);
        return {
          summary: `Clip status: ${status.clipStatus?.toLowerCase().replace(/_/g, ' ')}${status.render ? ` — rendered, ${(status.render.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}.`,
          data: status,
        };
      }

      case 'list_approvals': {
        const { data: pending } = await this.approvals.listPending(userId);
        const lines = pending.map((a) => {
          const result = a.job.result as { metadata?: { title?: string } } | null;
          const title = result?.metadata?.title ?? a.job.type.replace(/_/g, ' ').toLowerCase();
          return `• ${title} (${a.project.title}, approvalId ${a.id})`;
        });
        return {
          summary: pending.length ? `Pending reviews:\n${lines.join('\n')}` : 'No pending approvals — all caught up.',
          data: pending.map((a) => ({ id: a.id, type: a.job.type, project: a.project.title })),
        };
      }

      case 'approve_content': {
        // The spoken/typed confirmation that routed us here IS the human
        // review (§8.2 confirmation policy) — recorded in the approval notes.
        await this.approvals.approve(command.approvalId, userId, command.notes ?? 'Approved via Copilot (voice/chat confirmation)');
        return { summary: 'Approved. If this was a Short awaiting publish, the upload starts now.', data: { approvalId: command.approvalId } };
      }

      case 'reject_content': {
        await this.approvals.reject(command.approvalId, userId, command.notes ?? 'Rejected via Copilot');
        return { summary: 'Rejected — nothing will be published.', data: { approvalId: command.approvalId } };
      }

      case 'set_voice_language': {
        const project = await this.assertProject(command.projectId, userId);
        // Content + narration language both follow Project.targetLang (the
        // VOICE_GENERATE stage passes it into every TTS request); the granted
        // permission is recorded on the channel's voiceProfile.
        const lang = command.language.split('-')[0]!.toLowerCase();
        await this.prisma.project.update({
          where: { id: project.id },
          data: { targetLang: lang },
        });
        const channel = await this.prisma.channel.findUnique({ where: { id: project.channelId }, select: { voiceProfile: true } });
        await this.prisma.channel.update({
          where: { id: project.channelId },
          data: {
            voiceProfile: {
              ...((channel?.voiceProfile as object | null) ?? {}),
              copilotLanguage: command.language,
              useForVoiceover: command.applyToVoiceover,
              permissionGrantedAt: new Date().toISOString(),
            } as never,
          },
        });
        return {
          summary: command.applyToVoiceover
            ? `Done — scripts and voiceover narration for "${project.title}" will use ${command.language}. Your permission is recorded on the channel's voice profile.`
            : `Done — scripts for "${project.title}" will use ${command.language}; voiceover unchanged.`,
          data: { projectId: project.id, targetLang: lang, applyToVoiceover: command.applyToVoiceover },
        };
      }
    }
  }

  /** Recent background jobs triggered by this user — surfaced in the copilot task queue panel. */
  async listRecentJobs(userId: string, take = 10) {
    const jobs = await this.prisma.agentJob.findMany({
      where: { project: { userId } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 50),
      select: {
        id: true, type: true, status: true, error: true, errorCode: true,
        createdAt: true, startedAt: true, completedAt: true,
        project: { select: { id: true, title: true } },
      },
    });
    return { data: jobs };
  }

  private async assertProject(projectId: string, userId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, userId } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  /** §8.2 safety: every executed command lands in the audit log. */
  private async audit(userId: string, command: CopilotCommand) {
    await this.prisma.auditLog.create({
      data: { userId, action: `copilot:${command.action}`, meta: command as never },
    }).catch(() => undefined);
  }
}
