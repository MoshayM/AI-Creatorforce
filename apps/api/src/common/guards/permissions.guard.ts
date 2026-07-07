import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { roleHasPermission, type Permission } from '../rbac';
import type { JwtPayload } from '../decorators/current-user.decorator';

export const PERMISSIONS_KEY = 'required_permissions';

/** Declare the permissions an endpoint needs — enforced by PermissionsGuard. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Permission-string RBAC (billing spec §9.2). Compose AFTER JwtAuthGuard so
 * req.user is populated. Fails closed: no user, unknown role, or any missing
 * permission → 403.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: JwtPayload }>().user;
    if (!user?.role) throw new ForbiddenException('Insufficient permissions');
    const missing = required.filter((p) => !roleHasPermission(user.role as UserRole, p));
    if (missing.length > 0) throw new ForbiddenException('Insufficient permissions');
    return true;
  }
}
