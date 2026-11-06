import type { LeanUser } from '../auth/schemas/user.schema';

/** Public admin view of a user. Never exposes `password_hash`. */
export function toAdminUserDto(u: LeanUser): Record<string, unknown> {
  return {
    id: u._id.toString(),
    email: u.email,
    display_name: u.display_name,
    roles: u.roles,
    is_active: u.is_active,
    disabled_at: u.disabled_at ? u.disabled_at.toISOString() : null,
    disabled_reason: u.disabled_reason,
    token_version: u.token_version,
    last_login_at: u.last_login_at ? u.last_login_at.toISOString() : null,
    created_at: u.created_at.toISOString(),
  };
}

/** The lock state of an account, as the audit trail records it. */
export const lockState = (u: LeanUser) => ({
  is_active: u.is_active,
  disabled_at: u.disabled_at,
  disabled_reason: u.disabled_reason,
});
