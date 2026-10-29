import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { LRUCache } from 'lru-cache';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { decodeCursor, encodeCursor } from '../common/pagination';
import { logEvent } from '../common/request-context';
import { isUuid, uuidv7 } from '../common/uuid';
import {
  MessageDto,
  SessionDto,
  SessionPageDto,
  SessionSummaryDto,
} from './dto/chat-session.dto';
import { ChatMessage } from './schemas/chat-message.schema';
import {
  ChatSession,
  ChatSessionDocument,
} from './schemas/chat-session.schema';
import type {
  AssistantMessageInput,
  SavedExchange,
  SessionStorePort,
} from './session-store.port';

export const SESSION_NOT_FOUND = 'session not found';
export const SESSION_PAGE_SIZE = 10;
export const TITLE_MAX = 120;
export const MAX_MESSAGES = 200;
export const UTC7_OFFSET_MS = 7 * 60 * 60 * 1000;
const SESSION_CACHE_TTL_MS = 300_000;

interface SessionCursor {
  m: string;
  id: string;
}

const isCursor = (v: unknown): v is SessionCursor =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as SessionCursor).m === 'string' &&
  !Number.isNaN(Date.parse((v as SessionCursor).m)) &&
  isUuid((v as SessionCursor).id);

/** Unicode-aware length (an emoji counts as one character). */
const charLength = (s: string) => Array.from(s).length;

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Trimmed title of 1–120 characters, else 400 `invalid title`. */
export function validTitle(raw: string): string {
  const t = raw.trim();
  if (!t || charLength(t) > TITLE_MAX)
    throw new BadRequestException('invalid title');
  return t;
}

/** Default session title: `YY-MM-DD:HH-MM-SS` in UTC+07 (e.g. `26-10-19:14-28-33`). */
export function formatTimestampTitle(date: Date = new Date()): string {
  const utc7 = new Date(date.getTime() + UTC7_OFFSET_MS);
  const yy = String(utc7.getUTCFullYear()).slice(-2);
  const mm = String(utc7.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc7.getUTCDate()).padStart(2, '0');
  const hh = String(utc7.getUTCHours()).padStart(2, '0');
  const min = String(utc7.getUTCMinutes()).padStart(2, '0');
  const ss = String(utc7.getUTCSeconds()).padStart(2, '0');
  return `${yy}-${mm}-${dd}:${hh}-${min}-${ss}`;
}

function toSummary(
  s: ChatSessionDocument | (ChatSession & { _id: string }),
): SessionSummaryDto {
  const lastMsgAt = s.last_message_at ?? s.created_at;
  return {
    id: s._id,
    title: s.title,
    message_count: s.message_count,
    last_message_at: lastMsgAt.toISOString(),
    created_at: s.created_at.toISOString(),
    updated_at: s.updated_at.toISOString(),
  };
}

function toMessage(m: ChatMessage & { _id: string }): MessageDto {
  const updatedAt = m.updated_at ?? m.created_at;
  const out: MessageDto = {
    id: m._id,
    role: m.role,
    content: m.content,
    created_at: m.created_at.toISOString(),
    updated_at: updatedAt.toISOString(),
  };
  if (m.role === 'assistant') {
    out.citations = m.citations ?? [];
    out.grounded_chunks = m.grounded_chunks ?? [];
    if (m.timings) out.timings = m.timings;
  }
  return out;
}

/** Error of a transaction on a standalone server (IllegalOperation, code 20). */
export function isTransactionUnsupported(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown };
  return (
    err?.code === 20 ||
    (typeof err?.message === 'string' &&
      /Transaction numbers are only allowed on a replica set|transactions are not supported/i.test(
        err.message,
      ))
  );
}

@Injectable()
export class ChatSessionsService implements SessionStorePort {
  private readonly logger = new Logger(ChatSessionsService.name);
  /** Cleared the first time the server refuses a transaction (standalone MongoDB). */
  private transactions = true;
  private readonly cacheEnabled = !process.env.JEST_WORKER_ID;
  private readonly userGen = new Map<string, number>();
  private readonly listCache = new LRUCache<string, SessionPageDto>({
    max: 10_000,
    ttl: SESSION_CACHE_TTL_MS,
    updateAgeOnGet: true,
  });
  private readonly sessionDetailCache = new LRUCache<string, SessionDto>({
    max: 10_000,
    ttl: SESSION_CACHE_TTL_MS,
    updateAgeOnGet: true,
  });
  private readonly inflightDetail = new Map<string, Promise<SessionDto>>();

