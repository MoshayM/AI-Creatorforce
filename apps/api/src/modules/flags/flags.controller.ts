import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FlagsService } from './flags.service';

class SetFlagDto {
  @IsBoolean() enabled!: boolean;
}

/**
 * Feature-flag admin surface (docs4/29): permission-string RBAC like every
 * admin route; flag changes are audit-logged before the response.
 */
@Controller('admin/flags')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FlagsController {
  constructor(
    private readonly flags: FlagsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions('admin:flags')
  async list() {
    return this.flags.list();
  }

  @Put(':key')
  @RequirePermissions('admin:flags')
  async set(
    @Param('key') key: string,
    @Body() dto: SetFlagDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    await this.flags.set(key, dto.enabled);
    await this.prisma.auditLog.create({
      data: {
        userId: admin.sub,
        action: 'admin:flag-set',
        target: key,
        meta: { enabled: dto.enabled } as never,
      },
    });
    return { key, enabled: dto.enabled };
  }
}
