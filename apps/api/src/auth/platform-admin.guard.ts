import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRole } from '@mya/db';
import type { AuthUser } from './auth.types.js';

const RANK: Record<PlatformRole, number> = { user: 0, support: 1, admin: 2, superadmin: 3 };
export const PLATFORM_ROLE = 'platformRole';
/** Minimum platform role for an /admin endpoint. Enforced server-side on every request. */
export const RequirePlatformRole = (role: Exclude<PlatformRole, 'user'>) => SetMetadata(PLATFORM_ROLE, role);

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const min = this.reflector.getAllAndOverride<PlatformRole | undefined>(PLATFORM_ROLE, [ctx.getHandler(), ctx.getClass()]);
    if (!min) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw new ForbiddenException();
    // Customers get 404 so the admin surface isn't discoverable.
    if (RANK[user.platformRole] === 0) throw new NotFoundException();
    if (RANK[user.platformRole] < RANK[min]) throw new ForbiddenException(`Requires ${min}`);
    return true;
  }
}
