import { Controller, Get, Param, UseGuards, StreamableFile, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from './storage.service';
import { ExportsService } from './exports.service';

const MIME_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', png: 'image/png',
  jpg: 'image/jpeg', srt: 'text/plain', vtt: 'text/vtt', md: 'text/markdown',
  txt: 'text/plain', json: 'application/json',
};

function mimeFor(name: string): string {
  return MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly exportsSvc: ExportsService,
  ) {}

  @Get('versions/:versionId/file')
  async versionFile(@Param('versionId') versionId: string, @CurrentUser() user: JwtPayload): Promise<StreamableFile> {
    const version = await this.prisma.assetVersion.findUnique({
      where: { id: versionId },
      include: { asset: { include: { project: { select: { userId: true } } } } },
    });
    // The JWT payload carries the user id in `sub` (there is no `id` field)
    if (!version?.r2Key || version.asset.project.userId !== user.sub || !this.storage.exists(version.r2Key)) {
      throw new NotFoundException('Asset file not found');
    }
    const name = version.r2Key.split('/').pop() ?? 'file';
    return new StreamableFile(this.storage.stream(version.r2Key), {
      type: mimeFor(name),
      disposition: `attachment; filename="${name}"`,
    });
  }

  @Get('exports/:projectId')
  async listExports(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    await this.assertOwner(projectId, user.sub);
    return this.exportsSvc.list(projectId);
  }

  @Get('exports/:projectId/:fileName')
  async exportFile(
    @Param('projectId') projectId: string,
    @Param('fileName') fileName: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<StreamableFile> {
    await this.assertOwner(projectId, user.sub);
    return new StreamableFile(this.exportsSvc.fileStream(projectId, fileName), {
      type: mimeFor(fileName),
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  private async assertOwner(projectId: string, userId: string): Promise<void> {
    if (!userId) throw new NotFoundException('Project not found');
    const project = await this.prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');
  }
}
