import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../common/guards/permissions.guard';
import { CurrentUser, type JwtPayload } from '../../common/decorators/current-user.decorator';
import { PublishAccessService } from './publish-access.service';

@ApiTags('publish-access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('publish-access')
export class PublishAccessController {
  constructor(private readonly svc: PublishAccessService) {}

  /** GET /publish-access/me — any authenticated user */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.svc.myStatus(user.sub, user.role);
  }

  /** POST /publish-access/request — any authenticated user */
  @Post('request')
  request(@CurrentUser() user: JwtPayload) {
    return this.svc.request(user.sub, user.role);
  }

  /** GET /publish-access/requests — admins/owners only */
  @Get('requests')
  @RequirePermissions('publish:manage')
  listAll() {
    return this.svc.listAll();
  }

  /** POST /publish-access/requests/:userId/approve — admins/owners only */
  @Post('requests/:userId/approve')
  @RequirePermissions('publish:manage')
  approve(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return this.svc.decide(userId, true, user.sub);
  }

  /** POST /publish-access/requests/:userId/deny — admins/owners only */
  @Post('requests/:userId/deny')
  @RequirePermissions('publish:manage')
  deny(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return this.svc.decide(userId, false, user.sub);
  }

  /** POST /publish-access/grants/:userId/revoke — admins/owners only */
  @Post('grants/:userId/revoke')
  @RequirePermissions('publish:manage')
  revoke(@Param('userId') userId: string, @CurrentUser() user: JwtPayload) {
    return this.svc.revoke(userId, user.sub);
  }
}
