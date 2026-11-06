import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export const REQUEST_KEY_TTL_SECONDS = 24 * 60 * 60;

export type ChatRequestStatus = 'in_progress' | 'completed';

/**
 * One `Idempotency-Key` of `POST /rag/chat*`. `_id` = `<user_id>:<key>`, so the insert is the atomic
 * reservation and keys of different users can never collide.
 */
@Schema({ collection: 'chat_requests', versionKey: false })
export class ChatRequest {
  @Prop({ type: String })
  _id: string;

  @Prop({ type: Types.ObjectId, required: true })
  user_id: Types.ObjectId;

  /** Hash of the request body: the same key with another body is a client bug (409). */
  @Prop({ required: true })
  fingerprint: string;

  @Prop({ required: true, enum: ['in_progress', 'completed'] })
  status: ChatRequestStatus;

  /** A crashed worker never releases its key: after this instant a retry may take it over. */
  @Prop({ type: Date, required: true })
  locked_until: Date;

  @Prop({ type: String, default: null })
  session_id: string | null;

  @Prop({ type: String, default: null })
  message_id: string | null;

  @Prop({ type: Date, default: () => new Date() })
  created_at: Date;
}

export const ChatRequestSchema = SchemaFactory.createForClass(ChatRequest);
ChatRequestSchema.index(
  { created_at: 1 },
  { expireAfterSeconds: REQUEST_KEY_TTL_SECONDS },
);
