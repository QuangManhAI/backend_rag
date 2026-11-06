import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../../types/auth-user';

export const ADMIN_ROLE_REQUIRED = 'admin role required';

/** Defense in depth: `RolesGuard` already rejects non-admins at the HTTP layer (AGENTS.md §3.8). */
export function assertAdmin(actor: AuthUser): void {
  if (!actor.roles.includes('admin')) {
    throw new ForbiddenException(ADMIN_ROLE_REQUIRED);
  }
}
