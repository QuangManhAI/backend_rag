import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ChatRequest } from '../schemas/chat-request.schema';

export interface InsertChatRequestInput {
  _id: string;
  user_id: Types.ObjectId;
  fingerprint: string;
  status: 'in_progress';
  locked_until: Date;
}

@Injectable()
export class ChatRequestsRepository {
  constructor(
    @InjectModel(ChatRequest.name)
    private readonly model: Model<ChatRequest>,
  ) {}

  async insertInProgress(doc: InsertChatRequestInput): Promise<void> {
    await this.model.create(doc);
  }

  findByIdLean(id: string): Promise<ChatRequest | null> {
    return this.model.findById(id).lean();
  }

  async takeOverExpiredLock(
    id: string,
    now: Date,
    lockedUntil: Date,
  ): Promise<boolean> {
    const takenOver = await this.model.findOneAndUpdate(
      {
        _id: id,
        status: 'in_progress',
        locked_until: { $lte: now },
      },
      { $set: { locked_until: lockedUntil } },
    );
    return takenOver !== null;
  }

  async deleteInProgress(id: string): Promise<void> {
    await this.model.deleteOne({
      _id: id,
      status: 'in_progress',
    });
  }

  async markCompleted(
    id: string,
    sessionId: string,
    messageId: string,
    db: ClientSession | null,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id },
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
