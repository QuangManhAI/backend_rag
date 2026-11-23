import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AdminAuditLog,
  AuditAction,
  AuditTargetType,
} from '../schemas/admin-audit-log.schema';

export type LeanAdminAuditLog = AdminAuditLog & { _id: Types.ObjectId };

export interface AppendAuditLogRecord {
  actor_id: Types.ObjectId;
  actor_email: string;
  action: AuditAction;
  target_type: AuditTargetType;
  target_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  request_id: string | null;
}

/**
 * Append-only audit log repository (AGENTS.md §3 #8, prompt_security S4.1).
 * Never expose update or delete methods here.
 */
@Injectable()
export class AdminAuditLogsRepository {
  constructor(
    @InjectModel(AdminAuditLog.name)
    private readonly model: Model<AdminAuditLog>,
  ) {}

  async append(record: AppendAuditLogRecord): Promise<void> {
    await this.model.create(record);
  }

  findPageLean(
    filter: Record<string, unknown>,
    sort: Record<string, 1 | -1>,
    limit: number,
  ): Promise<LeanAdminAuditLog[]> {
    return this.model.find(filter).sort(sort).limit(limit).lean();
  }
}
