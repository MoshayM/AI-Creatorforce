import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AssetKind, AssetStatus } from '@prisma/client';
import { decodeCursor, keysetWhereDesc, clampLimit, pageResult } from '../../common/pagination/cursor';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listForProject(projectId: string, userId: string, opts: { cursor?: string; limit?: number } = {}) {
    // Verify ownership
    await this.prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });

    const take = clampLimit(opts.limit, 100, 200);
    const rows = await this.prisma.asset.findMany({
      where: { projectId, deletedAt: null, ...keysetWhereDesc('createdAt', decodeCursor(opts.cursor)) },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 3,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });
    return pageResult(rows, take, (r) => r.createdAt);
  }

  async getAsset(assetId: string, userId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        project: { select: { userId: true } },
        versions: { orderBy: { version: 'desc' } },
      },
    });

    if (!asset || asset.project.userId !== userId) throw new NotFoundException('Asset not found');
    return asset;
  }

  async createAsset(projectId: string, kind: AssetKind, label: string, userId: string) {
    await this.prisma.project.findFirstOrThrow({ where: { id: projectId, userId } });
    return this.prisma.asset.create({
      data: { projectId, kind, label, status: 'BRIEFED' },
    });
  }

  async addVersion(
    assetId: string,
    data: {
      provider?: string;
      model?: string;
      prompt?: Record<string, unknown>;
      params?: Record<string, unknown>;
      provenance?: Record<string, unknown>;
      r2Key?: string;
      contentHash?: string;
      sizeBytes?: number;
      durationMs?: number;
      wordTimestamps?: unknown;
    },
    userId: string,
  ) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { project: { select: { userId: true } }, versions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 } },
    });

    if (!asset || asset.project.userId !== userId) throw new NotFoundException('Asset not found');

    const nextVersion = (asset.versions[0]?.version ?? 0) + 1;

    const version = await this.prisma.assetVersion.create({
      data: {
        assetId,
        version: nextVersion,
        provider: data.provider,
        model: data.model,
        prompt: data.prompt as never,
        params: data.params as never,
        provenance: data.provenance as never,
        r2Key: data.r2Key,
        contentHash: data.contentHash,
        durationMs: data.durationMs,
        wordTimestamps: data.wordTimestamps as never,
        sizeBytes: data.sizeBytes ? BigInt(data.sizeBytes) : BigInt(0),
      },
    });

    await this.prisma.asset.update({
      where: { id: assetId },
      data: { currentVersionId: version.id, status: 'READY' },
    });

    return version;
  }

  async updateStatus(assetId: string, status: AssetStatus, userId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { project: { select: { userId: true } } },
    });

    if (!asset || asset.project.userId !== userId) throw new NotFoundException('Asset not found');

    return this.prisma.asset.update({ where: { id: assetId }, data: { status } });
  }

  async softDelete(assetId: string, userId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { project: { select: { userId: true } } },
    });

    if (!asset || asset.project.userId !== userId) throw new NotFoundException('Asset not found');

    return this.prisma.asset.update({ where: { id: assetId }, data: { deletedAt: new Date() } });
  }
}
