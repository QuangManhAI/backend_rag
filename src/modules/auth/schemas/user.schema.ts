import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { Role } from '../../types/auth-user';

@Schema({
  collection: 'users',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password_hash: string;

  @Prop({ required: true, trim: true })
  display_name: string;

  @Prop({ type: [String], default: ['user'] })
  roles: Role[];

  /** `false` when an admin locks the account (prompt_security S2). */
  @Prop({ default: true })
  is_active: boolean;

  @Prop({ type: Date, default: null })
  disabled_at: Date | null;

  /** The admin who locked the account (audit pointer). */
  @Prop({ type: Types.ObjectId, default: null })
  disabled_by: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  disabled_reason: string | null;

  /** Bumped on every role change / lock / token revocation so old JWTs die at once. */
  @Prop({ default: 0 })
  token_version: number;

  @Prop({ type: Date, default: null })
  last_login_at: Date | null;

  created_at: Date;
  updated_at: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
/** Serves the admin listing filter (role + active). */
UserSchema.index({ roles: 1, is_active: 1 });
