import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { uuidv7 } from '../../common/uuid';

export const SESSION_TTL_SECONDS = 3 * 24 * 60 * 60;

@Schema({
  collection: 'chat_sessions',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class ChatSession {
  @Prop({ type: String, default: () => uuidv7() })
  _id: string;

  @Prop({ type: Types.ObjectId, required: true })
  user_id: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ default: 0 })
  message_count: number;

  @Prop({ type: Date, default: () => new Date() })
  last_message_at: Date;

  @Prop({ type: Date, default: null })
  deleted_at: Date | null;

  created_at: Date;
  updated_at: Date;
}

export type ChatSessionDocument = HydratedDocument<ChatSession>;
export const ChatSessionSchema = SchemaFactory.createForClass(ChatSession);
ChatSessionSchema.index({
  user_id: 1,
  deleted_at: 1,
  last_message_at: -1,
  _id: -1,
});
ChatSessionSchema.index(
  { deleted_at: 1 },
  { expireAfterSeconds: SESSION_TTL_SECONDS },
);
