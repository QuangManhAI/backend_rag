import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import { RefreshToken } from '../auth/schemas/refresh-token.schema';
import { User } from '../auth/schemas/user.schema';
import { decodeCursor, encodeCursor } from '../common/pagination';
import { escapeRegex } from '../common/sanitize';
import { isUuid } from '../common/uuid';
import type { AuthUser, Role } from '../types/auth-user';
import { AdminAuditService, type AuditRequest } from './admin-audit.service';

export const USER_NOT_FOUND = 'user not found';
export const ADMIN_ROLE_REQUIRED = 'admin role required';
export const SELF_LOCKOUT_FORBIDDEN = 'SELF_LOCKOUT_FORBIDDEN';
export const LAST_ADMIN_PROTECTED = 'LAST_ADMIN_PROTECTED';
export const VALIDATION_ERROR = 'validation error';

type LeanUser = User & { _id: Types.ObjectId };

interface Cursor {
  m: string;
  id: string;
}

const isCursor = (v: unknown): v is Cursor =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Cursor).m === 'string' &&
  !Number.isNaN(Date.parse((v as Cursor).m)) &&
  isUuid((v as Cursor).id);

/**
 * Identity management for admins (prompt_security S5): list / inspect users, change roles, lock and
 * unlock accounts, revoke tokens.
 *
 * Every mutating action bumps `users.token_version` and revokes every refresh token, so the
 * access tokens already in the wild die immediately instead of lingering for their TTL.
 */
