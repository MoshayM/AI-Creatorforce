import { Injectable, BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import {
  callAIStructured, CopilotDecisionSchema, JobTypeSchema,
  type CopilotCommand, type CopilotChatRequest, type JobType,
  EXPENSIVE_ACTIONS,
} from '@cf/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { ShortsStudioService } from '../shorts-studio/shorts-studio.service';
import { ClipRecommendationService } from '../shorts-studio/clip-recommendation.service';
import { ShortsGenerationService } from '../shorts-studio/shorts-generation.service';

const COPILOT_SYSTEM = `You are the CreatorForce Copilot — you drive a YouTube content platform for the user by emitting commands.

Rules:
- Emit AT MOST ONE command per turn, chosen from the schema. If no action is needed, set command to null and just answer.
- If the request is ambiguous (which project? which video?), set command to null and ask ONE clarifying question — never guess ids.
- Use ids from the CONTEXT block only. Never invent ids.
- Expensive actions (full production runs, video analysis, renders) will require the user's confirmation — still emit the command; the platform handles the confirmation step.
- reply is what the user reads: say what you understood and what will happen, in one or two sentences. Plain language, no JSON.

Command palette:
- list_projects — show the user's projects
- get_status {projectId} — job/pipeline status for a project
- run_production {projectId, scope, topic?} — run the long-form pipeline (scope: FULL|SCRIPT|VOICE|MUSIC|IMAGES|VIDEO)
- retry_stage {projectId, stage} — re-run one pipeline stage (stage is a JobType like RESEARCH, RENDER, MUSIC_GENERATE)
- cancel_job {jobId}
- analyze_video {importedVideoId} — run the Shorts analysis pipeline
- list_highlights {importedVideoId, limit} — top Shorts moments for an analyzed video
- generate_clips {highlightId, clipTypes} — create candidate Shorts clips
- render_clip {shortClipId} — render a clip to vertical video
- generate_captions {shortClipId}
- clip_status {shortClipId}

Respond only with valid JSON.`;

export interface CopilotResponse {
  reply: string;
  executed?: { action: string; result: unknown };
  needsConfirmation?: CopilotCommand;
}

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly shorts: ShortsStudioService,
    private readonly recommendations: ClipRecommendationService,
    private readonly generation: ShortsGenerationService,
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
    // Confirmation round-trip: the client re-sends the exact command the user
    // approved — no second LLM call, no reinterpretation.
    if (req.confirmedCommand) {
      const result = await this.execute(userId, req.confirmedCommand);
      return {
        reply: result.summary,
        executed: { action: req.confirmedCommand.action, result: result.data },
      };
    }

    const context = await this.buildContext(userId);
    const decision = await callAIStructured(
      [
        ...req.messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        {
          role: 'user' as const,
          content: `CONTEXT (current platform state — use these ids):\n${context}\n\nRespond with JSON: {"reply":"...","command":{...}|null}`,
        },
      ],
      CopilotDecisionSchema,
      { systemPrompt: COPILOT_SYSTEM, maxTokens: 1024 },
    );

    if (!decision.command) return { reply: decision.reply };

    // Expensive/destructive commands stop at the confirmation gate (§8.2)
    if (EXPENSIVE_ACTIONS.includes(decision.command.action)) {
      return { reply: decision.reply, needsConfirmation: decision.command };
    }

    const result = await this.execute(userId, decision.command);
    return {
      reply: `${decision.reply}\n\n${result.summary}`.trim(),
      executed: { action: decision.command.action, result: result.data },
    };
  }

  /** Compact project-state JSON (§3.6 token rules): ids the model may use. */
  private async buildContext(userId: string): Promise<string> {
    const [projects, videos, recentJobs] = await Promise.all([
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
    ]);
    return JSON.stringify({
      projects,
      importedVideos: videos.map((v) => ({ id: v.id, title: v.title.slice(0, 60), topics: v._count.topicSegments })),
      recentJobs,
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
    }
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
