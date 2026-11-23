import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RefreshToken } from '../schemas/refresh-token.schema';

export type LeanRefreshToken = RefreshToken & { _id: Types.ObjectId };

export interface CreateRefreshTokenRecord {
  user_id: Types.ObjectId;
  token_hash: string;
  family_id: string;
  expires_at: Date;
}

@Injectable()
export class RefreshTokensRepository {
  constructor(
    @InjectModel(RefreshToken.name)
    private readonly model: Model<RefreshToken>,
  ) {}

  async create(data: CreateRefreshTokenRecord): Promise<void> {
    await this.model.create(data);
  }

  /**
   * 1-RTT atomic rotation step (D-021): claims and revokes an active, unexpired refresh token
   * so concurrent refreshes with the same token succeed at most once.
   */
  consumeActiveByHashLean(
    tokenHash: string,
    now: Date,
  ): Promise<LeanRefreshToken | null> {
    return this.model
      .findOneAndUpdate(
        { token_hash: tokenHash, revoked_at: null, expires_at: { $gt: now } },
        { $set: { revoked_at: now } },
      )
      .lean();
  }

  findByHashLean(tokenHash: string): Promise<LeanRefreshToken | null> {
    return this.model.findOne({ token_hash: tokenHash }).lean();
  }

  async revokeOne(tokenHash: string, userId: string, now: Date): Promise<void> {
    await this.model.updateOne(
      {
        token_hash: tokenHash,
        user_id: new Types.ObjectId(userId),
        revoked_at: null,
      },
      { $set: { revoked_at: now } },
    );
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.model.updateMany(
      { family_id: familyId, revoked_at: null },
      { $set: { revoked_at: now } },
    );
  }

  async revokeAllForUser(userId: string, now: Date): Promise<number> {
    const res = await this.model.updateMany(
      { user_id: new Types.ObjectId(userId), revoked_at: null },
      { $set: { revoked_at: now } },
    );
    return res.modifiedCount;
  }

  countActiveForUser(userId: Types.ObjectId, now: Date): Promise<number> {
    return this.model.countDocuments({
      user_id: userId,
      revoked_at: null,
      expires_at: { $gt: now },
    });
  }

  findActiveForUserLean(
    userId: Types.ObjectId,
    now: Date,
  ): Promise<LeanRefreshToken[]> {
    return this.model
      .find({
        user_id: userId,
        revoked_at: null,
        expires_at: { $gt: now },
      })
      .sort({ created_at: -1 })
      .lean();
  }
}
