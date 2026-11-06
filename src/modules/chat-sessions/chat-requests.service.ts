import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { isDuplicateKey } from '../../common/utils/mongo-errors';
import {
  REQUEST_IN_PROGRESS,
  REQUEST_KEY_REUSED,
} from './chat-sessions.constants';
import { ChatRequest } from './schemas/chat-request.schema';
import type { BeginRequestResult } from './session-store.port';

const REQUEST_LOCK_MS = 5 * 60 * 1000;

const requestId = (userId: string, key: string) => `${userId}:${key}`;

/** The `Idempotency-Key` records of `POST /rag/chat*`: one lock per key, then the stored answer. */
@Injectable()
export class ChatRequestsService {
  constructor(
    @InjectModel(ChatRequest.name)
    private readonly requests: Model<ChatRequest>,
  ) {}

  async begin(
    userId: string,
    key: string,
    fingerprint: string,
  ): Promise<BeginRequestResult> {
    const _id = requestId(userId, key);
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

  async release(userId: string, key: string): Promise<void> {
    await this.requests.deleteOne({
      _id: requestId(userId, key),
      status: 'in_progress',
    });
  }

  /** In the same transaction as the messages: a key is never `completed` without its answer. */
  async complete(
    db: ClientSession | null,
    userId: string,
    key: string,
    sessionId: string,
    messageId: string,
  ): Promise<void> {
    await this.requests.updateOne(
      { _id: requestId(userId, key) },
      {
        $set: {
          status: 'completed',
          session_id: sessionId,
          message_id: messageId,
        },
      },
      { session: db ?? undefined },
    );
  }
}
