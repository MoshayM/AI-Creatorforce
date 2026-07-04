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
import { composeVideo, ffmpegPath, runFfmpegCapture, type ComposeScene } from '../modules/media/adapters/ffmpeg.util';
import { encodeWhooshWav } from '../modules/media/adapters/codec.util';
import { checkDurations, analyzeLoudness } from '../modules/media/quality.util';
import { buildSrt, buildVtt } from '../modules/media/subtitle.util';
import { planPipeline, partitionResume, batchStages, estimateRemainingSecs, type PipelineScope, type PipelineStage } from './pipeline-plan';
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

interface JobPayload {
  jobId: string;
  projectId: string;
  type: JobType;
  payload: Record<string, unknown>;
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
    private readonly events: EventsGateway,
  ) {
    super();
  }

  async process(job: Job<JobPayload>): Promise<unknown> {
    const { jobId, projectId, type, payload } = job.data;
    const t0 = Date.now();

    await this.prisma.agentJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
    this.events.emitJobUpdate(jobId, { status: 'RUNNING', type }, projectId);

    try {
      const result = await this.dispatch(type, projectId, jobId, payload);
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
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.agentJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', error: msg, completedAt: new Date() },
      });
      this.events.emitJobLog(jobId, projectId, `Agent error: ${msg.slice(0, 120)}`);
      this.events.emitJobFailed(jobId, msg, projectId);
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
        this.log(jobId, projectId, 'Loading script for thumbnail brief…');
        const script = (payload['script'] as ScriptOutput | undefined)
          ?? await this.lastResult<ScriptOutput>(projectId, 'SCRIPT');
        this.log(jobId, projectId, 'Generating thumbnail visual brief…');
        const brief = {
          concept: script
            ? `Thumbnail for: "${script.title}". Hook: "${script.hook.slice(0, 80)}"`
            : `Thumbnail brief for project: ${project.title}`,
          suggestedTextOverlay: script?.title.slice(0, 40) ?? project.title,
          colorScheme: 'High-contrast: brand primary + white text, dark background',
          visualElements: [
            'Presenter face (reaction/emotion shot)',
            `Topic graphic related to: ${project.niche ?? 'General'}`,
            'Bold sans-serif text overlay',
          ],
          aspectRatio: '16:9 (1280×720 minimum, 2560×1440 recommended)',
          note: 'Generated as a brief — actual image creation is Phase 2 (in-app asset generation).',
        };
        this.log(jobId, projectId, 'Thumbnail brief ready', `Text overlay: "${brief.suggestedTextOverlay}"`);
        await this.jobs.logStep(jobId, 'ThumbnailAgent', 'brief', { projectId }, brief, 0, 0, 0);
        this.events.emitJobUpdate(jobId, { step: 'THUMBNAIL', status: 'COMPLETED', brief: true }, projectId);
        return brief;
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

        const projectAssets = await this.prisma.asset.findMany({
          where: { projectId, deletedAt: null, status: { in: ['READY', 'ACCEPTED'] } },
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
          [{ role: 'user', content: `Create AI first-cut timeline for "${script.title}". Format: 16:9. Sections: ${JSON.stringify(script.sections.map((s, i) => ({ heading: s.heading, durationSecs: s.durationEstimateSecs })))}. Assets: ${JSON.stringify(availableAssets.slice(0, 20))}. Brand: ${JSON.stringify(brandKit ?? {})}. Project: ${projectId}. Generate multi-track timeline: voice, video, music, subtitle, overlay tracks. Required top-level fields: label, fps (30), resolution {width, height}, totalDurationMs, tracks. Each track: index (0-based), kind, label, clips. Each clip: id, kind, startMs, durationMs, trackIndex, label; assetId ONLY when it matches a provided asset id (omit otherwise, never invent).` }],
          EditPlanOutputSchema,
          { systemPrompt: EDIT_PROMPT, maxTokens: 6000 },
        );
        // Array position is authoritative for track order
        result.tracks.forEach((t, i) => { t.index ??= i; });

        const clipCount = (result as { tracks?: Array<{ clips?: unknown[] }> }).tracks?.reduce((s, t) => s + (t.clips?.length ?? 0), 0) ?? 0;
        this.log(jobId, projectId, 'First-cut timeline ready ✓', `${clipCount} clips assembled`);

        // Save as draft timeline
        const totalDurationMs = (result as { totalDurationMs?: number }).totalDurationMs ?? script.estimatedDurationMins * 60000;
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

        let subtitlePath: string | undefined;
        let tmpDir: string | undefined;
        const srtContent = subtitles?.srt || (subtitles?.cues?.length ? buildSrt(subtitles.cues) : '');
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
        const totalSecsBeforeQuality = scenes.reduce((s, sc) => s + sc.durationSecs, 0);
        const voiceAsset = voiceAssets[voiceAssets.length - 1];
        const voiceDurationMs = voiceAsset?.versions[0]?.durationMs ?? undefined;
        const lastCueEndMs = subtitles?.cues?.length
          ? subtitles.cues[subtitles.cues.length - 1]?.endMs
          : undefined;

        const durationFindings = checkDurations({
          totalSceneSecs: totalSecsBeforeQuality,
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

        const allQualityFindings = [...durationFindings, ...loudnessFindings];
        const effectiveMusicVolume = musicVolumeAdjust ?? 0.22;

        const t0 = Date.now();
        const totalSecs = scenes.reduce((s, sc) => s + sc.durationSecs, 0);
        this.log(jobId, projectId, 'Rendering final video…',
          `${scenes.length} scene(s) · ~${Math.round(totalSecs)}s · voice: ${voicePath ? 'yes' : 'no'} · music: ${musicPath ? 'yes' : 'no'} · captions: ${subtitlePath ? 'burned' : 'none'} · preset: ${preset}`);
        this.events.emitJobUpdate(jobId, { step: 'RENDER', status: 'RUNNING', scenes: scenes.length }, projectId);

        const renderKey = `renders/${projectId}/final-${preset.toLowerCase()}.mp4`;
        const outPath = this.storage.resolve(renderKey);
        try {
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
            ...(sfxPath && sfxTimestamps.length > 0 ? { sfx: { path: sfxPath, atSecs: sfxTimestamps } } : {}),
          });
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
            durationMs: Math.round(totalSecs * 1000),
          },
        });
        await this.prisma.asset.update({ where: { id: renderAsset.id }, data: { currentVersionId: renderVersion.id } });

        this.log(jobId, projectId, 'Final video rendered ✓',
          `${(stat.size / 1024 / 1024).toFixed(1)} MB · ${Math.round(totalSecs)}s · ${Math.round((Date.now() - t0) / 1000)}s render time · preset ${preset}`);
        await this.jobs.logStep(jobId, 'RenderWorker', 'compose', { scenes: scenes.length, preset }, { renderKey, sizeBytes: stat.size }, 0, 0, Date.now() - t0);
        this.events.emitJobUpdate(jobId, { step: 'RENDER', status: 'COMPLETED' }, projectId);
        return {
          assetId: renderAsset.id,
          versionId: renderVersion.id,
          key: renderKey,
          sizeBytes: stat.size,
          durationSecs: Math.round(totalSecs),
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
            const result = await this.dispatch(stage.type, projectId, child.id, stagePayload);
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

      default:
        throw new Error(`Unknown job type: ${String(type)}`);
    }
  }
}
