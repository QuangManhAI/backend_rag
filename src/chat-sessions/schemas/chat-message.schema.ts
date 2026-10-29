import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { uuidv7 } from '../../common/uuid';
import type { GroundedChunk, Timings } from '../../types/scientific-rag';
import { SESSION_TTL_SECONDS } from './chat-session.schema';

export type MessageRole = 'user' | 'assistant';

@Schema({
  collection: 'chat_messages',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class ChatMessage {
  @Prop({ type: String, default: () => uuidv7() })
  _id: string;

  @Prop({ type: String, required: true })
  session_id: string;

  @Prop({ required: true, enum: ['user', 'assistant'] })
  role: MessageRole;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [String], default: undefined })
  citations?: string[];

  @Prop({ type: [MongooseSchema.Types.Mixed], default: undefined })
  grounded_chunks?: GroundedChunk[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: undefined })
  timings?: Timings;

  @Prop({ type: Date, default: null })
  deleted_at: Date | null;

  created_at: Date;
  updated_at: Date;
}

export type ChatMessageDocument = HydratedDocument<ChatMessage>;
export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);
ChatMessageSchema.index({
  session_id: 1,
  deleted_at: 1,
  created_at: -1,
  _id: -1,
});
ChatMessageSchema.index(
  { deleted_at: 1 },
  { expireAfterSeconds: SESSION_TTL_SECONDS },
);
