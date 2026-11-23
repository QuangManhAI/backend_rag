import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoginAttempt } from '../schemas/login-attempt.schema';

export type LeanLoginAttempt = LoginAttempt & { _id: Types.ObjectId };

@Injectable()
export class LoginAttemptsRepository {
  constructor(
    @InjectModel(LoginAttempt.name)
    private readonly model: Model<LoginAttempt>,
  ) {}

  countByKey(key: string): Promise<number> {
    return this.model.countDocuments({ key });
  }

  async record(key: string): Promise<void> {
    await this.model.create({ key });
  }

  async clearByKey(key: string): Promise<void> {
    await this.model.deleteMany({ key });
  }

  findPageLean(
    filter: Record<string, unknown>,
    sort: Record<string, 1 | -1>,
    limit: number,
  ): Promise<LeanLoginAttempt[]> {
    return this.model.find(filter).sort(sort).limit(limit).lean();
  }
}
