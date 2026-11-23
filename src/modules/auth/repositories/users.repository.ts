import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Role } from '../../../types/auth-user';
import { LeanUser, User, UserDocument } from '../schemas/user.schema';

export interface CreateUserRecord {
  email: string;
  password_hash: string;
  display_name: string;
  roles: Role[];
  is_active: boolean;
  token_version: number;
}

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {}

  async existsByEmail(email: string): Promise<boolean> {
    const doc = await this.model.exists({ email });
    return doc !== null;
  }

  create(data: CreateUserRecord): Promise<UserDocument> {
    return this.model.create(data);
  }

  findByEmailLean(email: string): Promise<LeanUser | null> {
    return this.model.findOne({ email }).lean();
  }

  findByIdLean(id: string): Promise<LeanUser | null> {
    return this.model.findById(id).lean();
  }

  async updateLastLogin(id: Types.ObjectId, at: Date): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { last_login_at: at } });
  }

  updateDisplayNameLean(
    id: string,
    displayName: string,
  ): Promise<LeanUser | null> {
    return this.model
      .findByIdAndUpdate(
        id,
        { $set: { display_name: displayName } },
        { new: true },
      )
      .lean();
  }

  async updatePasswordHash(
    id: Types.ObjectId,
    passwordHash: string,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      { $set: { password_hash: passwordHash } },
    );
  }

  async incrementTokenVersion(userId: string): Promise<void> {
    await this.model.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $inc: { token_version: 1 } },
    );
  }

  countDocuments(filter: Record<string, unknown>): Promise<number> {
    return this.model.countDocuments(filter);
  }

  findPageLean(
    filter: Record<string, unknown>,
    sort: Record<string, 1 | -1>,
    limit: number,
  ): Promise<LeanUser[]> {
    return this.model.find(filter).sort(sort).limit(limit).lean();
  }

  async updateRolesAndBumpVersion(
    id: Types.ObjectId,
    roles: Role[],
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      { $set: { roles }, $inc: { token_version: 1 } },
    );
  }

  async updateDisabledReason(
    id: Types.ObjectId,
    reason: string,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      { $set: { disabled_reason: reason } },
    );
  }

  async disableAndBumpVersion(
    id: Types.ObjectId,
    disabledBy: Types.ObjectId,
    disabledAt: Date,
    reason: string | null,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      {
        $set: {
          is_active: false,
          disabled_at: disabledAt,
          disabled_by: disabledBy,
          disabled_reason: reason,
        },
        $inc: { token_version: 1 },
      },
    );
  }

  async enableAndBumpVersion(id: Types.ObjectId): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      {
        $set: {
          is_active: true,
          disabled_at: null,
          disabled_by: null,
          disabled_reason: null,
        },
        $inc: { token_version: 1 },
      },
    );
  }
}
