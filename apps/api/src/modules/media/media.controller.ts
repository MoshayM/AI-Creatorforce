import { Controller, Get, Param, Query, Req, UseGuards, StreamableFile, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from './storage.service';
import { ExportsService } from './exports.service';
import { SignedMediaOrJwtGuard } from './signed-media.guard';
import { clampTtl, signMedia, signingSecret } from './signed-url.util';

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', png: 'image/png',
  jpg: 'image/jpeg', srt: 'text/plain', vtt: 'text/vtt', md: 'text/markdown',
  txt: 'text/plain', json: 'application/json',
};

function mimeFor(name: string): string {
  return MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

type MediaRequest = Request & { signedMediaAccess?: boolean; user?: JwtPayload };

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly exportsSvc: ExportsService,
  ) {}

  // Signed access (docs4/09): file routes accept `?exp=&sig=` OR a JWT.
  // @Public neutralises the controller-level JWT guard; SignedMediaOrJwtGuard
  // still enforces JWT when no valid signature is presented.
  @Public()
  @UseGuards(SignedMediaOrJwtGuard)
  @Get('versions/:versionId/file')
  async versionFile(
    @Param('versionId') versionId: string,
    @Req() req: MediaRequest,
  ): Promise<StreamableFile> {
    const version = await this.prisma.assetVersion.findUnique({
      where: { id: versionId },
      include: { asset: { include: { project: { select: { userId: true } } } } },
    });
    // Signature access proved ownership at issuance; JWT access proves it here.
    // (The JWT payload carries the user id in `sub` — there is no `id` field.)
    const authorized =
      req.signedMediaAccess === true || version?.asset.project.userId === req.user?.sub;
    if (!version?.r2Key || !authorized || !this.storage.exists(version.r2Key)) {
      throw new NotFoundException('Asset file not found');
    }
    const name = version.r2Key.split('/').pop() ?? 'file';
    return new StreamableFile(this.storage.stream(version.r2Key), {
      type: mimeFor(name),
      disposition: `attachment; filename="${name}"`,
    });
  }

  /** Expiring capability URL for an asset-version file (docs4/09). */
  @Get('versions/:versionId/signed-url')
  async versionSignedUrl(
    @Param('versionId') versionId: string,
    @CurrentUser() user: JwtPayload,
    @Query('ttl') ttl?: string,
  ) {
    const version = await this.prisma.assetVersion.findUnique({
      where: { id: versionId },
      select: { r2Key: true, asset: { select: { project: { select: { userId: true } } } } },
    });
    if (!version?.r2Key || version.asset.project.userId !== user.sub) {
      throw new NotFoundException('Asset file not found');
    }
    return this.issueSignedUrl(`version:${versionId}`, `/media/versions/${versionId}/file`, ttl);
  }

  @Get('exports/:projectId')
  async listExports(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.assertOwner(projectId, user.sub);
    return this.exportsSvc.list(projectId);
  }

  @Public()
  @UseGuards(SignedMediaOrJwtGuard)
  @Get('exports/:projectId/:fileName')
  async exportFile(
    @Param('projectId') projectId: string,
    @Param('fileName') fileName: string,
    @Req() req: MediaRequest,
  ): Promise<StreamableFile> {
    if (req.signedMediaAccess !== true) await this.assertOwner(projectId, req.user?.sub ?? '');
    return new StreamableFile(this.exportsSvc.fileStream(projectId, fileName), {
      type: mimeFor(fileName),
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  /** Expiring capability URL for a project export file (docs4/09). */
  @Get('exports/:projectId/:fileName/signed-url')
  async exportSignedUrl(
    @Param('projectId') projectId: string,
    @Param('fileName') fileName: string,
    @CurrentUser() user: JwtPayload,
    @Query('ttl') ttl?: string,
  ) {
    await this.assertOwner(projectId, user.sub);
    return this.issueSignedUrl(
      `export:${projectId}/${fileName}`,
      `/media/exports/${projectId}/${fileName}`,
      ttl,
    );
  }

  private issueSignedUrl(resource: string, path: string, ttlRaw: string | undefined) {
    const ttl = clampTtl(ttlRaw !== undefined ? parseInt(ttlRaw, 10) : undefined);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const sig = signMedia(resource, exp, signingSecret());
    return {
      url: `/api/v1${path}?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  private async assertOwner(projectId: string, userId: string): Promise<void> {
    if (!userId) throw new NotFoundException('Project not found');
    const project = await this.prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');
  }
}
