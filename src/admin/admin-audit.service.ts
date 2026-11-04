import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  allOf,
  FilterField,
  keysetFilter,
  ListSpec,
  mongoSort,
  parseFilters,
  parseSort,
  toCursorPage,
} from '../common/pagination';
import type { AuthUser } from '../types/auth-user';
import type { ListAuditLogsQueryDto } from './admin.dto';
import {
  AdminAuditLog,
  AUDIT_ACTIONS,
  AuditAction,
  AuditTargetType,
} from './schemas/admin-audit-log.schema';

export const USER_NOT_FOUND = 'user not found';

const AUDIT_LIST: ListSpec = {
  sortable: { created_at: 'date' },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
  idType: 'objectId',
};
const AUDIT_FILTERS: Record<string, FilterField> = {
  actor_id: { type: 'objectId' },
  action: { type: 'string' },
  target_type: { type: 'string' },
  created_at: { type: 'date' },
};

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
    query: ListAuditLogsQueryDto,
    req?: AuditRequest,
  ): Promise<{
    items: Record<string, unknown>[];
    next_cursor: string | null;
    has_more: boolean;
  }> {
    const terms = parseSort(query.sort, AUDIT_LIST);
    const conditions = parseFilters(query, AUDIT_FILTERS);
    if (query.cursor) {
      conditions.push(keysetFilter(query.cursor, terms, AUDIT_LIST));
    }
    const rows = await this.auditLogs
      .find(allOf({}, conditions))
      .sort(mongoSort(terms))
      .limit(query.limit + 1)
      .lean();
    await this.writeAudit(
      actor,
      AUDIT_ACTIONS.AUDIT_LOG_VIEW,
      'system',
      null,
      null,
      null,
      req,
    );
    return toCursorPage(rows, query.limit, terms, (r) => ({
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
    }));
  }
}
