import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../../types/auth-user';

export const ROLES_KEY = 'roles';

/** Roles required on top of JwtAuthGuard, e.g. `@Roles('admin')`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user) throw new UnauthorizedException('unauthorized');
    const missing = required.find((r) => !user.roles.includes(r));
    if (missing) throw new ForbiddenException(`${missing} role required`);
    return true;
  }
}
