import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoginAttempt } from '../auth/schemas/login-attempt.schema';
import { User } from '../auth/schemas/user.schema';
import { ChatMessage } from '../chat-sessions/schemas/chat-message.schema';
import { ChatSession } from '../chat-sessions/schemas/chat-session.schema';
import {
  allOf,
  FilterField,
  keysetFilter,
  ListQueryDto,
  ListSpec,
  mongoSort,
  parseFilters,
  parseSort,
  toCursorPage,
} from '../common/pagination';
import { escapeRegex } from '../common/sanitize';
import { isUuid } from '../common/uuid';
import { HealthService } from '../health/health.service';
import { LLM_PORT, type LlmPort } from '../llm/llm.service';
import type { AuthUser } from '../types/auth-user';
import { AdminAuditService, type AuditRequest } from './admin-audit.service';
import { ListSessionsQueryDto, LoginAttemptsQueryDto } from './admin.dto';
import { assertAdmin } from './assert-admin';

export const SESSION_NOT_FOUND = 'session not found';

const MAX_ADMIN_MESSAGES = 200;

const SESSION_LIST: ListSpec = {
  sortable: { last_message_at: 'date', created_at: 'date', title: 'string' },
  defaultSort: [{ field: 'last_message_at', dir: 'desc' }],
  idType: 'uuid',
};
const MESSAGE_LIST: ListSpec = {
  sortable: { created_at: 'date' },
  defaultSort: [{ field: 'created_at', dir: 'asc' }],
  idType: 'uuid',
};
const ATTEMPT_LIST: ListSpec = {
  sortable: { created_at: 'date' },
  defaultSort: [{ field: 'created_at', dir: 'desc' }],
  idType: 'objectId',
};
const CREATED_AT_FILTER: Record<string, FilterField> = {
  created_at: { type: 'date' },
};

/**
 * Operational read-only views for admins (prompt_security S6): chat sessions, system statistics,
 * login attempts and the detailed health check.
 *
 * Every method here is **read-only** — the admin surface deliberately has no delete endpoints
 * (the "violating content" requirement only asked for visibility).
 */
