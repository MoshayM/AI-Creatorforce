import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../decorators/current-user.decorator';

@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    // SUPER_ADMIN outranks OWNER (billing spec §9.2)
    if (req.user?.role !== 'OWNER' && req.user?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Owner access required');
    }
    return true;
  }
}
