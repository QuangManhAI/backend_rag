import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { decodeCursor, encodeCursor } from '../common/pagination';
import { isUuid } from '../common/uuid';
import type { AuthUser } from '../types/auth-user';
import {
  AdminAuditLog,
  AUDIT_ACTIONS,
  AuditAction,
  AuditTargetType,
} from './schemas/admin-audit-log.schema';

export const USER_NOT_FOUND = 'user not found';

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

/** The request shape the controller hands to the service for audit purposes. */
export interface AuditRequest {
  ip?: string;
  id?: string | number;
}

/**
 * The immutable audit trail (prompt_security S4.1, D2).
 *
 * There is deliberately **no** service method that deletes or edits an audit record: the trail is
 * append-only. The only read path is `listAuditLogs`.
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    @InjectModel(AdminAuditLog.name)
    private readonly auditLogs: Model<AdminAuditLog>,
  ) {}

  /**
   * Appends one audit record. Best-effort: a failure here must never break the admin action
   * itself, but it is logged loudly.
   */
  async writeAudit(
    actor: AuthUser,
    action: AuditAction,
    targetType: AuditTargetType,
    targetId: string | null,
    before: unknown,
    after: unknown,
    req?: AuditRequest,
  ): Promise<void> {
    try {
      await this.auditLogs.create({
        actor_id: new Types.ObjectId(actor.id),
        actor_email: actor.email ?? 'unknown',
        action,
        target_type: targetType,
        target_id: targetId,
        before: before ?? null,
        after: after ?? null,
        ip: req?.ip ?? null,
        request_id: req?.id === undefined ? null : String(req.id),
      });
    } catch (e) {
      this.logger.error(
        { err: e, action, actor_id: actor.id, target_id: targetId },
        'ADMIN_AUDIT_WRITE_FAILED',
      );
    }
  }

  /** Cursor-paginated read of the trail. */
  async listAuditLogs(
    actor: AuthUser,
    limit: number,
    cursor: string | undefined,
    actorId: string | undefined,
    action: string | undefined,
    req?: AuditRequest,
  ): Promise<{
    items: Record<string, unknown>[];
    next_cursor: string | null;
    has_more: boolean;
  }> {
    const filter: Record<string, unknown> = {};
    if (actorId) {
      if (!Types.ObjectId.isValid(actorId)) {
        throw new NotFoundException(USER_NOT_FOUND);
      }
      filter.actor_id = new Types.ObjectId(actorId);
    }
    if (action) filter.action = action;
    if (cursor) {
      const c = decodeCursor(cursor, isCursor);
      const m = new Date(c.m);
      filter.$or = [
        { created_at: { $lt: m } },
        { created_at: m, _id: { $lt: new Types.ObjectId(c.id) } },
      ];
    }
    const rows = await this.auditLogs
      .find(filter)
      .sort({ created_at: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    await this.writeAudit(
      actor,
      AUDIT_ACTIONS.AUDIT_LOG_VIEW,
      'system',
      null,
      null,
      null,
      req,
    );
    return {
      items: page.map((r) => ({
        id: r._id.toString(),
        actor_id: r.actor_id.toString(),
        actor_email: r.actor_email,
        action: r.action,
        target_type: r.target_type,
        target_id: r.target_id,
        before: r.before ?? null,
        after: r.after ?? null,
        ip: r.ip,
        request_id: r.request_id,
        created_at: r.created_at.toISOString(),
      })),
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
}
