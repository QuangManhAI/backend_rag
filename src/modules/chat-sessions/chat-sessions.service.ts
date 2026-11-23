import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { LRUCache } from 'lru-cache';
import { ClientSession, Connection, Types } from 'mongoose';
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
} from '../../common/pagination/pagination';
import { logEvent } from '../../common/logging/request-context';
import { escapeRegex } from '../../common/security/sanitize';
import { isTransactionUnsupported } from '../../common/utils/mongo-errors';
import { isUuid, uuidv7 } from '../../common/utils/uuid';
import {
  formatTimestampTitle,
  toMessage,
  toSummary,
  validTitle,
} from './chat-session.mapper';
import { ChatRequestsService } from './chat-requests.service';
import {
  MAX_MESSAGES,
  MESSAGE_PAGE_SIZE,
  SESSION_BATCH_MAX,
  SESSION_NOT_FOUND,
  SESSION_PAGE_SIZE,
} from './chat-sessions.constants';
import {
  ListMessagesQueryDto,
  ListSessionsQueryDto,
  MessagePageDto,
  SessionDto,
  SessionPageDto,
  SessionSummaryDto,
} from './dto/chat-session.dto';
import {
  ChatMessagesRepository,
  ChatSessionsRepository,
  type LeanChatSession,
} from './repositories';
import type {
  AssistantMessageInput,
  BeginRequestResult,
  SavedExchange,
  SessionStorePort,
  StoredExchange,
} from './session-store.port';

const SESSION_CACHE_TTL_MS = 300_000;

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

const detailKey = (userId: string, id: string) => `${userId}:${id}`;

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
    private readonly sessions: ChatSessionsRepository,
    private readonly messages: ChatMessagesRepository,
    private readonly requests: ChatRequestsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private bumpUserGen(userId: string): void {
    this.userGen.set(userId, (this.userGen.get(userId) ?? 0) + 1);
  }

  /** Every write path calls this: all list pages of the user go, plus the named session details. */
  private invalidate(userId: string, ...sessionIds: string[]): void {
    if (!this.cacheEnabled) return;
    this.bumpUserGen(userId);
    for (const id of sessionIds) {
      this.sessionDetailCache.delete(detailKey(userId, id));
    }
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
    const rows = await this.sessions.findPageLean(
      filter,
      mongoSort(terms),
      limit + 1,
    );
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
      this.messages.findPageLean(filter, mongoSort(terms), limit + 1),
    ]);
    return toCursorPage(rows, limit, terms, toMessage);
  }

  async get(userId: string, id: string): Promise<SessionDto> {
    if (!isUuid(id)) throw new NotFoundException(SESSION_NOT_FOUND);
    if (!this.cacheEnabled) return this.loadDetail(userId, id);
    const cacheKey = detailKey(userId, id);
    const cached = this.sessionDetailCache.get(cacheKey);
    if (cached) return cached;
    const inflight = this.inflightDetail.get(cacheKey);
    if (inflight) return inflight;
    const load = this.loadDetail(userId, id).then((dto) => {
      this.sessionDetailCache.set(cacheKey, dto);
      return dto;
    });
    this.inflightDetail.set(cacheKey, load);
    try {
      return await load;
    } finally {
      this.inflightDetail.delete(cacheKey);
    }
  }

  private async loadDetail(userId: string, id: string): Promise<SessionDto> {
    const [s, recent] = await Promise.all([
      this.sessions.findOwnedLean(userId, id),
      this.messages.findRecentForSessionLean(id, MAX_MESSAGES),
    ]);
    if (!s) throw new NotFoundException(SESSION_NOT_FOUND);
    return { ...toSummary(s), messages: recent.reverse().map(toMessage) };
  }

  async rename(
    userId: string,
    id: string,
    title: string,
  ): Promise<SessionSummaryDto> {
    const t = validTitle(title);
    if (!isUuid(id)) throw new NotFoundException(SESSION_NOT_FOUND);
    const s = await this.sessions.renameOwnedLean(userId, id, t);
    if (!s) throw new NotFoundException(SESSION_NOT_FOUND);
    logEvent('SESSION_RENAMED', { session_id: id });
    // Every cached page may hold this title (filtered and later pages too), so all of them go.
    this.invalidate(userId, id);
    return toSummary(s);
  }

  /** Idempotent soft delete (3-day TTL): unknown ids and other users' sessions are silently ignored. */
  async remove(userId: string, id: string): Promise<void> {
    if (!isUuid(id)) return;
    this.invalidate(userId, id);
    const now = new Date();
    const modifiedCount = await this.sessions.softDeleteOwned(userId, id, now);
    if (modifiedCount) {
      await this.messages.softDeleteBySession(id, now);
      logEvent('SESSION_DELETED', { session_id: id });
    }
  }

  /** Batch soft delete. Ids that are unknown or belong to someone else are silently ignored. */
  async removeMany(userId: string, rawIds: string): Promise<void> {
    const ids = parseIds(rawIds, SESSION_BATCH_MAX, isUuid);
    const found = await this.sessions.findOwnedIds(userId, ids);
    this.invalidate(userId, ...ids);
    if (!found.length) return;
    const now = new Date();
    await Promise.all([
      this.sessions.softDeleteManyOwned(userId, found, now),
      this.messages.softDeleteBySessions(found, now),
    ]);
    logEvent('SESSIONS_DELETED', { count: found.length });
  }

  beginRequest(
    userId: string,
    key: string,
    fingerprint: string,
  ): Promise<BeginRequestResult> {
    return this.requests.begin(userId, key, fingerprint);
  }

  releaseRequest(userId: string, key: string): Promise<void> {
    return this.requests.release(userId, key);
  }

  async getExchange(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<StoredExchange> {
    const [, m] = await Promise.all([
      this.findOwned(sessionId, userId),
      this.messages.findAssistantMessageLean(sessionId, messageId),
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
    this.invalidate(userId, ...(sessionId ? [sessionId] : []));
    const write = (db: ClientSession | null) =>
      this.writeExchange(db, userId, sessionId, question, answer, requestKey);
    if (!this.transactions) return write(null);
    const db = await this.connection.startSession();
    try {
      let saved: SavedExchange | null = null;
      await db.withTransaction(async () => {
        saved = await write(db);
      });
      if (!saved) throw new Error('transaction produced no result');
      return saved;
    } catch (e) {
      if (!isTransactionUnsupported(e)) throw e;
      this.transactions = false;
      this.logger.warn(
        'MONGO_NO_TRANSACTIONS: standalone MongoDB, chat writes are not atomic',
      );
      return write(null);
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
        ? await this.sessions.findOwnedLean(userId, sessionId, db)
        : null;
      if (!found) throw new NotFoundException(SESSION_NOT_FOUND);
      targetSessionId = found._id;
    } else {
      targetSessionId = uuidv7(now);
    }
    const [userMsg, assistantMsg] = await this.messages.insertExchange(
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
      db,
    );
    if (sessionId) {
      await this.sessions.incrementExchange(targetSessionId, assistantDate, db);
    } else {
      await this.sessions.createInSession(
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
        db,
      );
      logEvent('SESSION_CREATED', { session_id: targetSessionId });
    }
    if (requestKey) {
      await this.requests.complete(
        db,
        userId,
        requestKey,
        targetSessionId,
        assistantMsg._id,
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
  ): Promise<LeanChatSession> {
    const s = isUuid(id) ? await this.sessions.findOwnedLean(userId, id) : null;
    if (!s) throw new NotFoundException(SESSION_NOT_FOUND);
    return s;
  }
}
