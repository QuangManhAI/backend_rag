import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import type { GroundedChunk, Timings } from '../../../types/scientific-rag';
import { ChatMessage, MessageRole } from '../schemas/chat-message.schema';

export type LeanChatMessage = ChatMessage & { _id: string };

export interface InsertChatMessageInput {
  _id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  citations?: string[];
  grounded_chunks?: GroundedChunk[];
  timings?: Timings;
  created_at: Date;
  updated_at: Date;
  deleted_at: null;
}

@Injectable()
export class ChatMessagesRepository {
  constructor(
    @InjectModel(ChatMessage.name)
    private readonly model: Model<ChatMessage>,
  ) {}

  findPageLean(
    filter: Record<string, unknown>,
    sort: Record<string, 1 | -1>,
    limit: number,
  ): Promise<LeanChatMessage[]> {
    return this.model.find(filter).sort(sort).limit(limit).lean();
  }

  findRecentForSessionLean(
    sessionId: string,
    limit: number,
  ): Promise<LeanChatMessage[]> {
    return this.model
      .find({ session_id: sessionId, deleted_at: null })
      .sort({ created_at: -1, _id: -1 })
      .limit(limit)
      .lean();
  }

  findAssistantMessageLean(
    sessionId: string,
    messageId: string,
  ): Promise<LeanChatMessage | null> {
    return this.model
      .findOne({
        _id: messageId,
        session_id: sessionId,
        role: 'assistant',
        deleted_at: null,
      })
      .lean();
  }

  async insertExchange(
    docs: InsertChatMessageInput[],
    db: ClientSession | null,
  ): Promise<Array<{ _id: string }>> {
    const inserted = await this.model.insertMany(docs, {
      session: db ?? undefined,
    });
    return inserted.map((d) => ({ _id: d._id }));
  }

  async softDeleteBySession(sessionId: string, deletedAt: Date): Promise<void> {
    await this.model.updateMany(
      { session_id: sessionId, deleted_at: null },
      { $set: { deleted_at: deletedAt } },
    );
  }

  async softDeleteBySessions(
    sessionIds: string[],
    deletedAt: Date,
  ): Promise<void> {
    await this.model.updateMany(
      { session_id: { $in: sessionIds }, deleted_at: null },
      { $set: { deleted_at: deletedAt } },
    );
  }

  countActive(): Promise<number> {
    return this.model.countDocuments({ deleted_at: null });
  }
}
