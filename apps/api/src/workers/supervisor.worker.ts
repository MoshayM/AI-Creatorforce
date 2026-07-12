import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { ContentService } from '../modules/content/content.service';
import { ComplianceService } from '../modules/compliance/compliance.service';
import { MetadataService } from '../modules/metadata/metadata.service';
import { PublishingService } from '../modules/publishing/publishing.service';
import { TrendService } from '../modules/trend/trend.service';
import { SeoService } from '../modules/seo/seo.service';
import { AudienceService } from '../modules/audience/audience.service';
import { ApprovalsService } from '../modules/approvals/approvals.service';
import { JobsService } from '../modules/jobs/jobs.service';
import { VoiceService } from '../modules/voice/voice.service';
import { MusicService } from '../modules/music/music.service';
import { ImageService } from '../modules/image/image.service';
import { AnalyticsService } from '../modules/analytics/analytics.service';
import { GrowthService } from '../modules/growth/growth.service';
import { AssetsService } from '../modules/assets/assets.service';
import { MediaService } from '../modules/media/media.service';
import { StorageService } from '../modules/media/storage.service';
import { ExportsService } from '../modules/media/exports.service';
import { VideoImportService } from '../modules/shorts-studio/video-import.service';
import { TranscriptService } from '../modules/shorts-studio/transcript.service';
import { SceneDetectionService } from '../modules/shorts-studio/scene-detection.service';
import { TopicSegmentationService } from '../modules/shorts-studio/topic-segmentation.service';
import { HighlightScoringService } from '../modules/shorts-studio/highlight-scoring.service';
import { ChapterDetectionService } from '../modules/shorts-studio/chapter-detection.service';
import { EmbeddingGenerationService } from '../modules/shorts-studio/embedding-generation.service';
import { ChurchPackService } from '../modules/shorts-studio/church-pack.service';
import { SocialContentService } from '../modules/shorts-studio/social-content.service';
import { CaptionGenerationService } from '../modules/shorts-studio/caption-generation.service';
import { ShortsRenderService } from '../modules/shorts-studio/shorts-render.service';
import { ShortsExportService } from '../modules/shorts-studio/shorts-export.service';
import { SHORTS_IMPORT_STAGES } from '../modules/shorts-studio/shorts-studio.service';
import { composeVideo, ffmpegPath, runFfmpegCapture, type ComposeScene } from '../modules/media/adapters/ffmpeg.util';
import { encodeWhooshWav } from '../modules/media/adapters/codec.util';
import { checkDurations, analyzeLoudness } from '../modules/media/quality.util';
import { validateMediaFile, formatIssues } from '../modules/media/media-validation.util';
import { buildSrt, buildVtt, fitCuesToDuration } from '../modules/media/subtitle.util';
import { planPipeline, partitionResume, batchStages, estimateRemainingSecs, type PipelineScope, type PipelineStage } from './pipeline-plan';
import { newAccumulator, runWithAiContext } from '../common/ai-usage.context';
import { runWithCorrelationId } from '../common/correlation.context';
import { WalletService, billingEnforced, creditsForCost } from '../modules/wallet/wallet.service';
import { PricingService } from '../modules/ai-ops/pricing.service';
import { OrgsService } from '../modules/orgs/orgs.service';
import { TrialLimitsService } from '../modules/trial/trial-limits.service';
import { EventsGateway } from '../gateway/events.gateway';
import { AGENT_QUEUE } from '../modules/jobs/jobs.module';
import { callAIStructured } from '@cf/shared';
import { VideoScenePlanOutputSchema, SubtitleOutputSchema, EditPlanOutputSchema } from '@cf/shared';
import type {
  JobType, ResearchOutput, ScriptOutput, AnalyticsOutput,
  VoiceSpecOutput, ImageBriefOutput, MusicBriefOutput, VideoScenePlanOutput, SubtitleOutput,
} from '@cf/shared';
import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomUUID } from 'crypto';
import { ChannelSyncService } from '../modules/channels/channel-sync.service';
import { MetricsService } from '../modules/metrics/metrics.service';

interface JobPayload {
  jobId: string;
  projectId: string;
  type: JobType;
  payload: Record<string, unknown>;
  /** Correlation ID adopted from the enqueuing request; minted here if absent. */
  correlationId?: string;
  /** Wave 12: present when the job was enqueued through the developer API. */
  developerKeyId?: string;
}