@Injectable()
export class AdminOpsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(ChatSession.name)
    private readonly sessions: Model<ChatSession>,
    @InjectModel(ChatMessage.name)
    private readonly messages: Model<ChatMessage>,
    @InjectModel(LoginAttempt.name)
    private readonly attempts: Model<LoginAttempt>,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    private readonly health: HealthService,
    private readonly audit: AdminAuditService,
  ) {}

  // ---------------------------------------------------------------- B1 · user sessions

  async listUserSessions(
    actor: AuthUser,
    userId: string,
    query: ListSessionsQueryDto,
    req?: AuditRequest,
  ): Promise<{
    items: Record<string, unknown>[];
    next_cursor: string | null;
    has_more: boolean;
  }> {
    assertAdmin(actor);
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('user not found');
    }
    const terms = parseSort(query.sort, SESSION_LIST);
    const conditions = parseFilters(query, CREATED_AT_FILTER);
    const trimmedQ = query.q?.trim() ?? '';
    if (trimmedQ) {
      conditions.push({
        title: { $regex: escapeRegex(trimmedQ), $options: 'i' },
      });
    }
    if (query.cursor) {
      conditions.push(keysetFilter(query.cursor, terms, SESSION_LIST));
    }
    const rows = await this.sessions
      .find(
        allOf(
          { user_id: new Types.ObjectId(userId), deleted_at: null },
          conditions,
        ),
      )
      .sort(mongoSort(terms))
      .limit(query.limit + 1)
      .lean();
    await this.audit.writeAudit(
      actor,
      'USER_SESSIONS_VIEW',
      'user',
      userId,
      null,
      null,
      req,
    );
    return toCursorPage(rows, query.limit, terms, (s) => ({
      id: s._id,
      user_id: s.user_id.toString(),
      title: s.title,
      message_count: s.message_count,
      last_message_at: (s.last_message_at ?? s.created_at).toISOString(),
      created_at: s.created_at.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- B1b · session detail

  async getSession(
    actor: AuthUser,
    sessionId: string,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    assertAdmin(actor);
    if (!isUuid(sessionId)) throw new NotFoundException(SESSION_NOT_FOUND);
    const session = await this.sessions
      .findOne({ _id: sessionId, deleted_at: null })
      .lean();
    if (!session) throw new NotFoundException(SESSION_NOT_FOUND);
    const msgs = await this.messages
      .find({ session_id: sessionId, deleted_at: null })
      .sort({ created_at: -1, _id: -1 })
      .limit(MAX_ADMIN_MESSAGES)
      .lean();
    await this.audit.writeAudit(
      actor,
      'SESSION_VIEW',
      'session',
      sessionId,
      null,
      null,
      req,
    );
    return {
      id: session._id,
      user_id: session.user_id.toString(),
      title: session.title,
      message_count: session.message_count,
      last_message_at: (
        session.last_message_at ?? session.created_at
      ).toISOString(),
      created_at: session.created_at.toISOString(),
      messages: msgs.reverse().map((m) => ({
        id: m._id,
        role: m.role,
        content: m.content,
        created_at: m.created_at.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------- B1c · session messages

  async listSessionMessages(
    actor: AuthUser,
    sessionId: string,
    query: ListQueryDto,
    req?: AuditRequest,
  ): Promise<{
    items: Record<string, unknown>[];
    next_cursor: string | null;
    has_more: boolean;
  }> {
    assertAdmin(actor);
    if (!isUuid(sessionId)) throw new NotFoundException(SESSION_NOT_FOUND);
    const terms = parseSort(query.sort, MESSAGE_LIST);
    const [session, rows] = await Promise.all([
      this.sessions.exists({ _id: sessionId, deleted_at: null }),
      this.messages
        .find(
          allOf(
            { session_id: sessionId, deleted_at: null },
            query.cursor
              ? [keysetFilter(query.cursor, terms, MESSAGE_LIST)]
              : [],
          ),
        )
        .sort(mongoSort(terms))
        .limit(query.limit + 1)
        .lean(),
    ]);
    if (!session) throw new NotFoundException(SESSION_NOT_FOUND);
    await this.audit.writeAudit(
      actor,
      'SESSION_VIEW',
      'session',
      sessionId,
      null,
      null,
      req,
    );
    return toCursorPage(rows, query.limit, terms, (m) => ({
      id: m._id,
      role: m.role,
      content: m.content,
      created_at: m.created_at.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- C1 · stats

  async getStats(
    actor: AuthUser,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    assertAdmin(actor);
    const [
      usersTotal,
      usersActive,
      usersDisabled,
      adminsActive,
      sessionsTotal,
      messagesTotal,
    ] = await Promise.all([
      this.users.countDocuments({}),
      this.users.countDocuments({ is_active: true }),
      this.users.countDocuments({ is_active: false }),
      this.users.countDocuments({ roles: 'admin', is_active: true }),
      this.sessions.countDocuments({ deleted_at: null }),
      this.messages.countDocuments({ deleted_at: null }),
    ]);
    const s = this.llm.status();
    await this.audit.writeAudit(
      actor,
      'STATS_VIEW',
      'system',
      null,
      null,
      null,
      req,
    );
    return {
      users_total: usersTotal,
      users_active: usersActive,
      users_disabled: usersDisabled,
      admins_active: adminsActive,
      sessions_total: sessionsTotal,
      messages_total: messagesTotal,
      uptime_s: Math.floor(process.uptime()),
      llm: {
        model_id: s.model_id,
        gpu: s.gpu,
        queue_length: s.queue_length,
        running: s.running,
      },
    };
  }

  // ---------------------------------------------------------------- C2 · login attempts

  async listLoginAttempts(
    actor: AuthUser,
    query: LoginAttemptsQueryDto,
    req?: AuditRequest,
  ): Promise<{
    items: Record<string, unknown>[];
    next_cursor: string | null;
    has_more: boolean;
  }> {
    assertAdmin(actor);
    const terms = parseSort(query.sort, ATTEMPT_LIST);
    const conditions = parseFilters(query, CREATED_AT_FILTER);
    if (query.cursor) {
      conditions.push(keysetFilter(query.cursor, terms, ATTEMPT_LIST));
    }
    const rows = await this.attempts
      .find(allOf({}, conditions))
      .sort(mongoSort(terms))
      .limit(query.limit + 1)
      .lean();
    await this.audit.writeAudit(
      actor,
      'LOGIN_ATTEMPTS_VIEW',
      'system',
      null,
      null,
      null,
      req,
    );
    return toCursorPage(rows, query.limit, terms, (r) => ({
      key: r.key,
      created_at: r.created_at.toISOString(),
    }));
  }

  // ---------------------------------------------------------------- C3 · health

  async getHealth(
    actor: AuthUser,
    req?: AuditRequest,
  ): Promise<Record<string, unknown>> {
    assertAdmin(actor);
    const h = await this.health.health();
    await this.audit.writeAudit(
      actor,
      'HEALTH_VIEW',
      'system',
      null,
      null,
      null,
      req,
    );
    return h as unknown as Record<string, unknown>;
  }
}
