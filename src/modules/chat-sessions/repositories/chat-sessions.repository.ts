import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ChatSession } from '../schemas/chat-session.schema';

export type LeanChatSession = ChatSession & { _id: string };

export interface CreateChatSessionRecord {
  _id: string;
  user_id: Types.ObjectId;
  title: string;
  message_count: number;
  last_message_at: Date;
  created_at: Date;
  updated_at: Date;
  deleted_at: null;
}

/** A live session of this user; anything else must read as missing (404, never 403). */
const ownedSessionFilter = (userId: string, id: string) => ({
  _id: id,
  user_id: new Types.ObjectId(userId),
  deleted_at: null,
});

@Injectable()
export class ChatSessionsRepository {
  constructor(
    @InjectModel(ChatSession.name)
    private readonly model: Model<ChatSession>,
  ) {}

  findPageLean(
    filter: Record<string, unknown>,
    sort: Record<string, 1 | -1>,
    limit: number,
  ): Promise<LeanChatSession[]> {
    return this.model.find(filter).sort(sort).limit(limit).lean();
  }

  findOwnedLean(
    userId: string,
    id: string,
    db?: ClientSession | null,
  ): Promise<LeanChatSession | null> {
    return this.model
      .findOne(ownedSessionFilter(userId, id))
      .session(db ?? null)
      .lean();
  }

  findActiveByIdLean(id: string): Promise<LeanChatSession | null> {
    return this.model.findOne({ _id: id, deleted_at: null }).lean();
  }

  async existsActiveById(id: string): Promise<boolean> {
    const doc = await this.model.exists({ _id: id, deleted_at: null });
    return doc !== null;
  }

  renameOwnedLean(
    userId: string,
    id: string,
    title: string,
  ): Promise<LeanChatSession | null> {
    return this.model
      .findOneAndUpdate(
        ownedSessionFilter(userId, id),
        { $set: { title } },
        { new: true },
      )
      .lean();
  }

  async softDeleteOwned(
    userId: string,
    id: string,
    deletedAt: Date,
  ): Promise<number> {
    const res = await this.model.updateOne(ownedSessionFilter(userId, id), {
      $set: { deleted_at: deletedAt },
    });
    return res.modifiedCount;
  }

  async findOwnedIds(userId: string, ids: string[]): Promise<string[]> {
    const rows = await this.model
      .find(
        {
          user_id: new Types.ObjectId(userId),
          deleted_at: null,
          _id: { $in: ids },
        },
        { _id: 1 },
      )
      .lean();
    return rows.map((r) => r._id);
  }

  async softDeleteManyOwned(
    userId: string,
    ids: string[],
    deletedAt: Date,
  ): Promise<void> {
    await this.model.updateMany(
      {
        user_id: new Types.ObjectId(userId),
        deleted_at: null,
        _id: { $in: ids },
      },
      { $set: { deleted_at: deletedAt } },
    );
  }

  async incrementExchange(
    id: string,
    assistantDate: Date,
    db: ClientSession | null,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      {
        $inc: { message_count: 2 },
        $set: { last_message_at: assistantDate, updated_at: assistantDate },
      },
      { session: db ?? undefined, timestamps: false },
    );
  }

  async createInSession(
    doc: CreateChatSessionRecord,
    db: ClientSession | null,
  ): Promise<void> {
    await this.model.create([doc], {
      session: db ?? undefined,
      timestamps: false,
    });
  }

  countActive(): Promise<number> {
    return this.model.countDocuments({ deleted_at: null });
  }
}
