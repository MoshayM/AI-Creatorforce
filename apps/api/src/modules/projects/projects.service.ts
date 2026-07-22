import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decodeCursor, keysetWhereDesc, clampLimit, pageResult } from '../../common/pagination/cursor';

export interface CreateProjectDto {
  channelId?: string;
  title: string;
  description?: string;
  niche?: string;
  targetLang?: string;
  /** Phase 5 §10: bill agent-job spend to this org's shared wallet; null/'' clears. */
  billingOrgId?: string | null;
  contentFormat?: string;
  platforms?: string[];
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A project may only bill an org the owner belongs to. Spend-time gating
   * (SPEND role + budget) still happens in orgSpend on every job — this check
   * exists so a typo'd or foreign orgId fails at set time, not at job time.
   */
  private async resolveBillingOrgId(userId: string, billingOrgId: string | null | undefined): Promise<string | null> {
    if (!billingOrgId) return null;
    const membership = await this.prisma.orgMembership.findUnique({
      where: { orgId_userId: { orgId: billingOrgId, userId } },
    });
    if (!membership) throw new ForbiddenException('You are not a member of that organisation');
    return billingOrgId;
  }

  async create(userId: string, dto: CreateProjectDto) {
    if (dto.channelId) {
      const channel = await this.prisma.channel.findFirst({
        where: { id: dto.channelId, userId },
      });
      if (!channel) throw new ForbiddenException('Channel not found or not owned');
    }

    return this.prisma.project.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        niche: dto.niche,
        targetLang: dto.targetLang ?? 'en',
        billingOrgId: await this.resolveBillingOrgId(userId, dto.billingOrgId),
        contentFormat: dto.contentFormat,
        platforms: dto.platforms ?? [],
        ...(dto.channelId ? { channelId: dto.channelId } : {}),
      },
    });
  }

  async list(userId: string, opts: { cursor?: string; limit?: number } = {}) {
    const take = clampLimit(opts.limit, 50, 100);
    const rows = await this.prisma.project.findMany({
      where: { userId, ...keysetWhereDesc('updatedAt', decodeCursor(opts.cursor)) },
      include: {
        channel: { select: { title: true, thumbnailUrl: true } },
        _count: { select: { jobs: true, videos: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    return pageResult(rows, take, (r) => r.updatedAt);
  }

  async get(userId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        channel: { select: { id: true, title: true, thumbnailUrl: true, youtubeChannelId: true } },
        jobs: { orderBy: { createdAt: 'desc' }, take: 10 },
        videos: { orderBy: { createdAt: 'desc' } },
        approvals: { where: { status: 'PENDING' } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    // The pipeline tiles derive stage state from the latest COMPLETED job of
    // each type; those can age out of the recent-10 window above, so merge in
    // one latest-per-type row (distinct picks the first per type in desc order).
    const latestPerType = await this.prisma.agentJob.findMany({
      where: { projectId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      distinct: ['type'],
    });
    const seen = new Set(project.jobs.map((j) => j.id));
    const merged = [...project.jobs, ...latestPerType.filter((j) => !seen.has(j.id))];
    return { ...project, jobs: merged };
  }

  async update(userId: string, projectId: string, data: Partial<CreateProjectDto> & { status?: string }) {
    await this.get(userId, projectId);
    const { channelId: _channelId, status, billingOrgId, ...rest } = data;
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...rest,
        ...(status ? { status: status as import('@prisma/client').ProjectStatus } : {}),
        // Distinguish "not sent" (leave as-is) from null/'' (clear the org link)
        ...(billingOrgId !== undefined
          ? { billingOrgId: await this.resolveBillingOrgId(userId, billingOrgId) }
          : {}),
      },
    });
  }

  async delete(userId: string, projectId: string) {
    await this.get(userId, projectId);
    await this.prisma.project.delete({ where: { id: projectId } });
  }
}
