import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** Only the hash of a refresh token is stored; the raw value exists only in the client. */
@Schema({
  collection: 'refresh_tokens',
  timestamps: { createdAt: 'created_at', updatedAt: false },
})
export class RefreshToken {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  user_id: Types.ObjectId;

  @Prop({ required: true, unique: true })
  token_hash: string;

  @Prop({ required: true, index: true })
  family_id: string;

  @Prop({ type: Date, default: null })
  revoked_at: Date | null;

  /** TTL index: Mongo removes the record once it expires. */
  @Prop({ type: Date, required: true, expires: 0 })
  expires_at: Date;

  created_at: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