@Injectable()
export class AdminIdentityService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokens: Model<RefreshToken>,
    private readonly auth: AuthService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Defense in depth: `RolesGuard` already rejects non-admins at the HTTP layer. */
  assertAdmin(actor: AuthUser): void {
    if (!actor.roles.includes('admin')) {
      throw new ForbiddenException(ADMIN_ROLE_REQUIRED);
    }
  }

  /** An admin may not remove their own admin role or lock their own account. */
  assertNotSelf(actor: AuthUser, targetId: string): void {
    if (actor.id === targetId) {
      throw new ConflictException(SELF_LOCKOUT_FORBIDDEN);
    }
  }

  async countActiveAdmins(): Promise<number> {
    return this.users.countDocuments({ roles: 'admin', is_active: true });
  }

  /**
   * The system must always keep at least one active admin: an admin account can neither be
   * demoted nor locked while it is the last one standing.
   */
  async assertNotLastAdmin(target: LeanUser): Promise<void> {
    if (!target.roles.includes('admin')) return;
    if ((await this.countActiveAdmins()) <= 1) {
      throw new ConflictException(LAST_ADMIN_PROTECTED);
    }
  }

  async resolveUser(id: string): Promise<LeanUser> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(USER_NOT_FOUND);
    }
    const user = await this.users.findById(id).lean();
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return user;
  }

  /** Drops every cached view of a user (role change, lock, password change). */
  invalidateAuthCaches(userId: string, email?: string): void {
    this.auth.invalidateUserCaches(userId, email);
  }

  /**
   * Revokes every refresh token of a user and bumps `token_version`, so the access tokens already
   * in the wild stop working at once.
   */
  async revokeAllTokens(userId: string): Promise<number> {
    return this.auth.revokeAllForUser(userId);
  }

  // ---------------------------------------------------------------- A1 · user list

  async listUsers(
    actor: AuthUser,
    q: string | undefined,
    limit: number,
    cursor: string | undefined,
    role: Role | undefined,
    active: boolean | undefined,
    req?: AuditRequest,
  ): Promise<{
    items: Record<string, unknown>[];
    next_cursor: string | null;
    has_more: boolean;
  }> {
    const filter: Record<string, unknown> = {};
    const trimmedQ = q?.trim() ?? '';
    if (trimmedQ) {
      filter.$or = [
        { email: { $regex: escapeRegex(trimmedQ), $options: 'i' } },
        { display_name: { $regex: escapeRegex(trimmedQ), $options: 'i' } },
      ];
    }
    if (role) filter.roles = role;
    if (active !== undefined) filter.is_active = active;
    if (cursor) {
      const c = decodeCursor(cursor, isCursor);
      const m = new Date(c.m);
      filter.$or = [
        ...(filter.$or ? [filter.$or] : []),
        { created_at: { $lt: m } },
        { created_at: m, _id: { $lt: new Types.ObjectId(c.id) } },
      ];
    }
    const rows = await this.users
      .find(filter)
      .sort({ created_at: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    await this.audit.writeAudit(
      actor,
      'USER_LIST_VIEW',
      'user',
      null,
      null,
      null,
      req,
    );
    return {
      items: page.map(toAdminUserDto),
      next_cursor:
        hasMore && last
          ? encodeCursor({
              m: last.created_at.toISOString(),
              id: last._id.toString(),
            })
          : null,
      has_more: hasMore,
    };
  }

  // ---------------------------------------------------------------- A2 · user detail

  async getUser(
    actor: AuthUser,
    id: string,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    const user = await this.resolveUser(id);
    const uid = new Types.ObjectId(user._id);
    const activeTokenCount = await this.refreshTokens.countDocuments({
      user_id: uid,
      revoked_at: null,
      expires_at: { $gt: new Date() },
    });
    await this.audit.writeAudit(
      actor,
      'USER_VIEW',
      'user',
      id,
      null,
      null,
      req,
    );
    return {
      ...toAdminUserDto(user),
      active_token_count: activeTokenCount,
    };
  }

  // ---------------------------------------------------------------- A3 · roles

  async changeRoles(
    actor: AuthUser,
    id: string,
    nextRoles: Role[],
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    if (!Array.isArray(nextRoles) || nextRoles.length === 0) {
      throw new BadRequestException(VALIDATION_ERROR);
    }
    const unique = Array.from(new Set(nextRoles));
    if (unique.length !== nextRoles.length) {
      throw new BadRequestException(VALIDATION_ERROR);
    }
    if (!unique.includes('user')) {
      throw new BadRequestException(VALIDATION_ERROR);
    }
    // Self-demotion would lock the acting admin out of the admin surface.
    if (id === actor.id && !unique.includes('admin')) {
      throw new ConflictException(SELF_LOCKOUT_FORBIDDEN);
    }
    const target = await this.resolveUser(id);
    if (target.roles.includes('admin') && !unique.includes('admin')) {
      await this.assertNotLastAdmin(target);
    }
    const before = { roles: target.roles };
    await this.users.updateOne(
      { _id: target._id },
      { $set: { roles: unique }, $inc: { token_version: 1 } },
    );
    await this.revokeAllTokens(id);
    this.invalidateAuthCaches(id, target.email);
    const updated = await this.resolveUser(id);
    await this.audit.writeAudit(
      actor,
      'USER_ROLE_CHANGE',
      'user',
      id,
      before,
      { roles: unique },
      req,
    );
    return toAdminUserDto(updated);
  }

  // ---------------------------------------------------------------- A4 · lock / unlock

  async disableUser(
    actor: AuthUser,
    id: string,
    reason: string | undefined,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    this.assertNotSelf(actor, id);
    const target = await this.resolveUser(id);
    await this.assertNotLastAdmin(target);
    const before = {
      is_active: target.is_active,
      disabled_at: target.disabled_at,
      disabled_reason: target.disabled_reason,
    };
    const now = new Date();
    await this.users.updateOne(
      { _id: target._id },
      {
        $set: {
          is_active: false,
          disabled_at: now,
          disabled_by: new Types.ObjectId(actor.id),
          disabled_reason: reason ?? null,
        },
        $inc: { token_version: 1 },
      },
    );
    await this.revokeAllTokens(id);
    this.invalidateAuthCaches(id, target.email);
    const updated = await this.resolveUser(id);
    await this.audit.writeAudit(
      actor,
      'USER_DISABLE',
      'user',
      id,
      before,
      {
        is_active: false,
        disabled_at: now,
        disabled_reason: reason ?? null,
      },
      req,
    );
    return toAdminUserDto(updated);
  }

  async enableUser(
    actor: AuthUser,
    id: string,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    this.assertNotSelf(actor, id);
    const target = await this.resolveUser(id);
    const before = {
      is_active: target.is_active,
      disabled_at: target.disabled_at,
      disabled_reason: target.disabled_reason,
    };
    await this.users.updateOne(
      { _id: target._id },
      {
        $set: {
          is_active: true,
          disabled_at: null,
          disabled_by: null,
          disabled_reason: null,
        },
        $inc: { token_version: 1 },
      },
    );
    this.invalidateAuthCaches(id, target.email);
    const updated = await this.resolveUser(id);
    await this.audit.writeAudit(
      actor,
      'USER_ENABLE',
      'user',
      id,
      before,
      { is_active: true, disabled_at: null, disabled_reason: null },
      req,
    );
    return toAdminUserDto(updated);
  }

  // ---------------------------------------------------------------- A6 · revoke tokens

  async revokeUserTokens(
    actor: AuthUser,
    id: string,
    req?: AuditRequest,
  ): Promise<{ revoked_count: number }> {
    const target = await this.resolveUser(id);
    const revoked = await this.revokeAllTokens(id);
    this.invalidateAuthCaches(id, target.email);
    await this.audit.writeAudit(
      actor,
      'USER_TOKENS_REVOKE',
      'user',
      id,
      { active_token_count: revoked },
      null,
      req,
    );
    return { revoked_count: revoked };
  }

  // ---------------------------------------------------------------- E1 · token families

  async listUserTokens(
    actor: AuthUser,
    id: string,
    req?: AuditRequest,
  ): Promise<{ items: Record<string, unknown>[] }> {
    const target = await this.resolveUser(id);
    const rows = await this.refreshTokens
      .find({
        user_id: target._id,
        revoked_at: null,
        expires_at: { $gt: new Date() },
      })
      .sort({ created_at: -1 })
      .lean();
    await this.audit.writeAudit(
      actor,
      'USER_TOKENS_VIEW',
      'user',
      id,
      null,
      null,
      req,
    );
    return {
      items: rows.map((r) => ({
        family_id: r.family_id,
        created_at: r.created_at.toISOString(),
        expires_at: r.expires_at.toISOString(),
      })),
    };
  }
}

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
