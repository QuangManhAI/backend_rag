import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import { RefreshToken } from '../auth/schemas/refresh-token.schema';
import { LeanUser, User } from '../auth/schemas/user.schema';
import {
  allOf,
  FilterField,
  keysetFilter,
  ListSpec,
  mongoSort,
  parseFilters,
  parseSort,
  toCursorPage,
} from '../../common/pagination/pagination';
import { escapeRegex } from '../../common/security/sanitize';
import type { AuthUser, Role } from '../../types/auth-user';
import { AdminAuditService, type AuditRequest } from './admin-audit.service';
import { ADMIN_ROLES, ListAdminUsersQueryDto } from './dto/admin.dto';
import { lockState, toAdminUserDto } from './admin-user.mapper';
import { assertAdmin } from './assert-admin';

export const USER_NOT_FOUND = 'user not found';
export const SELF_LOCKOUT_FORBIDDEN = 'SELF_LOCKOUT_FORBIDDEN';
export const LAST_ADMIN_PROTECTED = 'LAST_ADMIN_PROTECTED';
export const VALIDATION_ERROR = 'validation error';

const USER_LIST: ListSpec = {
  sortable: { created_at: 'date', email: 'string' },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
  idType: 'objectId',
};
const USER_FILTERS: Record<string, FilterField> = {
  role: {
    type: 'string',
    path: 'roles',
    ops: ['eq', 'ne'],
    values: ADMIN_ROLES,
  },
  is_active: { type: 'boolean' },
  email: { type: 'string' },
  created_at: { type: 'date' },
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

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
    query: ListAdminUsersQueryDto,
    req?: AuditRequest,
  ): Promise<{
    items: Record<string, unknown>[];
    next_cursor: string | null;
    has_more: boolean;
  }> {
    assertAdmin(actor);
    const terms = parseSort(query.sort, USER_LIST);
    const conditions = parseFilters(query, USER_FILTERS);
    const trimmedQ = query.q?.trim() ?? '';
    if (trimmedQ) {
      conditions.push({
        $or: [
          { email: { $regex: escapeRegex(trimmedQ), $options: 'i' } },
          { display_name: { $regex: escapeRegex(trimmedQ), $options: 'i' } },
        ],
      });
    }
    if (query.cursor) {
      conditions.push(keysetFilter(query.cursor, terms, USER_LIST));
    }
    const rows = await this.users
      .find(allOf({}, conditions))
      .sort(mongoSort(terms))
      .limit(query.limit + 1)
      .lean();
    await this.audit.writeAudit(
      actor,
      'USER_LIST_VIEW',
      'user',
      null,
      null,
      null,
      req,
    );
    return toCursorPage(rows as LeanUser[], query.limit, terms, toAdminUserDto);
  }

  // ---------------------------------------------------------------- A2 · user detail

  async getUser(
    actor: AuthUser,
    id: string,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    assertAdmin(actor);
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
    assertAdmin(actor);
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
    // Idempotent PUT: the same roles again must not kill the user's live tokens.
    if (sameSet(target.roles, unique)) return toAdminUserDto(target);
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

  /**
   * `PUT /admin/users/:id/status`. Idempotent: asking for the state the account is already in writes
   * nothing, so it neither kills live tokens nor overwrites who locked the account nor adds audit
   * noise. The one exception is locking again with another reason, which only updates the reason.
   */
  async setUserStatus(
    actor: AuthUser,
    id: string,
    active: boolean,
    reason: string | undefined,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    assertAdmin(actor);
    if (active && reason !== undefined) {
      throw new BadRequestException('reason is only allowed when locking');
    }
    this.assertNotSelf(actor, id);
    const target = await this.resolveUser(id);
    if (active) {
      if (target.is_active) return toAdminUserDto(target);
      return this.enableUser(actor, id, target, req);
    }
    if (target.is_active)
      return this.disableUser(actor, id, target, reason, req);
    if (reason === undefined || reason === target.disabled_reason) {
      return toAdminUserDto(target);
    }
    await this.users.updateOne(
      { _id: target._id },
      { $set: { disabled_reason: reason } },
    );
    this.invalidateAuthCaches(id, target.email);
    await this.audit.writeAudit(
      actor,
      'USER_DISABLE',
      'user',
      id,
      { disabled_reason: target.disabled_reason },
      { disabled_reason: reason },
      req,
    );
    return toAdminUserDto(await this.resolveUser(id));
  }

  private async disableUser(
    actor: AuthUser,
    id: string,
    target: LeanUser,
    reason: string | undefined,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    await this.assertNotLastAdmin(target);
    const before = lockState(target);
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

  private async enableUser(
    actor: AuthUser,
    id: string,
    target: LeanUser,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    const before = lockState(target);
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
    assertAdmin(actor);
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
    assertAdmin(actor);
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
