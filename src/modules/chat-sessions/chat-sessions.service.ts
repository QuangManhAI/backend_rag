import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { LRUCache } from 'lru-cache';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  allOf,
  FilterField,
  keysetFilter,
  ListSpec,
  mongoSort,
  parseFilters,
  parseIds,
  parseSort,
  toCursorPage,
} from '../common/pagination';
import { escapeRegex } from '../common/sanitize';
import { logEvent } from '../common/request-context';
import { isUuid, uuidv7 } from '../common/uuid';
import {
  ListMessagesQueryDto,
  ListSessionsQueryDto,
  MessageDto,
  MessagePageDto,
  SessionDto,
  SessionPageDto,
  SessionSummaryDto,
} from './dto/chat-session.dto';
import { ChatMessage } from './schemas/chat-message.schema';
import { ChatRequest } from './schemas/chat-request.schema';
import {
  ChatSession,
  ChatSessionDocument,
} from './schemas/chat-session.schema';
import type {
  AssistantMessageInput,
  BeginRequestResult,
  SavedExchange,
  SessionStorePort,
  StoredExchange,
} from './session-store.port';

export const SESSION_NOT_FOUND = 'session not found';
export const SESSION_PAGE_SIZE = 10;
export const TITLE_MAX = 120;
export const MAX_MESSAGES = 200;
export const UTC7_OFFSET_MS = 7 * 60 * 60 * 1000;
const SESSION_CACHE_TTL_MS = 300_000;

export const SESSION_BATCH_MAX = 50;
export const MESSAGE_PAGE_SIZE = 50;
export const REQUEST_IN_PROGRESS = 'request already in progress';
export const REQUEST_KEY_REUSED =
  'idempotency key reused with a different request';
const REQUEST_LOCK_MS = 5 * 60 * 1000;

const SESSION_LIST: ListSpec = {
  sortable: { last_message_at: 'date', created_at: 'date', title: 'string' },
  defaultSort: [{ field: 'last_message_at', dir: 'desc' }],
  idType: 'uuid',
};
const SESSION_FILTERS: Record<string, FilterField> = {
  created_at: { type: 'date' },
  last_message_at: { type: 'date' },
  message_count: { type: 'number' },
};
const MESSAGE_LIST: ListSpec = {
  sortable: { created_at: 'date' },
  defaultSort: [{ field: 'created_at', dir: 'asc' }],
  idType: 'uuid',
};

const isDuplicateKey = (e: unknown) =>
  (e as { code?: unknown })?.code === 11000;