@Injectable()
// Concurrency 2 matches AI_CONCURRENCY so one slow agent doesn't serialize the
// whole queue; the shared AI semaphore still caps actual provider calls.
@Processor(AGENT_QUEUE, { concurrency: 2 })
export class SupervisorWorker extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly compliance: ComplianceService,
    private readonly metadata: MetadataService,
    private readonly publishing: PublishingService,
    private readonly trend: TrendService,
    private readonly seo: SeoService,
    private readonly audience: AudienceService,
    private readonly approvals: ApprovalsService,
    private readonly jobs: JobsService,
    private readonly voice: VoiceService,
    private readonly music: MusicService,
    private readonly image: ImageService,
    private readonly analytics: AnalyticsService,
    private readonly growth: GrowthService,
    private readonly assets: AssetsService,
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly exportsSvc: ExportsService,
    private readonly videoImport: VideoImportService,
    private readonly transcript: TranscriptService,
    private readonly sceneDetection: SceneDetectionService,
    private readonly topicSegmentation: TopicSegmentationService,
    private readonly highlightScoring: HighlightScoringService,
    private readonly chapterDetection: ChapterDetectionService,
    private readonly embeddingGeneration: EmbeddingGenerationService,
    private readonly churchPack: ChurchPackService,
    private readonly socialContent: SocialContentService,
    private readonly captionGeneration: CaptionGenerationService,
    private readonly shortsRender: ShortsRenderService,
    private readonly shortsExport: ShortsExportService,
    private readonly walletService: WalletService,
    private readonly pricingService: PricingService,
    private readonly orgs: OrgsService,
    private readonly trialLimits: TrialLimitsService,
    private readonly events: EventsGateway,
    private readonly channelSync: ChannelSyncService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<JobPayload>): Promise<unknown> {
    // Adopt the enqueuing request's correlation ID so worker-side logs and
    // Sentry events trace back to the originating request; retries reuse it.
    return runWithCorrelationId(job.data.correlationId ?? randomUUID(), () => this.processJob(job));
  }

  private async processJob(job: Job<JobPayload>): Promise<unknown> {
    const { jobId, projectId, type, payload } = job.data;
    const t0 = Date.now();

    await this.prisma.agentJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
    this.events.emitJobUpdate(jobId, { status: 'RUNNING', type }, projectId);

    // §5.3 reserve→settle: hold credits before AI runs (opt-in via
    // BILLING_ENFORCE_CREDITS). Insufficient credits fail the job here,
    // before any provider spend.
    const accumulator = newAccumulator();
    let reservationId: string | null = null;
    let holdUserId: string | null = null;
    // Phase 5 §10: when the project bills an org, the hold sits on the org
    // shared wallet and budget consumption must be reconciled on settle/release.
    let orgBilling: { orgId: string; teamId: string | null; reserved: number } | null = null;
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true, billingOrgId: true } });

    // Phase 6 §7: trial feature gate — server-side, before any spend.
    // Non-trial users pass through untouched.
    if (project) {
      try {
        await this.trialLimits.assertAllowed(project.userId, 'daily_ai_requests');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.prisma.agentJob.update({
          where: { id: jobId },
          data: { status: 'FAILED', error: msg, completedAt: new Date() },
        });
        this.events.emitJobFailed(jobId, msg, projectId);
        throw err;
      }
    }

    // Phase 5 §7: a matching pricing rule QUOTES the price here and LOCKS it —
    // the settle uses this exact amount, never a mid-flight recalculation.
    let lockedPrice: { creditCost: number; ruleId: string } | null = null;
    if (billingEnforced()) {
      if (project) {
        holdUserId = project.userId;
        lockedPrice = await this.pricingService.resolvePrice({ action: type }).catch(() => null);
        const estimate = lockedPrice?.creditCost ?? Math.max(1, Number(process.env['JOB_RESERVE_CREDITS']) || 50);
        try {
          if (project.billingOrgId) {
            // Org billing: orgSpend gates SPEND role + team/org budget and
            // holds on the org shared wallet (same pattern as copilot turns).
            const spend = await this.orgs.orgSpend(holdUserId, project.billingOrgId, {
              amount: estimate,
              action: type,
              memberUserId: holdUserId,
            });
            if (spend.status === 'NEEDS_APPROVAL') {
              // Managers were notified inside orgSpend; the job cannot run
              // until one approves and the user re-enqueues it.
              throw new Error('ORG_APPROVAL_REQUIRED: spend exceeds your approval threshold — a manager has been notified');
            }
            reservationId = spend.reservationId;
            orgBilling = { orgId: project.billingOrgId, teamId: spend.teamId, reserved: estimate };
          } else {
            const reservation = await this.walletService.reserve(holdUserId, estimate, `job:${jobId}`, 'AI_REQUEST', jobId);
            reservationId = reservation.id;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await this.prisma.agentJob.update({
            where: { id: jobId },
            data: { status: 'FAILED', error: msg, completedAt: new Date() },
          });
          this.events.emitJobFailed(jobId, msg, projectId);
          throw err;
        }
      }
    }

    try {
      // §12.2.8 cost attribution: every provider call inside this dispatch —
      // including SHORTS_ANALYZE child stages — inherits this context.
      const result = await runWithAiContext(
        { jobId, projectId, importedVideoId: payload['importedVideoId'] as string | undefined, userId: holdUserId ?? undefined, developerKeyId: job.data.developerKeyId, accumulator },
        () => this.dispatch(type, projectId, jobId, payload),
      );
      // Settle: locked rule price when one was quoted (§7), else real cost (§5.3)
      if (reservationId) {
        const settleCredits = lockedPrice ? lockedPrice.creditCost : creditsForCost(accumulator.costUsd);
        await this.walletService.settleReservation(reservationId, settleCredits, {
          jobId, jobType: type, costUsd: accumulator.costUsd, calls: accumulator.calls,
          ...(lockedPrice ? { priceLocked: true, pricingRuleId: lockedPrice.ruleId } : {}),
          ...(orgBilling ? { orgId: orgBilling.orgId, memberUserId: holdUserId } : {}),
        }).catch((e) => console.warn(`[credits] settle failed for job ${jobId}: ${e instanceof Error ? e.message : String(e)}`));
        // Budget consumption was recorded for the reserved estimate — adjust
        // to what actually settled so the period reflects real spend.
        if (orgBilling && settleCredits !== orgBilling.reserved) {
          await this.orgs
            .recordConsumption(orgBilling.orgId, orgBilling.teamId ?? undefined, settleCredits - orgBilling.reserved)
            .catch(() => undefined);
        }
      }
      const elapsed = Date.now() - t0;
      // METADATA sets job to WAITING_APPROVAL mid-dispatch — don't overwrite that status,
      // but always persist the result so downstream can read it.
      const currentJob = await this.prisma.agentJob.findUnique({ where: { id: jobId }, select: { status: true } });
      if (currentJob?.status === 'WAITING_APPROVAL') {
        await this.prisma.agentJob.update({
          where: { id: jobId },
          data: { result: result as never },
        });
      } else {
        // Any other status (RUNNING, or QUEUED if the enqueue write raced us)
        // means nobody else owns this job — the work is done, mark it COMPLETED.
        await this.prisma.agentJob.update({
          where: { id: jobId },
          data: { status: 'COMPLETED', result: result as never, completedAt: new Date() },
        });
        this.events.emitJobComplete(jobId, { result, elapsedMs: elapsed }, projectId);
        this.metrics.recordJob(type, 'completed', elapsed);
      }
      return result;
    } catch (err) {
      // §5.3 step 4: failed run → release the hold, debit nothing
      if (reservationId) {
        await this.walletService.releaseReservation(reservationId).catch(() => undefined);
        // The hold debited nothing — roll the budget consumption back too.
        if (orgBilling) {
          await this.orgs
            .recordConsumption(orgBilling.orgId, orgBilling.teamId ?? undefined, -orgBilling.reserved)
            .catch(() => undefined);
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.agentJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: msg, completedAt: new Date() },
      });
      // A failed render must never leave its Render row QUEUED/RENDERING
      const renderRowId = payload['renderRowId'] as string | undefined;
      if (renderRowId) {
        await this.prisma.render.update({
          where: { id: renderRowId },
          data: { status: 'FAILED', error: { message: msg.slice(0, 500) } as never },
        }).catch(() => undefined);
      }
      this.events.emitJobLog(jobId, projectId, `Agent error: ${msg.slice(0, 120)}`);
      this.events.emitJobFailed(jobId, msg, projectId);
      this.metrics.recordJob(type, 'failed', Date.now() - t0);
      // Do NOT rethrow — state is persisted in PostgreSQL; rethrowing causes BullMQ to
      // re-queue the job (we set attempts:1 but this is the safety valve) and triggers
      // Redis stream errors on old Redis 5.x. Our AI client handles its own retries.
    }
  }

  private async lastResult<T>(projectId: string, type: JobType): Promise<T | null> {
    const job = await this.prisma.agentJob.findFirst({
      where: { projectId, type, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { result: true },
    });
    return (job?.result as T) ?? null;
  }

  private log(jobId: string, projectId: string, message: string, detail?: string) {
    this.events.emitJobLog(jobId, projectId, message, detail);
  }

  private async dispatch(
    type: JobType,
    projectId: string,
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    // CHANNEL_SYNC is channel-scoped — it has no project. Skip the project
    // lookup so findUniqueOrThrow doesn't throw on an empty projectId.
    if (type === 'CHANNEL_SYNC') {
      const channelId = payload['channelId'] as string;
      if (!channelId) throw new Error('CHANNEL_SYNC requires payload.channelId');
      this.log(jobId, projectId, 'Starting channel library sync…', `channelId=${channelId}`);
      await this.channelSync.runSync(channelId, {
        onProgress: (msg) => this.log(jobId, projectId, msg),
      });
      this.log(jobId, projectId, 'Channel sync complete ✓');
      return { channelId, synced: true };
    }

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });

    switch (type) {
      case 'TREND_ANALYSIS': {
        const t0 = Date.now();
        this.log(jobId, projectId, 'Analyzing trending topics…', `Niche: ${project.niche ?? 'General'}`);
        const result = await this.trend.analyze(project.niche ?? 'General', undefined);
        const topTrend = (result as { trending?: Array<{ topic: string; score: number }> }).trending?.[0];
        this.log(jobId, projectId, 'Trend analysis complete', topTrend ? `Top: "${topTrend.topic}" (${topTrend.score})` : undefined);
        await this.jobs.logStep(jobId, 'TrendAgent', 'analyze', { niche: project.niche }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'TREND_ANALYSIS', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'AUDIENCE_ANALYSIS': {
        const t0 = Date.now();
        this.log(jobId, projectId, 'Profiling target audience…', `Niche: ${project.niche ?? 'General'}`);
        const result = await this.audience.analyze(project.niche ?? 'General');
        this.log(jobId, projectId, 'Audience analysis complete');
        await this.jobs.logStep(jobId, 'AudienceAgent', 'analyze', { niche: project.niche }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'AUDIENCE_ANALYSIS', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'RESEARCH': {
        // Target platform shapes the research angle (short-form hooks for
        // TikTok, professional tone for LinkedIn, audio-first for Podcast…)
        const platform = payload['platform'] as string | undefined;
        const baseTopic = payload['topic'] as string ?? project.title;
        const topic = platform && platform !== 'YouTube'
          ? `${baseTopic} — content formatted for ${platform}`
          : baseTopic;
        const t0 = Date.now();
        this.log(jobId, projectId, 'Starting research…', `"${topic.slice(0, 70)}"`);
        const result = await this.content.research(topic, project.niche ?? undefined, project.targetLang);
        const r = result as { sources?: unknown[]; trendScore?: number };
        this.log(jobId, projectId, 'Research complete', `${r.sources?.length ?? 0} sources · trend score ${r.trendScore ?? '?'}`);
        await this.jobs.logStep(jobId, 'ResearchAgent', 'research', { topic }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'RESEARCH', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'SCRIPT': {
        this.log(jobId, projectId, 'Loading research results…');
        const research = (payload['research'] as ResearchOutput | undefined)
          ?? await this.lastResult<ResearchOutput>(projectId, 'RESEARCH');
        if (!research) throw new Error('Research not found — complete the Research Topic step first.');
        const t0 = Date.now();
        this.log(jobId, projectId, 'Calling AI script writer…', `Topic: "${research.topic.slice(0, 60)}"`);
        const script = await this.content.writeScript(research);
        const s = script as { totalWordCount?: number; sections?: unknown[]; estimatedDurationMins?: number; title?: string };
        this.log(jobId, projectId, 'Script ready', `${s.totalWordCount ?? '?'} words · ${s.sections?.length ?? '?'} sections · ~${s.estimatedDurationMins ?? '?'} min`);
        await this.jobs.logStep(jobId, 'ScriptAgent', 'write', { research: research.topic }, script, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'SCRIPT', status: 'COMPLETED' }, projectId);
        return script;
      }

      case 'FACT_CHECK': {
        this.log(jobId, projectId, 'Loading script and sources…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        const research = (payload['research'] as ResearchOutput | undefined)
          ?? await this.lastResult<ResearchOutput>(projectId, 'RESEARCH');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');
        if (!research) throw new Error('Research not found — complete the Research Topic step first.');
        const t0 = Date.now();
        this.log(jobId, projectId, 'Verifying claims against sources…', `${research.sources?.length ?? 0} source(s)`);
        const result = await this.content.factCheck(script, research.sources);
        const fc = result as { accuracyScore?: number; overallVerdict?: string };
        this.log(jobId, projectId, 'Fact-check complete', fc.accuracyScore != null ? `${fc.accuracyScore}% accurate` : fc.overallVerdict ?? undefined);
        await this.jobs.logStep(jobId, 'FactCheckAgent', 'check', { script: script.title }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'FACT_CHECK', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'COMPLIANCE': {
        this.log(jobId, projectId, 'Loading script for compliance review…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');
        const t0 = Date.now();
        this.log(jobId, projectId, 'Sending to AI compliance auditor…', `"${script.title.slice(0, 60)}"`);

        const result = await this.compliance.enforce(
          {
            title: script.title,
            script: script.sections.map((s) => s.content).join('\n\n'),
          },
          (event) => {
            if (event.type === 'RETRYING') {
              this.log(jobId, projectId, `Retrying AI call…`, `Attempt ${event.attempt}/${event.maxAttempts} via ${event.provider}`);
              this.events.emitJobUpdate(jobId, {
                status: 'RETRYING', step: 'COMPLIANCE',
                attempt: event.attempt, maxAttempts: event.maxAttempts,
                waitMs: event.waitMs, provider: event.provider,
              }, projectId);
            } else if (event.type === 'PROVIDER_SWITCHING') {
              this.log(jobId, projectId, `Switching AI provider…`, `${event.from} → ${event.to}`);
              this.events.emitJobUpdate(jobId, {
                status: 'PROVIDER_SWITCHING', step: 'COMPLIANCE',
                from: event.from, to: event.to, reason: event.reason,
              }, projectId);
            } else if (event.type === 'RATE_LIMITED') {
              this.log(jobId, projectId, `Rate limited — waiting…`, `${event.provider} · ${Math.round((event.waitMs ?? 0) / 1000)}s`);
              this.events.emitJobUpdate(jobId, {
                status: 'RATE_LIMITED', step: 'COMPLIANCE',
                provider: event.provider, waitMs: event.waitMs, reason: event.reason,
              }, projectId);
            } else if (event.type === 'QUEUED') {
              this.log(jobId, projectId, `Request queued…`, `Est. wait ${Math.round((event.estimatedWaitMs ?? 0) / 1000)}s`);
              this.events.emitJobUpdate(jobId, {
                status: 'QUEUED', step: 'COMPLIANCE', estimatedWaitMs: event.estimatedWaitMs,
              }, projectId);
            }
          },
        );

        const passed = (result as { passed?: boolean; score?: number; flags?: unknown[] }).passed;
        const score = (result as { score?: number }).score;
        const flagCount = (result as { flags?: unknown[] }).flags?.length ?? 0;
        this.log(jobId, projectId,
          `Compliance ${passed ? 'passed ✓' : 'failed ✗'} — score ${score}/100`,
          `${flagCount} flag${flagCount !== 1 ? 's' : ''} found`,
        );

        await this.jobs.logStep(jobId, 'ComplianceAgent', 'check', { title: script.title }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'COMPLIANCE', status: 'COMPLETED', score: result.score }, projectId);
        return result;
      }

      case 'METADATA': {
        this.log(jobId, projectId, 'Loading script for metadata generation…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');
        const t0 = Date.now();
        this.log(jobId, projectId, 'Generating SEO title, description and tags…');
        const meta = await this.metadata.generate(script, project.niche ?? undefined);
        this.log(jobId, projectId, 'Metadata generated', `Title: "${(meta as { title?: string }).title?.slice(0, 50) ?? '?'}"`);
        await this.jobs.logStep(jobId, 'MetadataAgent', 'generate', { title: script.title }, meta, 0, 0, Date.now() - t0);

        this.log(jobId, projectId, 'Running keyword & SEO analysis…');
        const seoResult = await this.seo.optimize(
          (meta as { title?: string }).title ?? script.title,
          (meta as { description?: string }).description ?? '',
          project.niche ?? undefined,
        );
        await this.jobs.logStep(jobId, 'SEOAgent', 'optimize', { title: (meta as { title?: string }).title }, seoResult, 0, 0, 0);

        // Inside a FULL_PRODUCTION run the parent job must keep running;
        // metadata approval happens at publish time (which always requires an
        // approval — claude.md rule 2), so no approval row is created here.
        if (payload['pipelineMode']) {
          this.log(jobId, projectId, 'SEO analysis complete — approval deferred to publish step');
          this.events.emitJobUpdate(jobId, { step: 'METADATA', status: 'COMPLETED' }, projectId);
          return { metadata: meta, seo: seoResult, awaitingApproval: false };
        }

        this.log(jobId, projectId, 'SEO analysis complete — creating approval request…');
        await this.prisma.agentJob.update({
          where: { id: jobId },
          data: { status: 'WAITING_APPROVAL' },
        });
        await this.approvals.createApproval(projectId, jobId);
        this.events.emitJobUpdate(jobId, { step: 'METADATA', status: 'WAITING_APPROVAL' }, projectId);
        return { metadata: meta, seo: seoResult, awaitingApproval: true };
      }

      case 'SEO_OPTIMIZATION': {
        this.log(jobId, projectId, 'Loading metadata results…');
        const metaJob = await this.lastResult<{ metadata: { title: string; description: string } }>(projectId, 'METADATA');
        const title = (payload['title'] as string | undefined) ?? metaJob?.metadata?.title ?? '';
        const description = (payload['description'] as string | undefined) ?? metaJob?.metadata?.description ?? '';
        if (!title) throw new Error('Metadata not found — complete the Generate Metadata step first.');
        this.log(jobId, projectId, 'Running SEO keyword optimization…', `"${title.slice(0, 50)}"`);
        const result = await this.seo.optimize(title, description, project.niche ?? undefined);
        const primaryKw = (result as { primaryKeywords?: string[] }).primaryKeywords?.[0];
        this.log(jobId, projectId, 'SEO optimization complete', primaryKw ? `Top keyword: "${primaryKw}"` : undefined);
        this.events.emitJobUpdate(jobId, { step: 'SEO_OPTIMIZATION', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'THUMBNAIL': {
        this.log(jobId, projectId, 'Loading script for thumbnail…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        const brief = {
          concept: script
            ? `Thumbnail for: "${script.title}". Hook: "${script.hook.slice(0, 80)}"`
            : `Thumbnail brief for project: ${project.title}`,
          suggestedTextOverlay: script?.title.slice(0, 40) ?? project.title,
          colorScheme: 'High-contrast: brand primary + white text, dark background',
          aspectRatio: '16:9 (1280×720)',
        };
        // The brief is the PROMPT, not the deliverable (master prompt hard
        // rule 1) — the stage now produces a real, validated image asset
        // through the provider chain, or FAILS.
        this.log(jobId, projectId, 'Generating thumbnail image…', `Concept: ${brief.concept.slice(0, 100)}`);
        const image = await this.media.generateImage(projectId, 'Thumbnail', {
          prompt: [
            `YouTube thumbnail, 16:9, cinematic, high contrast, no text.`,
            brief.concept,
            `Color scheme: ${brief.colorScheme}.`,
            `Topic: ${project.niche ?? 'general'}.`,
          ].join(' '),
          width: 1280,
          height: 720,
        });
        this.log(jobId, projectId, 'Thumbnail image ready ✓',
          `${(image.sizeBytes / 1024).toFixed(0)} KB · provider ${image.provider}${image.notes ? ` · ${image.notes}` : ''}`);
        await this.jobs.logStep(jobId, 'ThumbnailAgent', 'generate', { projectId }, { ...brief, assetId: image.assetId, provider: image.provider }, 0, 0, 0);
        this.events.emitJobUpdate(jobId, { step: 'THUMBNAIL', status: 'COMPLETED' }, projectId);
        return { ...brief, assetId: image.assetId, versionId: image.versionId, key: image.key, provider: image.provider, notes: image.notes };
      }

      case 'PUBLISH': {
        const approvalId = payload['approvalId'] as string;
        const videoId = payload['videoId'] as string;
        const channelId = payload['channelId'] as string;
        const title = payload['title'] as string;
        const description = payload['description'] as string;
        const tags = payload['tags'] as string[] ?? [];
        const categoryId = payload['categoryId'] as string | undefined;
        const scheduledAt = payload['scheduledAt'] ? new Date(payload['scheduledAt'] as string) : undefined;
        const videoFilePath = payload['videoFilePath'] as string | undefined;

        this.log(jobId, projectId, 'Publishing to YouTube…', `"${title?.slice(0, 60)}"`);
        const t0 = Date.now();
        const youtubeVideoId = await this.publishing.publish(
          { videoId, channelId, title, description, tags, categoryId, scheduledAt, videoFilePath },
          approvalId,
        );
        this.log(jobId, projectId, 'Published to YouTube ✓', `Video ID: ${youtubeVideoId}`);
        await this.jobs.logStep(jobId, 'PublishAgent', 'publish', { videoId, channelId }, { youtubeVideoId }, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'PUBLISH', status: 'COMPLETED', youtubeVideoId }, projectId);
        return { youtubeVideoId };
      }

      case 'VOICE_SPEC': {
        this.log(jobId, projectId, 'Loading script for voice direction…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');
        const channel = await this.prisma.channel.findFirst({ where: { projects: { some: { id: projectId } } } });
        const voiceProfile = channel?.voiceProfile as Record<string, unknown> | undefined;
        const t0 = Date.now();
        this.log(jobId, projectId, 'Generating per-section voice narration specs…', `${script.sections.length} sections`);
        const result = await this.voice.generateSpec(script, projectId, voiceProfile);
        const sectionCount = (result as { sections?: unknown[] }).sections?.length ?? 0;
        this.log(jobId, projectId, 'Voice specs ready ✓', `${sectionCount} section(s) · disclosure: ${(result as { disclosureRequired?: boolean }).disclosureRequired ? 'required' : 'not required'}`);
        await this.jobs.logStep(jobId, 'VoiceAgent', 'spec', { sections: sectionCount }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'VOICE_SPEC', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'IMAGE_BRIEF': {
        this.log(jobId, projectId, 'Loading script for image briefs…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');
        const channel2 = await this.prisma.channel.findFirst({ where: { projects: { some: { id: projectId } } } });
        const brandKit = channel2?.brandKit as Record<string, unknown> | undefined;
        const t0 = Date.now();
        this.log(jobId, projectId, 'Generating per-scene image briefs…', `${script.sections.length} scenes`);
        const result = await this.image.generateBriefs(script, projectId, brandKit);
        const briefCount = (result as { briefs?: unknown[] }).briefs?.length ?? 0;
        this.log(jobId, projectId, 'Image briefs ready ✓', `${briefCount} brief(s)`);
        await this.jobs.logStep(jobId, 'ImageAgent', 'brief', { scenes: briefCount }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'IMAGE_BRIEF', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'MUSIC_BRIEF': {
        this.log(jobId, projectId, 'Loading script for music brief…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');
        const t0 = Date.now();
        const mood = payload['mood'] as string | undefined;
        const genre = payload['genre'] as string | undefined;
        this.log(jobId, projectId, 'Generating music production brief…', mood ? `Mood: ${mood}` : undefined);
        const result = await this.music.generateBrief(script, projectId, mood, genre);
        const brief = result as { genre?: string; bpm?: number; energy?: string };
        this.log(jobId, projectId, 'Music brief ready ✓', `${brief.genre ?? '?'} · ${brief.bpm ?? '?'} BPM · ${brief.energy ?? '?'} energy`);
        await this.jobs.logStep(jobId, 'MusicAgent', 'brief', { duration: script.estimatedDurationMins }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'MUSIC_BRIEF', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'VIDEO_SCENE_PLAN': {
        this.log(jobId, projectId, 'Loading script for video scene plan…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');
        const t0 = Date.now();
        this.log(jobId, projectId, 'Planning video scenes and shot list…', `${script.sections.length} sections → scenes`);
        const VIDEO_SCENE_PROMPT = `You are a video director. Create a scene plan from a script. Respond only with valid JSON.`;
        const sectionsJson = JSON.stringify(script.sections.map((s, i) => ({ id: `section-${i}`, heading: s.heading, durationSecs: s.durationEstimateSecs, content: s.content.slice(0, 200) })));
        const result = await callAIStructured(
          [{ role: 'user', content: `Create scene plan for "${script.title}". Sections: ${sectionsJson}. Project: ${projectId}. Generate scene id, title, description, durationSecs, shotType, videoPrompt, negativePrompt, transition for each section. Include totalDurationSecs and providerRecommendation.` }],
          VideoScenePlanOutputSchema,
          { systemPrompt: VIDEO_SCENE_PROMPT, maxTokens: 4096 },
        );
        const sceneCount = (result as { scenes?: unknown[] }).scenes?.length ?? 0;
        this.log(jobId, projectId, 'Scene plan ready ✓', `${sceneCount} scene(s)`);
        await this.jobs.logStep(jobId, 'VideoAgent', 'plan', { scenes: sceneCount }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'VIDEO_SCENE_PLAN', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'SUBTITLE_GENERATE': {
        this.log(jobId, projectId, 'Loading script for subtitle generation…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');
        const t0 = Date.now();
        const estimatedDurationMs = script.estimatedDurationMins * 60 * 1000;
        const lang = (payload['language'] as string | undefined) ?? project.targetLang ?? 'en';
        this.log(jobId, projectId, 'Generating subtitle cues…', `~${Math.round(estimatedDurationMs / 1000)}s, language: ${lang}`);
        const SUBTITLE_PROMPT = `You are a subtitle specialist. Generate timed subtitle cues from a script. Respond only with valid JSON.`;
        const result = await callAIStructured(
          [{ role: 'user', content: `Create subtitle cues for "${script.title}". Duration: ${Math.round(estimatedDurationMs / 1000)}s. Language: ${lang}. Sections: ${JSON.stringify(script.sections.map((s, i) => ({ id: `s${i}`, heading: s.heading, durationSecs: s.durationEstimateSecs, content: s.content.slice(0, 200) })))}. Generate sequential index, startMs, endMs, text (max 2 lines 42 chars), sectionRef. Include SRT string, VTT string, totalCues count, style (fontFamily: Arial, fontSize: 18, color: #FFFFFF).` }],
          SubtitleOutputSchema,
          { systemPrompt: SUBTITLE_PROMPT, maxTokens: 6000 },
        );
        // SRT/VTT are mechanical serializations of the cues — always built
        // deterministically in code, never trusted from the model.
        if (result.cues?.length) {
          result.srt = buildSrt(result.cues);
          result.vtt = buildVtt(result.cues);
          result.totalCues = result.cues.length;
        }
        const cueCount = (result as { totalCues?: number }).totalCues ?? 0;
        this.log(jobId, projectId, 'Subtitles ready ✓', `${cueCount} cues · ${lang}`);
        await this.jobs.logStep(jobId, 'SubtitleAgent', 'generate', { cues: cueCount, lang }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'SUBTITLE_GENERATE', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'EDIT_PLAN': {
        this.log(jobId, projectId, 'Loading script and assets for first-cut timeline…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');

        // Renders and uploads are pipeline outputs, not timeline inputs —
        // feeding them to the edit-plan model makes it invent invalid clip kinds
        const projectAssets = await this.prisma.asset.findMany({
          where: { projectId, deletedAt: null, status: { in: ['READY', 'ACCEPTED'] }, kind: { notIn: ['RENDER_SOURCE', 'UPLOAD'] } },
          include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        });

        const availableAssets = projectAssets.map(a => ({
          id: a.id,
          kind: a.kind.toLowerCase(),
          label: a.label ?? a.kind,
          durationMs: a.versions[0]?.durationMs ?? undefined,
          sectionRef: undefined,
        }));

        const t0 = Date.now();
        this.log(jobId, projectId, 'EditPlanAgent assembling first-cut timeline…', `${script.sections.length} sections, ${availableAssets.length} assets`);

        const EDIT_PROMPT = `You are a video editor AI. Assemble a first-cut timeline. Respond only with valid JSON.`;
        const channel3 = await this.prisma.channel.findFirst({ where: { projects: { some: { id: projectId } } } });
        const brandKit = channel3?.brandKit;

        const result = await callAIStructured(
          [{ role: 'user', content: `Create AI first-cut timeline for "${script.title}". Format: 16:9. Sections: ${JSON.stringify(script.sections.map((s) => ({ heading: s.heading, durationSecs: s.durationEstimateSecs })))}. Assets: ${JSON.stringify(availableAssets.slice(0, 20))}. Brand: ${JSON.stringify(brandKit ?? {})}. Project: ${projectId}. Generate multi-track timeline: voice, video, music, subtitle, overlay tracks. Required top-level fields: label, fps (30), resolution {width, height}, totalDurationMs, tracks. Each track: index (0-based), kind, label, clips. Each clip: id, kind, startMs, durationMs, trackIndex, label; assetId ONLY when it matches a provided asset id (omit otherwise, never invent).` }],
          EditPlanOutputSchema,
          { systemPrompt: EDIT_PROMPT, maxTokens: 6000 },
        );
        // Array position is authoritative for track order
        result.tracks.forEach((t, i) => { t.index ??= i; });

        const clipCount = (result as { tracks?: Array<{ clips?: unknown[] }> }).tracks?.reduce((s, t) => s + (t.clips?.length ?? 0), 0) ?? 0;
        this.log(jobId, projectId, 'First-cut timeline ready ✓', `${clipCount} clips assembled`);

        // Save as draft timeline
        const tracks = (result as { tracks?: unknown }).tracks;
        await this.prisma.timeline.upsert({
          where: { id: `draft-${projectId}` },
          create: { id: `draft-${projectId}`, projectId, version: 1, label: 'AI first cut', tracks: tracks as never, isDraft: true },
          update: { tracks: tracks as never, label: 'AI first cut', updatedAt: new Date() },
        }).catch(() => {
          // upsert by custom id fails if id field doesn't allow it — create separately
          return this.prisma.timeline.create({
            data: { projectId, version: 1, label: 'AI first cut', tracks: tracks as never, isDraft: true },
          });
        });

        await this.jobs.logStep(jobId, 'EditPlanAgent', 'assemble', { clips: clipCount }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'EDIT_PLAN', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'ANALYTICS': {
        this.log(jobId, projectId, 'Loading channel data for analytics report…');
        const channel4 = await this.prisma.channel.findFirst({ where: { projects: { some: { id: projectId } } } });
        if (!channel4) throw new Error('Channel not found for this project.');
        const t0 = Date.now();
        this.log(jobId, projectId, 'Running analytics diagnosis…', `Channel: ${channel4.title}`);
        const result = await this.analytics.generateReport(channel4.id, project.userId);
        const score = (result as { overallScore?: number }).overallScore;
        this.log(jobId, projectId, 'Analytics report ready ✓', `Score: ${score ?? '?'}/100`);
        await this.jobs.logStep(jobId, 'AnalyticsAgent', 'report', { channelId: channel4.id }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'ANALYTICS', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'GROWTH_REPORT': {
        this.log(jobId, projectId, 'Loading analytics for growth recommendations…');
        const analyticsResult = (payload['analyticsReport'] as AnalyticsOutput | undefined)
          ?? await this.lastResult<AnalyticsOutput>(projectId, 'ANALYTICS');
        if (!analyticsResult) throw new Error('Analytics not found — run Analytics first.');
        const channel5 = await this.prisma.channel.findFirst({ where: { projects: { some: { id: projectId } } } });
        if (!channel5) throw new Error('Channel not found for this project.');
        const t0 = Date.now();
        this.log(jobId, projectId, 'Generating next-video recommendations…');
        const result = await this.growth.generateRecommendations(channel5.id, analyticsResult, project.userId);
        const topicCount = (result as { nextTopics?: unknown[] }).nextTopics?.length ?? 0;
        this.log(jobId, projectId, 'Growth report ready ✓', `${topicCount} next topic idea(s)`);
        await this.jobs.logStep(jobId, 'GrowthAgent', 'recommend', { channelId: channel5.id }, result, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'GROWTH_REPORT', status: 'COMPLETED' }, projectId);
        return result;
      }

      case 'VOICE_GENERATE': {
        this.log(jobId, projectId, 'Loading script and voice spec…');
        const script = await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        if (!script) throw new Error('Script not found — complete the Write Script step first.');
        const spec = (payload['voiceSpec'] as VoiceSpecOutput | undefined)
          ?? await this.lastResult<VoiceSpecOutput>(projectId, 'VOICE_SPEC');

        const narration = [
          script.hook,
          ...script.sections.map((s) => s.content),
          script.callToAction,
        ].filter(Boolean).join('\n\n');

        const t0 = Date.now();
        this.log(jobId, projectId, 'Generating voice-over narration…', `${narration.split(/\s+/).length} words`);
        const stored = await this.media.generateVoice(projectId, 'Narration', {
          text: narration,
          voiceId: spec?.sections?.[0]?.voiceId,
          speed: spec?.sections?.[0]?.speed,
          language: project.targetLang,
        });
        this.log(jobId, projectId, stored.cached ? 'Voice-over reused from cache ✓' : 'Voice-over generated ✓',
          `${stored.provider} · ${Math.round((stored.durationMs ?? 0) / 1000)}s audio`);
        await this.jobs.logStep(jobId, 'VoiceAgent', 'generate', { words: narration.split(/\s+/).length }, { assetId: stored.assetId, provider: stored.provider }, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'VOICE_GENERATE', status: 'COMPLETED' }, projectId);
        return { assetId: stored.assetId, versionId: stored.versionId, provider: stored.provider, durationMs: stored.durationMs, cached: stored.cached, notes: stored.notes };
      }

      case 'IMAGE_GENERATE': {
        this.log(jobId, projectId, 'Loading image briefs…');
        const briefResult = (payload['imageBriefs'] as ImageBriefOutput | undefined)
          ?? await this.lastResult<ImageBriefOutput>(projectId, 'IMAGE_BRIEF');
        const briefs = briefResult?.briefs ?? [];
        if (briefs.length === 0) throw new Error('Image briefs not found — complete the Image Briefs step first.');

        const maxScenes = Math.min(briefs.length, Number(payload['maxScenes'] ?? 8));
        const t0 = Date.now();
        this.log(jobId, projectId, `Generating ${maxScenes} scene image(s)…`);
        const images: Array<{ sceneId: string; assetId: string; provider: string; cached: boolean }> = [];
        for (let i = 0; i < maxScenes; i++) {
          const brief = briefs[i]!;
          const stored = await this.media.generateImage(projectId, `Scene ${i + 1} · ${brief.sceneId}`, {
            prompt: brief.prompt,
            negativePrompt: brief.negativePrompt,
            width: 1280,
            height: 720,
          });
          images.push({ sceneId: brief.sceneId, assetId: stored.assetId, provider: stored.provider, cached: stored.cached });
          this.log(jobId, projectId, `Scene ${i + 1}/${maxScenes} ${stored.cached ? 'reused ✓' : 'ready ✓'}`, stored.provider);
        }
        await this.jobs.logStep(jobId, 'ImageAgent', 'generate', { scenes: maxScenes }, { images }, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'IMAGE_GENERATE', status: 'COMPLETED' }, projectId);
        return { images };
      }

      case 'MUSIC_GENERATE': {
        this.log(jobId, projectId, 'Loading music brief…');
        const brief = (payload['musicBrief'] as MusicBriefOutput | undefined)
          ?? await this.lastResult<MusicBriefOutput>(projectId, 'MUSIC_BRIEF');
        if (!brief) throw new Error('Music brief not found — complete the Music Brief step first.');

        const t0 = Date.now();
        this.log(jobId, projectId, 'Composing background music…', `${brief.genre} · ${brief.bpm} BPM · ${brief.energy}`);
        const stored = await this.media.generateMusic(projectId, 'Background music', {
          mood: brief.mood,
          genre: brief.genre,
          bpm: brief.bpm,
          energy: brief.energy,
          durationSecs: brief.durationSecs,
        });
        this.log(jobId, projectId, stored.cached ? 'Music reused from cache ✓' : 'Music track ready ✓',
          `${stored.provider} · ${Math.round((stored.durationMs ?? 0) / 1000)}s`);
        await this.jobs.logStep(jobId, 'MusicAgent', 'generate', { genre: brief.genre }, { assetId: stored.assetId, provider: stored.provider }, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'MUSIC_GENERATE', status: 'COMPLETED' }, projectId);
        return { assetId: stored.assetId, versionId: stored.versionId, provider: stored.provider, durationMs: stored.durationMs, cached: stored.cached, notes: stored.notes };
      }

      case 'VIDEO_GENERATE': {
        this.log(jobId, projectId, 'Loading storyboard and scene images…');
        const plan = (payload['scenePlan'] as VideoScenePlanOutput | undefined)
          ?? await this.lastResult<VideoScenePlanOutput>(projectId, 'VIDEO_SCENE_PLAN');
        if (!plan?.scenes?.length) throw new Error('Scene plan not found — complete the Storyboard step first.');

        const imageAssets = await this.prisma.asset.findMany({
          where: { projectId, kind: 'IMAGE', deletedAt: null, status: { in: ['READY', 'ACCEPTED'] } },
          include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
          orderBy: { createdAt: 'asc' },
        });

        const maxScenes = Math.min(plan.scenes.length, Number(payload['maxScenes'] ?? 8));
        const t0 = Date.now();
        this.log(jobId, projectId, `Generating ${maxScenes} scene video(s)…`);
        const videos: Array<{ sceneId: string; assetId: string; versionId: string; provider: string; cached: boolean }> = [];
        for (let i = 0; i < maxScenes; i++) {
          const scene = plan.scenes[i]!;
          let imagePath: string | undefined;
          const imgKey = imageAssets[i]?.versions[0]?.r2Key;
          if (imgKey && this.storage.exists(imgKey)) {
            imagePath = this.storage.resolve(imgKey);
          } else {
            const still = await this.media.generateImage(projectId, `Scene ${i + 1} still · ${scene.id}`, {
              prompt: scene.videoPrompt, width: 1280, height: 720,
            });
            imagePath = still.absPath;
          }
          const stored = await this.media.generateSceneVideo(projectId, `Scene video ${i + 1} · ${scene.id}`, {
            imagePath,
            prompt: scene.videoPrompt,
            durationSecs: Math.min(Math.max(scene.durationSecs, 2), 30),
            width: 1280,
            height: 720,
          });
          videos.push({ sceneId: scene.id, assetId: stored.assetId, versionId: stored.versionId, provider: stored.provider, cached: stored.cached });
          this.log(jobId, projectId, `Scene video ${i + 1}/${maxScenes} ${stored.cached ? 'reused ✓' : 'rendered ✓'}`, stored.provider);
        }
        await this.jobs.logStep(jobId, 'VideoAgent', 'generate', { scenes: maxScenes }, { videos }, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'VIDEO_GENERATE', status: 'COMPLETED' }, projectId);
        return { videos };
      }

      case 'RENDER': {
        if (!ffmpegPath()) {
          throw new Error('Renderer unavailable — ffmpeg binary not found. Install ffmpeg or the ffmpeg-static package.');
        }
        // Timeline-editor renders track a Render row; keep it honest
        const renderRowId = payload['renderRowId'] as string | undefined;
        if (renderRowId) {
          await this.prisma.render.update({
            where: { id: renderRowId },
            data: { status: 'RENDERING', progressPct: 5 },
          }).catch(() => undefined);
        }

        // ── Feature 1: Render preset ────────────────────────────────────────
        type RenderPreset = 'LANDSCAPE' | 'VERTICAL' | 'SQUARE';
        const PRESET_DIMS: Record<RenderPreset, { width: number; height: number }> = {
          LANDSCAPE: { width: 1280, height: 720 },
          VERTICAL:  { width: 720,  height: 1280 },
          SQUARE:    { width: 720,  height: 720 },
        };
        const rawPreset = (payload['preset'] as string | undefined)?.toUpperCase();
        const preset: RenderPreset = (rawPreset && rawPreset in PRESET_DIMS)
          ? (rawPreset as RenderPreset)
          : 'LANDSCAPE';
        const { width, height } = PRESET_DIMS[preset];

        this.log(jobId, projectId, 'Collecting assets for final render…', `Preset: ${preset} (${width}×${height})`);

        const script = await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        const plan = await this.lastResult<VideoScenePlanOutput>(projectId, 'VIDEO_SCENE_PLAN');
        const subtitles = await this.lastResult<SubtitleOutput>(projectId, 'SUBTITLE_GENERATE');

        const latest = async (kind: 'VIDEO' | 'IMAGE' | 'VOICE' | 'MUSIC') =>
          this.prisma.asset.findMany({
            where: { projectId, kind, deletedAt: null, status: { in: ['READY', 'ACCEPTED'] } },
            include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
            orderBy: { createdAt: 'asc' },
          });

        const [videoAssets, imageAssets, voiceAssets, musicAssets] = await Promise.all([
          latest('VIDEO'), latest('IMAGE'), latest('VOICE'), latest('MUSIC'),
        ]);

        const resolveKey = (a?: { versions: Array<{ r2Key: string | null }> }) => {
          const key = a?.versions[0]?.r2Key;
          return key && this.storage.exists(key) ? this.storage.resolve(key) : undefined;
        };

        const sceneDurations = plan?.scenes?.map((s) => Math.min(Math.max(s.durationSecs, 2), 30))
          ?? script?.sections.map((s) => Math.min(Math.max(s.durationEstimateSecs ?? 20, 5), 60))
          ?? [30];

        const scenes: ComposeScene[] = [];
        for (let i = 0; i < sceneDurations.length; i++) {
          const videoPath = resolveKey(videoAssets[i]);
          const imagePath = resolveKey(imageAssets[i]);
          if (videoPath) scenes.push({ videoPath, durationSecs: sceneDurations[i]! });
          else if (imagePath) scenes.push({ imagePath, durationSecs: sceneDurations[i]! });
        }

        // ── Feature 3: Auto B-roll fill ──────────────────────────────────────
        // If the script has more sections than covered scenes, generate still
        // images for the uncovered sections and append them as B-roll.
        const scriptSections = script?.sections ?? [];
        if (scriptSections.length > scenes.length) {
          const uncoveredSections = scriptSections.slice(scenes.length);
          for (let i = 0; i < uncoveredSections.length; i++) {
            const section = uncoveredSections[i]!;
            const sectionIdx = scenes.length + i + 1;
            const prompt = `${section.heading}: ${section.content.slice(0, 160)}`;
            const stored = await this.media.generateImage(projectId, `B-roll · section ${sectionIdx}`, {
              prompt,
              width,
              height,
            });
            const clampedDuration = Math.min(Math.max(section.durationEstimateSecs ?? 20, 5), 60);
            scenes.push({ imagePath: stored.absPath, durationSecs: clampedDuration });
          }
          this.log(jobId, projectId, `Auto B-roll: filled ${uncoveredSections.length} uncovered section(s)`);
        }

        if (scenes.length === 0) throw new Error('No scene videos or images available — run Scene Images / Scene Videos first.');

        const voicePath = resolveKey(voiceAssets[voiceAssets.length - 1]);
        const musicPath = resolveKey(musicAssets[musicAssets.length - 1]);

        // ── Total scene duration (needed for subtitle rescaling and quality) ──
        const totalSceneSecs = scenes.reduce((s, sc) => s + sc.durationSecs, 0);
        const totalMs = Math.round(totalSceneSecs * 1000);

        // ── Subtitle rescaling + SRT write ────────────────────────────────────
        let subtitlePath: string | undefined;
        let tmpDir: string | undefined;
        const subtitleFindings: import('../modules/media/quality.util').QualityFinding[] = [];
        let srtContent: string;
        if (subtitles?.cues?.length) {
          // Prefer cues over stored string — rescaling requires cue data.
          const fitted = fitCuesToDuration(subtitles.cues, totalMs);
          if (fitted.scaled) {
            this.log(jobId, projectId, 'Quality: subtitle cues rescaled to fit video duration');
            subtitleFindings.push({
              level: 'fixed',
              check: 'subtitle-overrun',
              message: `Subtitle cues extended past the video end — rescaled to fit ${Math.round(totalMs / 1000)}s.`,
            });
          }
          srtContent = buildSrt(fitted.cues);
        } else {
          srtContent = subtitles?.srt ?? '';
        }
        if (srtContent) {
          tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-render-'));
          subtitlePath = path.join(tmpDir, 'captions.srt');
          await fsp.writeFile(subtitlePath, srtContent, 'utf8');
        }

        // ── Feature 2: SFX — write whoosh WAV + compute transition timestamps ─
        let sfxPath: string | undefined;
        const sfxTimestamps: number[] = [];
        {
          // Scene boundaries: cumulative durations, excluding t=0 and the final end
          let cumulative = 0;
          for (let i = 0; i < scenes.length - 1; i++) {
            cumulative += scenes[i]!.durationSecs;
            sfxTimestamps.push(cumulative);
          }
          if (sfxTimestamps.length > 0) {
            if (!tmpDir) {
              tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cf-render-'));
            }
            sfxPath = path.join(tmpDir, 'whoosh.wav');
            await fsp.writeFile(sfxPath, encodeWhooshWav(22050));
            this.log(jobId, projectId, `SFX: ${sfxTimestamps.length} transition whoosh(es) aligned`);
          }
        }

        // ── Feature 4: Quality analysis ──────────────────────────────────────
        const voiceAsset = voiceAssets[voiceAssets.length - 1];
        const voiceDurationMs = voiceAsset?.versions[0]?.durationMs ?? undefined;
        // Pass original lastCueEndMs to detect the problem; subtitleFindings records the fix.
        const lastCueEndMs = subtitles?.cues?.length
          ? subtitles.cues[subtitles.cues.length - 1]?.endMs
          : undefined;

        const durationFindings = checkDurations({
          totalSceneSecs,
          voiceDurationMs: voiceDurationMs ?? undefined,
          scriptEstimateMins: script?.estimatedDurationMins,
          lastCueEndMs: lastCueEndMs ?? undefined,
        });
        for (const f of durationFindings) {
          if (f.level !== 'ok') this.log(jobId, projectId, `Quality: ${f.message}`);
        }

        // Use runFfmpegCapture for volumedetect (writes results to stderr)
        const ffmpegRunForLoudness = (args: string[]) => runFfmpegCapture(['-hide_banner', ...args]);
        const { findings: loudnessFindings, musicVolumeAdjust } = await analyzeLoudness(
          ffmpegRunForLoudness,
          voicePath,
          musicPath,
        );
        for (const f of loudnessFindings) {
          this.log(jobId, projectId, `Quality: ${f.message}`);
        }

        const allQualityFindings = [...durationFindings, ...loudnessFindings, ...subtitleFindings];
        const effectiveMusicVolume = musicVolumeAdjust ?? 0.22;

        const t0 = Date.now();
        this.log(jobId, projectId, 'Rendering final video…',
          `${scenes.length} scene(s) · ~${Math.round(totalSceneSecs)}s · voice: ${voicePath ? 'yes' : 'no'} · music: ${musicPath ? 'yes' : 'no'} · captions: ${subtitlePath ? 'burned' : 'none'} · preset: ${preset}`);
        this.events.emitJobUpdate(jobId, { step: 'RENDER', status: 'RUNNING', scenes: scenes.length }, projectId);

        const renderKey = `renders/${projectId}/final-${preset.toLowerCase()}.mp4`;
        const outPath = this.storage.resolve(renderKey);
        try {
          // Quality gate (master prompt §9): the render is only COMPLETED when
          // the output decodes, matches the timeline duration, is not black
          // and — when narration/music went in — is not silent. One retry,
          // then the stage FAILS. Never a silent COMPLETED.
          const hasAudioInputs = !!voicePath || !!musicPath;
          // Real progress (§3.5): seconds encoded / seconds total, streamed
          // from ffmpeg itself. Throttled DB writes for the Render row.
          let lastEmitted = -5;
          const onProgress = (pct: number) => {
            if (pct - lastEmitted < 5 && pct !== 100) return;
            lastEmitted = pct;
            this.events.emitJobUpdate(jobId, { step: 'RENDER', status: 'RUNNING', progressPct: pct }, projectId);
            if (renderRowId) {
              void this.prisma.render.update({
                where: { id: renderRowId },
                data: { progressPct: Math.min(99, pct) },
              }).catch(() => undefined);
            }
          };
          let renderValidation: Awaited<ReturnType<typeof validateMediaFile>> | null = null;
          for (let attempt = 1; attempt <= 2; attempt++) {
            await composeVideo({
              scenes,
              voicePath,
              musicPath,
              subtitlePath,
              outPath,
              width,
              height,
              fps: 30,
              musicVolume: effectiveMusicVolume,
              onProgress,
              ...(sfxPath && sfxTimestamps.length > 0 ? { sfx: { path: sfxPath, atSecs: sfxTimestamps } } : {}),
            });
            this.log(jobId, projectId, 'Validating render…', 'decode, duration, black-frame and loudness scan');
            renderValidation = await validateMediaFile('VIDEO', outPath, {
              expectedDurationMs: Math.round(totalSceneSecs * 1000),
              requireAudio: hasAudioInputs,
            });
            if (renderValidation.ok) break;
            this.log(jobId, projectId, `Render validation failed (attempt ${attempt}/2)`, formatIssues(renderValidation));
          }
          if (!renderValidation?.ok) {
            throw new Error(`Render failed quality validation: ${formatIssues(renderValidation!)}`);
          }
        } finally {
          if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
        }

        const stat = await fsp.stat(outPath);
        const renderAsset = await this.prisma.asset.create({
          data: {
            projectId,
            kind: 'RENDER_SOURCE',
            label: `Final render (${preset} ${width}×${height})`,
            status: 'READY',
          },
        });
        const renderVersion = await this.prisma.assetVersion.create({
          data: {
            assetId: renderAsset.id,
            version: 1,
            r2Key: renderKey,
            provider: 'ffmpeg',
            model: 'libx264',
            provenance: {
              provider: 'ffmpeg', model: 'libx264', generatedAt: new Date().toISOString(),
              preset,
              inputs: {
                scenes: scenes.length,
                voice: !!voicePath,
                music: !!musicPath,
                subtitles: !!subtitlePath,
                sfxWhooshes: sfxTimestamps.length,
              },
            } as never,
            sizeBytes: BigInt(stat.size),
            durationMs: totalMs,
          },
        });
        await this.prisma.asset.update({ where: { id: renderAsset.id }, data: { currentVersionId: renderVersion.id } });

        if (renderRowId) {
          // Real metadata only: content-derived checksum, actual size/duration
          const checksum = createHash('sha256').update(await fsp.readFile(outPath)).digest('hex');
          await this.prisma.render.update({
            where: { id: renderRowId },
            data: {
              status: 'READY',
              progressPct: 100,
              r2Key: renderKey,
              checksum,
              durationMs: totalMs,
              sizeBytes: BigInt(stat.size),
            },
          }).catch(() => undefined);
        }

        this.log(jobId, projectId, 'Final video rendered ✓',
          `${(stat.size / 1024 / 1024).toFixed(1)} MB · ${Math.round(totalSceneSecs)}s · ${Math.round((Date.now() - t0) / 1000)}s render time · preset ${preset}`);
        await this.jobs.logStep(jobId, 'RenderWorker', 'compose', { scenes: scenes.length, preset }, { renderKey, sizeBytes: stat.size }, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'RENDER', status: 'COMPLETED' }, projectId);
        return {
          assetId: renderAsset.id,
          versionId: renderVersion.id,
          key: renderKey,
          sizeBytes: stat.size,
          durationSecs: Math.round(totalSceneSecs),
          preset,
          qualityReport: allQualityFindings,
        };
      }

      case 'FULL_PRODUCTION': {
        const scope = (payload['scope'] as PipelineScope | undefined) ?? 'FULL';
        const force = !!payload['force'];
        // Selective refresh (e.g. after the admin adds a real voice provider
        // key): listed stages re-run even though they completed before.
        const regenerate = new Set(Array.isArray(payload['regenerate']) ? (payload['regenerate'] as string[]) : []);
        const stages = planPipeline(scope);

        const completedJobs = await this.prisma.agentJob.findMany({
          where: { projectId, status: 'COMPLETED' },
          select: { type: true },
        });
        const { run, skipped } = partitionResume(stages, new Set(completedJobs.map((j) => j.type as string)), force, regenerate);

        // Resumed pipelines still honor the compliance gate: a previously
        // failed audit blocks media generation (claude.md golden rule 1).
        if (skipped.some((s) => s.type === 'COMPLIANCE')) {
          const prior = await this.lastResult<{ passed?: boolean; score?: number }>(projectId, 'COMPLIANCE');
          if (prior?.passed === false) {
            throw new Error(`Compliance gate: previous audit failed (score ${prior.score ?? '?'}). Fix the flagged issues and re-run.`);
          }
        }

        for (const s of skipped) this.log(jobId, projectId, `Skipping ${s.label} — cached result reused`);

        // Historical stage durations power the honest ETA
        const avgRows = await this.prisma.$queryRaw<Array<{ type: string; avg: number | null }>>`
          SELECT type::text AS type, EXTRACT(EPOCH FROM AVG("completedAt" - "startedAt")) AS avg
          FROM "agent_jobs"
          WHERE status = 'COMPLETED' AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL
          GROUP BY type`;
        const hist = new Map(avgRows.filter((r) => r.avg != null).map((r) => [r.type, Number(r.avg)]));

        const batches = batchStages(run);
        const stageResults: Record<string, unknown> = {};
        let done = skipped.length;
        let remaining = [...run];

        this.log(jobId, projectId, `Full production started — ${run.length} stage(s) to run, ${skipped.length} cached`,
          `Scope: ${scope} · est. ${Math.round(estimateRemainingSecs(remaining, hist) / 60)} min`);

        const runStage = async (stage: PipelineStage): Promise<void> => {
          if (stage.type === 'PACKAGE') {
            this.log(jobId, projectId, 'Building upload-ready package…');
            const files = await this.exportsSvc.buildPackage(projectId);
            stageResults['PACKAGE'] = files;
            this.log(jobId, projectId, 'Package ready ✓', `${files.length} file(s) in exports`);
            return;
          }
          // Each stage is a real child job: results persist for resume and
          // downstream lastResult() reads, and the dashboard cards light up.
          const child = await this.prisma.agentJob.create({
            data: { projectId, type: stage.type, status: 'RUNNING', startedAt: new Date(), payload: { pipelineMode: true } as never },
          });
          this.events.emitJobUpdate(child.id, { status: 'RUNNING', type: stage.type }, projectId);
          try {
            // Whitelisted user inputs flow to the stages that consume them
            const stagePayload: Record<string, unknown> = { pipelineMode: true };
            if (stage.type === 'RESEARCH' && payload['topic']) stagePayload['topic'] = payload['topic'];
            if (stage.type === 'RESEARCH' && payload['platform']) stagePayload['platform'] = payload['platform'];
            if (stage.type === 'MUSIC_BRIEF') {
              if (payload['mood']) stagePayload['mood'] = payload['mood'];
              if (payload['genre']) stagePayload['genre'] = payload['genre'];
            }
            if (stage.type === 'RENDER' && payload['preset']) stagePayload['preset'] = payload['preset'];
            // Stage-level retry with backoff (master prompt §3.2): one retry
            // for transient failures, then the stage FAILS for real.
            let result: unknown;
            for (let attempt = 1; ; attempt++) {
              try {
                result = await this.dispatch(stage.type, projectId, child.id, stagePayload);
                break;
              } catch (stageErr) {
                if (attempt >= 2) throw stageErr;
                const waitMs = 5_000 * attempt;
                this.log(child.id, projectId, `Stage ${stage.type} failed (attempt ${attempt}/2) — retrying in ${waitMs / 1000}s`,
                  stageErr instanceof Error ? stageErr.message.slice(0, 150) : String(stageErr));
                await new Promise((r) => setTimeout(r, waitMs));
              }
            }
            await this.prisma.agentJob.update({
              where: { id: child.id },
              data: { status: 'COMPLETED', result: result as never, completedAt: new Date() },
            });
            this.events.emitJobComplete(child.id, { result }, projectId);
            stageResults[stage.type] = result;
            if (stage.gate) {
              const passed = (result as { passed?: boolean; score?: number }).passed;
              if (passed === false) {
                throw new Error(`Compliance gate failed (score ${(result as { score?: number }).score ?? '?'}/100) — pipeline stopped before any media generation. Review the flags, fix the script, and re-run.`);
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await this.prisma.agentJob.update({
              where: { id: child.id },
              data: { status: 'FAILED', error: msg, completedAt: new Date() },
            }).catch(() => undefined);
            this.events.emitJobFailed(child.id, msg, projectId);
            throw err;
          }
        };

        for (const batch of batches) {
          const label = batch.map((s) => s.label).join(' + ');
          this.events.emitJobUpdate(jobId, {
            status: 'RUNNING',
            type: 'FULL_PRODUCTION',
            pipelineStage: label,
            pipelineIndex: done,
            pipelineCount: stages.length,
            etaSecs: estimateRemainingSecs(remaining, hist),
          }, projectId);
          this.log(jobId, projectId, `Stage ${done + 1}/${stages.length}: ${label}`);

          if (batch.length === 1) await runStage(batch[0]!);
          else await Promise.all(batch.map(runStage));

          done += batch.length;
          remaining = remaining.slice(batch.length);
        }

        this.events.emitJobUpdate(jobId, {
          status: 'RUNNING', type: 'FULL_PRODUCTION',
          pipelineStage: 'Complete', pipelineIndex: stages.length, pipelineCount: stages.length, etaSecs: 0,
        }, projectId);
        this.log(jobId, projectId, 'Full production complete ✓', `${run.length} stage(s) ran, ${skipped.length} cached`);

        return {
          scope,
          stagesRun: run.map((s) => s.type),
          stagesSkipped: skipped.map((s) => s.type),
          exports: stageResults['PACKAGE'] ?? [],
        };
      }

      // ── Shorts Studio import pipeline (ai.md Sections 3, 15, 16) ────────────

      case 'VIDEO_IMPORT': {
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('VIDEO_IMPORT requires payload.importedVideoId');
        return this.videoImport.ensureSourceDownloaded(importedVideoId, (m) => this.log(jobId, projectId, m));
      }

      case 'TRANSCRIPT_ANALYSIS': {
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('TRANSCRIPT_ANALYSIS requires payload.importedVideoId');
        return this.transcript.ensureTranscript(importedVideoId, (m) => this.log(jobId, projectId, m));
      }

      case 'SCENE_DETECTION': {
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('SCENE_DETECTION requires payload.importedVideoId');
        return this.sceneDetection.ensureScenes(importedVideoId, (m) => this.log(jobId, projectId, m));
      }

      case 'TOPIC_SEGMENTATION': {
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('TOPIC_SEGMENTATION requires payload.importedVideoId');
        return this.topicSegmentation.ensureTopics(importedVideoId, (m) => this.log(jobId, projectId, m));
      }

      case 'HIGHLIGHT_DETECTION': {
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('HIGHLIGHT_DETECTION requires payload.importedVideoId');
        return this.highlightScoring.ensureHighlights(importedVideoId, (m) => this.log(jobId, projectId, m));
      }

      case 'CHAPTER_DETECTION': {
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('CHAPTER_DETECTION requires payload.importedVideoId');
        return this.chapterDetection.ensureChapters(importedVideoId, (m) => this.log(jobId, projectId, m));
      }

      case 'EMBEDDING_GENERATION': {
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('EMBEDDING_GENERATION requires payload.importedVideoId');
        return this.embeddingGeneration.ensureEmbeddings(importedVideoId, (m) => this.log(jobId, projectId, m));
      }

      case 'CHURCH_PACK_GENERATION': {
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('CHURCH_PACK_GENERATION requires payload.importedVideoId');
        return this.churchPack.ensureChurchPack(importedVideoId, (m) => this.log(jobId, projectId, m));
      }

      case 'SOCIAL_CONTENT_GENERATION': {
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('SOCIAL_CONTENT_GENERATION requires payload.importedVideoId');
        return this.socialContent.ensureSocialContent(importedVideoId, (m) => this.log(jobId, projectId, m));
      }

      case 'CAPTION_GENERATION': {
        const shortClipId = payload['shortClipId'] as string;
        if (!shortClipId) throw new Error('CAPTION_GENERATION requires payload.shortClipId');
        return this.captionGeneration.ensureCaptions(shortClipId, (m) => this.log(jobId, projectId, m));
      }

      case 'SHORTS_RENDER': {
        const shortClipId = payload['shortClipId'] as string;
        if (!shortClipId) throw new Error('SHORTS_RENDER requires payload.shortClipId');
        return this.shortsRender.renderClip(shortClipId, jobId, (m) => this.log(jobId, projectId, m));
      }

      case 'SHORTS_EXPORT': {
        const shortClipId = payload['shortClipId'] as string;
        if (!shortClipId) throw new Error('SHORTS_EXPORT requires payload.shortClipId');
        return this.shortsExport.exportClip(shortClipId, (m) => this.log(jobId, projectId, m));
      }

      case 'SHORTS_PUBLISH': {
        const shortClipId = payload['shortClipId'] as string;
        const approvalId = payload['approvalId'] as string;
        const exportId = payload['exportId'] as string;
        if (!shortClipId || !approvalId || !exportId) {
          throw new Error('SHORTS_PUBLISH requires payload.shortClipId, approvalId and exportId');
        }
        return this.shortsExport.publishClip(shortClipId, approvalId, exportId, (m) => this.log(jobId, projectId, m));
      }

      case 'SHORTS_ANALYZE': {
        // Pipeline root for one imported video. Each stage runs as a real child
        // job (same convention as FULL_PRODUCTION) so results persist per stage
        // and the dashboard lights up. Stages self-skip when their output rows
        // already exist (ai.md resume rule 16.1) — a re-run only redoes gaps.
        const importedVideoId = payload['importedVideoId'] as string;
        if (!importedVideoId) throw new Error('SHORTS_ANALYZE requires payload.importedVideoId');

        const stageResults: Record<string, unknown> = {};
        let idx = 0;
        for (const stageType of SHORTS_IMPORT_STAGES) {
          idx += 1;
          this.events.emitJobUpdate(jobId, {
            status: 'RUNNING', type: 'SHORTS_ANALYZE',
            pipelineStage: stageType, pipelineIndex: idx - 1, pipelineCount: SHORTS_IMPORT_STAGES.length,
          }, projectId);
          this.log(jobId, projectId, `Stage ${idx}/${SHORTS_IMPORT_STAGES.length}: ${stageType}`);

          const child = await this.prisma.agentJob.create({
            data: {
              projectId, type: stageType, status: 'RUNNING', startedAt: new Date(),
              payload: { pipelineMode: true, importedVideoId } as never,
            },
          });
          this.events.emitJobUpdate(child.id, { status: 'RUNNING', type: stageType }, projectId);
          try {
            const result = await this.dispatch(stageType, projectId, child.id, { pipelineMode: true, importedVideoId });
            await this.prisma.agentJob.update({
              where: { id: child.id },
              data: { status: 'COMPLETED', result: result as never, completedAt: new Date() },
            });
            this.events.emitJobComplete(child.id, { result }, projectId);
            stageResults[stageType] = result;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await this.prisma.agentJob.update({
              where: { id: child.id },
              data: { status: 'FAILED', error: msg, completedAt: new Date() },
            }).catch(() => undefined);
            this.events.emitJobFailed(child.id, msg, projectId);
            throw err;
          }
        }

        this.log(jobId, projectId, 'Shorts analysis pipeline complete ✓');
        return { importedVideoId, stages: stageResults };
      }

      default:
        throw new Error(`Unknown job type: ${String(type)}`);
    }
  }
}
