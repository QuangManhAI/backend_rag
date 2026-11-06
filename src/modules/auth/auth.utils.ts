import { createHash } from 'crypto';
import type { UserDto } from './dto/auth.dto';
import type { LeanUser, UserDocument } from './schemas/user.schema';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Short, non-reversible id of an email for logs (the email itself is never logged). */
export function emailHash(email: string): string {
  return createHash('sha256')
    .update(normalizeEmail(email))
    .digest('hex')
    .slice(0, 16);
}

export function toUserDto(u: UserDocument | LeanUser): UserDto {
  return {
    id: u._id.toString(),
    email: u.email,
    display_name: u.display_name,
    roles: u.roles,
    created_at: u.created_at.toISOString(),
  };
}
