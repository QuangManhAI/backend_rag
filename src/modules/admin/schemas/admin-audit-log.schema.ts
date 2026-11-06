import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

/** The audit actions recorded by the admin module (prompt_security S4.1). */
export const AUDIT_ACTIONS = {
  USER_LIST_VIEW: 'USER_LIST_VIEW',
  USER_VIEW: 'USER_VIEW',
  USER_ROLE_CHANGE: 'USER_ROLE_CHANGE',
  USER_DISABLE: 'USER_DISABLE',
  USER_ENABLE: 'USER_ENABLE',
  USER_TOKENS_REVOKE: 'USER_TOKENS_REVOKE',
  USER_TOKENS_VIEW: 'USER_TOKENS_VIEW',
  USER_SESSIONS_VIEW: 'USER_SESSIONS_VIEW',
  SESSION_VIEW: 'SESSION_VIEW',
  STATS_VIEW: 'STATS_VIEW',
  LOGIN_ATTEMPTS_VIEW: 'LOGIN_ATTEMPTS_VIEW',
  HEALTH_VIEW: 'HEALTH_VIEW',
  AUDIT_LOG_VIEW: 'AUDIT_LOG_VIEW',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditTargetType = 'user' | 'session' | 'system';

/**
 * Append-only audit trail of every admin action. There is deliberately **no** service method and
 * **no** endpoint that deletes or edits these records (S4.1 / self-protection rule S4).
 */
@Schema({
  collection: 'admin_audit_logs',
  timestamps: { createdAt: 'created_at', updatedAt: false },
  versionKey: false,
})
export class AdminAuditLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  actor_id: Types.ObjectId;

  /** Snapshot of the admin's email at the time of the action. */
  @Prop({ required: true })
  actor_email: string;

  @Prop({ required: true, index: true })
  action: AuditAction;

  @Prop({ required: true })
  target_type: AuditTargetType;

  @Prop({ type: String, default: null })
  target_id: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  before: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  after: unknown;

  @Prop({ type: String, default: null })
  ip: string | null;

  @Prop({ type: String, default: null })
  request_id: string | null;

  created_at: Date;
}

export type AdminAuditLogDocument = HydratedDocument<AdminAuditLog>;
export const AdminAuditLogSchema = SchemaFactory.createForClass(AdminAuditLog);
AdminAuditLogSchema.index({ actor_id: 1, created_at: -1 });
AdminAuditLogSchema.index({ action: 1, created_at: -1 });
AdminAuditLogSchema.index({ created_at: -1 });
