import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const LOGIN_WINDOW_SECONDS = 15 * 60;

/** One failed login; expires after the 15-minute window. `key` = hash(email, ip). */
@Schema({ collection: 'login_attempts', versionKey: false })
export class LoginAttempt {
  @Prop({ required: true, index: true })
  key: string;

  @Prop({
    type: Date,
    default: () => new Date(),
    expires: LOGIN_WINDOW_SECONDS,
  })
  created_at: Date;
}

export type LoginAttemptDocument = HydratedDocument<LoginAttempt>;
export const LoginAttemptSchema = SchemaFactory.createForClass(LoginAttempt);