  constructor(
    @InjectModel(ChatSession.name)
    private readonly sessions: Model<ChatSession>,
    @InjectModel(ChatMessage.name)
    private readonly messages: Model<ChatMessage>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private bumpUserGen(userId: string): void {
    this.userGen.set(userId, (this.userGen.get(userId) ?? 0) + 1);
  }

  async list(
    userId: string,
    cursor?: string,
    q?: string,
  ): Promise<SessionPageDto> {
    const trimmedQ = q?.trim() ?? '';
    const gen = this.userGen.get(userId) ?? 0;
    const cacheKey = `${userId}:${gen}:${cursor ?? ''}:${trimmedQ.toLowerCase()}`;
    if (this.cacheEnabled) {
      const cached = this.listCache.get(cacheKey);
      if (cached) return cached;
    }
    const filter: Record<string, unknown> = {
      user_id: new Types.ObjectId(userId),
      deleted_at: null,
      message_count: { $gt: 0 },
    };
    if (trimmedQ)
      filter.title = { $regex: escapeRegex(trimmedQ), $options: 'i' };
    if (cursor) {
      const c = decodeCursor(cursor, isCursor);
      const m = new Date(c.m);
      filter.$or = [
        { last_message_at: { $lt: m } },
        { last_message_at: m, _id: { $lt: c.id } },
      ];
    }
    const rows = await this.sessions
      .find(filter)
      .sort({ last_message_at: -1, _id: -1 })
      .limit(SESSION_PAGE_SIZE + 1)
      .lean();
    const hasMore = rows.length > SESSION_PAGE_SIZE;
    const page = rows.slice(0, SESSION_PAGE_SIZE);
    const last = page.at(-1);
    const result: SessionPageDto = {
      items: page.map(toSummary),
      next_cursor:
        hasMore && last
          ? encodeCursor({
              m: (last.last_message_at ?? last.created_at).toISOString(),
              id: last._id,
            })
          : null,
      has_more: hasMore,
    };
    if (this.cacheEnabled) {
      this.listCache.set(cacheKey, result);
    }
    return result;
  }

  async get(userId: string, id: string): Promise<SessionDto> {
    if (!isUuid(id)) throw new NotFoundException(SESSION_NOT_FOUND);
    const cacheKey = `${userId}:${id}`;
    if (this.cacheEnabled) {
      const cached = this.sessionDetailCache.get(cacheKey);
      if (cached) return cached;
      const inflight = this.inflightDetail.get(cacheKey);
      if (inflight) return inflight;
    }
    const fetchPromise = (async (): Promise<SessionDto> => {
      const [s, recent] = await Promise.all([
        this.sessions
          .findOne({
            _id: id,
            user_id: new Types.ObjectId(userId),
            deleted_at: null,
          })
          .lean(),
        this.messages
          .find({ session_id: id, deleted_at: null })
          .sort({ created_at: -1, _id: -1 })
          .limit(MAX_MESSAGES)
          .lean(),
      ]);
      if (!s) throw new NotFoundException(SESSION_NOT_FOUND);
      const lastMsgAt = s.last_message_at ?? s.created_at;
      const dto: SessionDto = {
        id: s._id,
        title: s.title,
        message_count: s.message_count,
        last_message_at: lastMsgAt.toISOString(),
        created_at: s.created_at.toISOString(),
        updated_at: s.updated_at.toISOString(),
        messages: recent.reverse().map(toMessage),
      };
      if (this.cacheEnabled) {
        this.sessionDetailCache.set(cacheKey, dto);
      }
      return dto;
    })();
    if (this.cacheEnabled) {
      this.inflightDetail.set(cacheKey, fetchPromise);
    }
    try {
      return await fetchPromise;
    } finally {
      if (this.cacheEnabled) {
        this.inflightDetail.delete(cacheKey);
      }
    }
  }

  async rename(
    userId: string,
    id: string,
    title: string,
  ): Promise<SessionSummaryDto> {
    const t = validTitle(title);
    if (!isUuid(id)) throw new NotFoundException(SESSION_NOT_FOUND);
    const s = await this.sessions
      .findOneAndUpdate(
        { _id: id, user_id: new Types.ObjectId(userId), deleted_at: null },
        { $set: { title: t } },
        { new: true },
      )
      .lean();
    if (!s) throw new NotFoundException(SESSION_NOT_FOUND);
    logEvent('SESSION_RENAMED', { session_id: id });
    const summary = toSummary(s);
    if (this.cacheEnabled) {
      const gen = this.userGen.get(userId) ?? 0;
      const page1 = this.listCache.get(`${userId}:${gen}::`);
      if (page1) {
        const idx = page1.items.findIndex((item) => item.id === id);
        if (idx !== -1) {
          page1.items[idx] = summary;
        }
      }
      const detailKey = `${userId}:${id}`;
      const detail = this.sessionDetailCache.get(detailKey);
      if (detail) {
        detail.title = summary.title;
        detail.updated_at = summary.updated_at;
      }
    }
    return summary;
  }

  /** Idempotent soft delete (3-day TTL): unknown ids and other users' sessions are silently ignored. */
  async remove(userId: string, id: string): Promise<void> {
    if (!isUuid(id)) return;
    if (this.cacheEnabled) {
      this.bumpUserGen(userId);
      this.sessionDetailCache.delete(`${userId}:${id}`);
    }
    const now = new Date();
    const res = await this.sessions.updateOne(
      {
        _id: id,
        user_id: new Types.ObjectId(userId),
        deleted_at: null,
      },
      { $set: { deleted_at: now } },
    );
    if (res.modifiedCount) {
      await this.messages.updateMany(
        { session_id: id, deleted_at: null },
        { $set: { deleted_at: now } },
      );
      logEvent('SESSION_DELETED', { session_id: id });
    }
  }

  async assertOwned(sessionId: string, userId: string): Promise<void> {
    await this.findOwned(sessionId, userId);
  }

  /**
   * One question/answer pair (new session when `sessionId` is null), in a transaction when the
   * server supports it. A standalone MongoDB (no replica set) cannot: the writes then run in
   * sequence, messages first, so a failure leaves at worst an orphan message, never a count that
   * is ahead of the messages or an empty session with message_count = 0.
   */
  async saveExchange(
    userId: string,
    sessionId: string | null,
    question: string,
    answer: AssistantMessageInput,
  ): Promise<SavedExchange> {
    if (this.cacheEnabled) {
      this.bumpUserGen(userId);
      if (sessionId) this.sessionDetailCache.delete(`${userId}:${sessionId}`);
    }
    if (!this.transactions) {
      return this.writeExchange(null, userId, sessionId, question, answer);
    }
    const db = await this.connection.startSession();
    try {
      let saved: SavedExchange | null = null;
      await db.withTransaction(async () => {
        saved = await this.writeExchange(
          db,
          userId,
          sessionId,
          question,
          answer,
        );
      });
      if (!saved) throw new Error('transaction produced no result');
      return saved;
    } catch (e) {
      if (!isTransactionUnsupported(e)) throw e;
      this.transactions = false;
      this.logger.warn(
        'MONGO_NO_TRANSACTIONS: standalone MongoDB, chat writes are not atomic',
      );
      return this.writeExchange(null, userId, sessionId, question, answer);
    } finally {
      await db.endSession();
    }
  }

  private async writeExchange(
    db: ClientSession | null,
    userId: string,
    sessionId: string | null,
    question: string,
    answer: AssistantMessageInput,
  ): Promise<SavedExchange> {
    const uid = new Types.ObjectId(userId);
    const now = Date.now();
    const userDate = new Date(now);
    const assistantDate = new Date(now + 1);
    let targetSessionId: string;
    if (sessionId) {
      const found = isUuid(sessionId)
        ? await this.sessions
            .findOne({ _id: sessionId, user_id: uid, deleted_at: null })
            .session(db)
            .lean()
        : null;
      if (!found) throw new NotFoundException(SESSION_NOT_FOUND);
      targetSessionId = found._id;
    } else {
      targetSessionId = uuidv7(now);
    }
    const [userMsg, assistantMsg] = await this.messages.insertMany(
      [
        {
          _id: uuidv7(now),
          session_id: targetSessionId,
          role: 'user',
          content: question,
          created_at: userDate,
          updated_at: userDate,
          deleted_at: null,
        },
        {
          _id: uuidv7(now + 1),
          session_id: targetSessionId,
          role: 'assistant',
          content: answer.content,
          citations: answer.citations,
          grounded_chunks: answer.grounded_chunks,
          timings: answer.timings,
          created_at: assistantDate,
          updated_at: assistantDate,
          deleted_at: null,
        },
      ],
      { session: db ?? undefined },
    );
    if (sessionId) {
      await this.sessions.updateOne(
        { _id: targetSessionId },
        {
          $inc: { message_count: 2 },
          $set: { last_message_at: assistantDate, updated_at: assistantDate },
        },
        { session: db ?? undefined, timestamps: false },
      );
    } else {
      await this.sessions.create(
        [
          {
            _id: targetSessionId,
            user_id: uid,
            title: formatTimestampTitle(userDate),
            message_count: 2,
            last_message_at: assistantDate,
            created_at: userDate,
            updated_at: assistantDate,
            deleted_at: null,
          },
        ],
        { session: db ?? undefined, timestamps: false },
      );
      logEvent('SESSION_CREATED', { session_id: targetSessionId });
    }
    return {
      session_id: targetSessionId,
      user_message_id: userMsg._id,
      assistant_message_id: assistantMsg._id,
    };
  }

  /** Another user's session or a soft-deleted session is reported exactly like a missing one. */
  private async findOwned(
    id: string,
    userId: string,
  ): Promise<ChatSession & { _id: string }> {
    const s = isUuid(id)
      ? await this.sessions
          .findOne({
            _id: id,
            user_id: new Types.ObjectId(userId),
            deleted_at: null,
          })
          .lean()
      : null;
    if (!s) throw new NotFoundException(SESSION_NOT_FOUND);
    return s;
  }
}
