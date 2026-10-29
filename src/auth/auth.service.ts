import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import { isValidObjectId, Model, Types } from 'mongoose';
import { logEvent } from '../common/request-context';
import type { AuthUser } from '../types/auth-user';
import {
  AuthResponseDto,
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  UserDto,
} from './dto/auth.dto';
import { LoginAttempt } from './schemas/login-attempt.schema';
import { User, UserDocument } from './schemas/user.schema';
import { TokenService } from './token.service';

export const MAX_LOGIN_FAILURES = 5;
const DUPLICATE_KEY = 11000;
const USER_CACHE_TTL_MS = 300_000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Short, non-reversible id of an email for logs (the email itself is never logged). */
export function emailHash(email: string): string {
  return createHash('sha256')
    .update(normalizeEmail(email))
    .digest('hex')
    .slice(0, 16);
}

export function toUserDto(
  u: UserDocument | (User & { _id: Types.ObjectId }),
): UserDto {
  return {
    id: u._id.toString(),
    email: u.email,
    display_name: u.display_name,
    roles: u.roles,
    created_at: u.created_at.toISOString(),
  };
}

function isDuplicateKey(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === DUPLICATE_KEY
  );
}

type LeanUser = User & { _id: Types.ObjectId };

@Injectable()
export class AuthService {
  private readonly userCache = new LRUCache<string, UserDto>({
    max: 5000,
    ttl: USER_CACHE_TTL_MS,
    updateAgeOnGet: true,
  });
  private readonly userByEmailCache = new LRUCache<string, LeanUser>({
    max: 5000,
    ttl: USER_CACHE_TTL_MS,
    updateAgeOnGet: true,
  });
  private readonly attemptCountCache = new LRUCache<string, number>({
    max: 10_000,
    ttl: 15 * 60 * 1000,
  });

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(LoginAttempt.name)
    private readonly attempts: Model<LoginAttempt>,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const email = normalizeEmail(dto.email);
    if (await this.users.exists({ email })) return this.emailTaken();
    let user: UserDocument;
    try {
      user = await this.users.create({
        email,
        password_hash: await argon2.hash(dto.password, {
          type: argon2.argon2id,
        }),
        display_name: dto.display_name,
        roles: ['user'],
      });
    } catch (e) {
      if (isDuplicateKey(e)) return this.emailTaken();
      throw e;
    }
    logEvent('REGISTER_OK', { user_id: user._id.toString() });
    this.userByEmailCache.set(email, {
      _id: user._id,
      email: user.email,
      password_hash: user.password_hash,
      display_name: user.display_name,
      roles: user.roles,
      created_at: user.created_at,
      updated_at: user.updated_at,
    });
    return this.respond(user, this.tokens.newFamilyId());
  }

  async login(dto: LoginDto, ip: string): Promise<AuthResponseDto> {
    const email = normalizeEmail(dto.email);
    const key = createHash('sha256').update(`${email}|${ip}`).digest('hex');

    let attemptCount = this.attemptCountCache.get(key);
    let user = this.userByEmailCache.get(email) ?? null;

    if (attemptCount === undefined || !user) {
      const [dbAttempts, dbUser] = await Promise.all([
        attemptCount === undefined
          ? this.attempts.countDocuments({ key })
          : Promise.resolve(attemptCount),
        user ? Promise.resolve(user) : this.users.findOne({ email }).lean(),
      ]);
      attemptCount = dbAttempts;
      this.attemptCountCache.set(key, attemptCount);
      if (dbUser) {
        user = dbUser as LeanUser;
        this.userByEmailCache.set(email, user);
      }
    }

    if (attemptCount >= MAX_LOGIN_FAILURES) {
      logEvent('LOGIN_FAILED', {
        email_hash: emailHash(email),
        reason: 'rate_limited',
      });
      throw new HttpException(
        'too many login attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ok = user
      ? await argon2.verify(user.password_hash, dto.password)
      : false;
    if (!user || !ok) {
      this.attemptCountCache.set(key, attemptCount + 1);
      await this.attempts.create({ key });
      logEvent('LOGIN_FAILED', { email_hash: emailHash(email) });
      throw new UnauthorizedException('invalid credentials');
    }

    const familyId = this.tokens.newFamilyId();
    const hadFailures = attemptCount > 0;
    if (hadFailures) {
      this.attemptCountCache.set(key, 0);
    }
    const [res] = await Promise.all([
      this.respond(user, familyId),
      hadFailures ? this.attempts.deleteMany({ key }) : Promise.resolve(),
    ]);
    logEvent('LOGIN_OK', { user_id: user._id.toString() });
    return res;
  }

  async refresh(raw: string): Promise<AuthResponseDto> {
    const r = await this.tokens.consume(raw);
    if (!r.ok) {
      logEvent(r.reason === 'reused' ? 'REFRESH_REUSED' : 'REFRESH_FAILED', {
        reason: r.reason,
      });
      throw new UnauthorizedException('refresh token invalid or expired');
    }
    const cachedUser = this.userCache.get(r.userId);
    if (cachedUser) {
      logEvent('REFRESH_OK', { user_id: r.userId });
      const tokens = await this.tokens.issue(
        { id: cachedUser.id, roles: cachedUser.roles },
        r.familyId,
      );
      return { ...tokens, user: cachedUser };
    }
    const user = await this.users.findById(r.userId).lean();
    if (!user) {
      logEvent('REFRESH_FAILED', { reason: 'user_gone' });
      throw new UnauthorizedException('refresh token invalid or expired');
    }
    logEvent('REFRESH_OK', { user_id: r.userId });
    return this.respond(user, r.familyId);
  }

  async logout(raw: string, me: AuthUser): Promise<void> {
    await this.tokens.revokeOne(raw, me.id);
    logEvent('LOGOUT_OK');
  }

  async me(me: AuthUser): Promise<UserDto> {
    const cached = this.userCache.get(me.id);
    if (cached) return cached;
    const u = isValidObjectId(me.id)
      ? await this.users.findById(me.id).lean()
      : null;
    if (!u) throw new UnauthorizedException('unauthorized');
    const dto = toUserDto(u);
    this.userCache.set(me.id, dto);
    return dto;
  }

  async updateProfile(me: AuthUser, displayName: string): Promise<UserDto> {
    const user = await this.users
      .findByIdAndUpdate(
        me.id,
        { $set: { display_name: displayName } },
        { new: true },
      )
      .lean();
    if (!user) throw new UnauthorizedException('unauthorized');
    logEvent('PROFILE_UPDATED');
    const dto = toUserDto(user);
    this.userCache.set(me.id, dto);
    this.userByEmailCache.set(user.email, user as LeanUser);
    return dto;
  }

  async changePassword(me: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const user = await this.mustFind(me.id);
    if (!(await argon2.verify(user.password_hash, dto.old_password))) {
      throw new UnauthorizedException('old password incorrect');
    }
    user.password_hash = await argon2.hash(dto.new_password, {
      type: argon2.argon2id,
    });
    await user.save();
    this.userByEmailCache.delete(user.email);
    await this.tokens.revokeAllForUser(me.id);
    logEvent('PASSWORD_CHANGED');
  }

  private async mustFind(id: string): Promise<UserDocument> {
    const user = isValidObjectId(id) ? await this.users.findById(id) : null;
    if (!user) throw new UnauthorizedException('unauthorized');
    return user;
  }

  private emailTaken(): never {
    logEvent('REGISTER_EMAIL_TAKEN');
    throw new ConflictException('email already exists');
  }

  private async respond(
    user: UserDocument | LeanUser,
    familyId: string,
  ): Promise<AuthResponseDto> {
    const userDto = toUserDto(user);
    this.userCache.set(userDto.id, userDto);
    const tokens = await this.tokens.issue(
      { id: userDto.id, roles: userDto.roles },
      familyId,
    );
    return { ...tokens, user: userDto };
  }
}
