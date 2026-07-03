import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../decorators/current-user.decorator';

@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    if (req.user?.role !== 'OWNER') throw new ForbiddenException('Owner access required');
    return true;
  }
}