/** Unicode-aware length (an emoji counts as one character). */
const charLength = (s: string) => Array.from(s).length;

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
    @InjectModel(ChatRequest.name)
    private readonly requests: Model<ChatRequest>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private bumpUserGen(userId: string): void {
    this.userGen.set(userId, (this.userGen.get(userId) ?? 0) + 1);
  }

  async list(
    userId: string,
    query: Partial<ListSessionsQueryDto> = {},
  ): Promise<SessionPageDto> {
    const limit = query.limit ?? SESSION_PAGE_SIZE;
    const trimmedQ = query.q?.trim() ?? '';
    const gen = this.userGen.get(userId) ?? 0;
    const cacheKey = `${userId}:${gen}:${JSON.stringify([
      limit,
      query.cursor,
      query.sort,
      trimmedQ.toLowerCase(),
      query.ids,
      query.created_at,
      query.last_message_at,
      query.message_count,
    ])}`;
    if (this.cacheEnabled) {
      const cached = this.listCache.get(cacheKey);
      if (cached) return cached;
    }
    const terms = parseSort(query.sort, SESSION_LIST);
    const conditions = parseFilters(query, SESSION_FILTERS);
    if (query.cursor) {
      conditions.push(keysetFilter(query.cursor, terms, SESSION_LIST));
    }
    const filter = allOf(
      {
        user_id: new Types.ObjectId(userId),
        deleted_at: null,
        message_count: { $gt: 0 },
      },
      conditions,
    );
    if (trimmedQ)
      filter.title = { $regex: escapeRegex(trimmedQ), $options: 'i' };
    if (query.ids) {
      filter._id = {
        $in: parseIds(query.ids, SESSION_BATCH_MAX, isUuid),
      };
    }
    const rows = await this.sessions
      .find(filter)
      .sort(mongoSort(terms))
      .limit(limit + 1)
      .lean();
    const result: SessionPageDto = toCursorPage(rows, limit, terms, toSummary);
    if (this.cacheEnabled) {
      this.listCache.set(cacheKey, result);
    }
    return result;
  }

  /** The messages of one owned session, oldest first by default. */
  async listMessages(
    userId: string,
    id: string,
    query: Partial<ListMessagesQueryDto> = {},
  ): Promise<MessagePageDto> {
    const limit = query.limit ?? MESSAGE_PAGE_SIZE;
    const terms = parseSort(query.sort, MESSAGE_LIST);
    const filter = allOf(
      { session_id: id, deleted_at: null },
      query.cursor ? [keysetFilter(query.cursor, terms, MESSAGE_LIST)] : [],
    );
    const [, rows] = await Promise.all([
      this.findOwned(id, userId),
      this.messages
        .find(filter)
        .sort(mongoSort(terms))
        .limit(limit + 1)
        .lean(),
    ]);
    return toCursorPage(rows, limit, terms, toMessage);
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
    if (this.cacheEnabled) {
      // Every cached page may hold this title (filtered and later pages too), so all of them go.
      this.bumpUserGen(userId);
      this.sessionDetailCache.delete(`${userId}:${id}`);
    }
    return toSummary(s);
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

  /** Batch soft delete. Ids that are unknown or belong to someone else are silently ignored. */
  async removeMany(userId: string, rawIds: string): Promise<void> {
    const ids = parseIds(rawIds, SESSION_BATCH_MAX, isUuid);
    const owned = { user_id: new Types.ObjectId(userId), deleted_at: null };
    const rows = await this.sessions
      .find({ ...owned, _id: { $in: ids } }, { _id: 1 })
      .lean();
    if (this.cacheEnabled) {
      this.bumpUserGen(userId);
      for (const id of ids) this.sessionDetailCache.delete(`${userId}:${id}`);
    }
    if (!rows.length) return;
    const found = rows.map((r) => r._id);
    const now = new Date();
    await Promise.all([
      this.sessions.updateMany(
        { ...owned, _id: { $in: found } },
        { $set: { deleted_at: now } },
      ),
      this.messages.updateMany(
        { session_id: { $in: found }, deleted_at: null },
        { $set: { deleted_at: now } },
      ),
    ]);
    logEvent('SESSIONS_DELETED', { count: found.length });
  }

  async beginRequest(
    userId: string,
    key: string,
    fingerprint: string,
  ): Promise<BeginRequestResult> {
    const _id = `${userId}:${key}`;
    const now = Date.now();
    const lockedUntil = new Date(now + REQUEST_LOCK_MS);
    try {
      await this.requests.create({
        _id,
        user_id: new Types.ObjectId(userId),
        fingerprint,
        status: 'in_progress',
        locked_until: lockedUntil,
      });
      return { state: 'started' };
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
    const existing = await this.requests.findById(_id).lean();
    // Released between the failed insert and this read: the client may simply retry.
    if (!existing) throw new ConflictException(REQUEST_IN_PROGRESS);
    if (existing.fingerprint !== fingerprint) {
      throw new ConflictException(REQUEST_KEY_REUSED);
    }
    if (
      existing.status === 'completed' &&
      existing.session_id &&
      existing.message_id
    ) {
      return {
        state: 'completed',
        session_id: existing.session_id,
        message_id: existing.message_id,
      };
    }
    const takenOver = await this.requests.findOneAndUpdate(
      {
        _id,
        status: 'in_progress',
        locked_until: { $lte: new Date(now) },
      },
      { $set: { locked_until: lockedUntil } },
    );
    if (!takenOver) throw new ConflictException(REQUEST_IN_PROGRESS);
    return { state: 'started' };
  }

  async releaseRequest(userId: string, key: string): Promise<void> {
    await this.requests.deleteOne({
      _id: `${userId}:${key}`,
      status: 'in_progress',
    });
  }

  async getExchange(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<StoredExchange> {
    const [, m] = await Promise.all([
      this.findOwned(sessionId, userId),
      this.messages
        .findOne({
          _id: messageId,
          session_id: sessionId,
          role: 'assistant',
          deleted_at: null,
        })
        .lean(),
    ]);
    if (!m) throw new NotFoundException(SESSION_NOT_FOUND);
    return {
      session_id: sessionId,
      message_id: m._id,
      content: m.content,
      citations: m.citations ?? [],
      grounded_chunks: m.grounded_chunks ?? [],
      timings: m.timings as StoredExchange['timings'],
    };
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
    requestKey?: string,
  ): Promise<SavedExchange> {
    if (this.cacheEnabled) {
      this.bumpUserGen(userId);
      if (sessionId) this.sessionDetailCache.delete(`${userId}:${sessionId}`);
    }
    if (!this.transactions) {
      return this.writeExchange(
        null,
        userId,
        sessionId,
        question,
        answer,
        requestKey,
      );
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
          requestKey,
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
      return this.writeExchange(
        null,
        userId,
        sessionId,
        question,
        answer,
        requestKey,
      );
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
    requestKey?: string,
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
    if (requestKey) {
      // In the same transaction as the messages: a key is never `completed` without its answer.
      await this.requests.updateOne(
        { _id: `${userId}:${requestKey}` },
        {
          $set: {
            status: 'completed',
            session_id: targetSessionId,
            message_id: assistantMsg._id,
          },
        },
        { session: db ?? undefined },
      );
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
