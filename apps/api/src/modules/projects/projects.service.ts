import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface CreateProjectDto {
  channelId: string;
  title: string;
  description?: string;
  niche?: string;
  targetLang?: string;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateProjectDto) {
    const channel = await this.prisma.channel.findFirst({
      where: { id: dto.channelId, userId },
    });
    if (!channel) throw new ForbiddenException('Channel not found or not owned');

    return this.prisma.project.create({
      data: {
        userId,
        channelId: dto.channelId,
        title: dto.title,
        description: dto.description,
        niche: dto.niche,
        targetLang: dto.targetLang ?? 'en',
      },
    });
  }

  async list(userId: string) {
    return this.prisma.project.findMany({
      where: { userId },
      include: {
        channel: { select: { title: true, thumbnailUrl: true } },
        _count: { select: { jobs: true, videos: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
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
    return project;
  }

  async update(userId: string, projectId: string, data: Partial<CreateProjectDto> & { status?: string }) {
    await this.get(userId, projectId);
    const { channelId: _channelId, status, ...rest } = data;
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...rest,
        ...(status ? { status: status as import('@prisma/client').ProjectStatus } : {}),
      },
    });
  }

  async delete(userId: string, projectId: string) {
    await this.get(userId, projectId);
    await this.prisma.project.delete({ where: { id: projectId } });
  }
}
