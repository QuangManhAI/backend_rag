import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
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
import { validatePassword } from './common-passwords';
import { LoginAttempt } from './schemas/login-attempt.schema';
import { User, UserDocument } from './schemas/user.schema';
import { TokenService } from './token.service';

export const MAX_LOGIN_FAILURES = 5;
const DUPLICATE_KEY = 11000;
const USER_CACHE_TTL_MS = 300_000;
/**
 * Grace window of the account-state cache. A revoked or demoted account keeps its old access
 * token working for at most this long — unless an admin action invalidates the cache explicitly,
 * which it always does (prompt_security S3). 5 s is a deliberate trade-off: one MongoDB round trip
 * costs 15–25 ms through the Cloudflare tunnel, and the cache absorbs nearly all of it.
 */
const TOKEN_VERSION_CACHE_TTL_MS = 5_000;

/**
 * Argon2id parameters. Never weaken them (D-021, D-022). The dummy hash below must use exactly
 * the same parameters, otherwise the login timing difference would leak user enumeration again.
 */
export const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

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
  /**
   * `token_version` + `is_active` per user, so the JWT guard does not hit MongoDB on every request
   * (prompt_security S3). The TTL must not slide: a busy client would otherwise keep a stale entry
   * alive for as long as it keeps calling, and the grace window above would have no upper bound.
   */
  private readonly tokenVersionCache = new LRUCache<string, LeanUser>({
    max: 5000,
    ttl: TOKEN_VERSION_CACHE_TTL_MS,
  });
  /**
   * A valid Argon2id hash of a random secret. Verifying a password against it costs the same as a
   * real verification, so an unknown email answers as slowly as a wrong password (S1.1). The hash
   * is produced once, lazily, because Argon2id is asynchronous.
   */
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(LoginAttempt.name)
    private readonly attempts: Model<LoginAttempt>,
    private readonly tokens: TokenService,
  ) {}

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= argon2
      .hash(randomBytes(32).toString('base64url'), { ...ARGON2_OPTIONS })
      .then((h) => h);
    return this.dummyHashPromise;
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const email = normalizeEmail(dto.email);
    validatePassword(dto.password, email);
    if (await this.users.exists({ email })) return this.emailTaken();
    let user: UserDocument;
    try {
      user = await this.users.create({
        email,
        password_hash: await argon2.hash(dto.password, { ...ARGON2_OPTIONS }),
        display_name: dto.display_name,
        roles: ['user'],
        is_active: true,
        token_version: 0,
      });
    } catch (e) {
      if (isDuplicateKey(e)) return this.emailTaken();
      throw e;
    }
    logEvent('REGISTER_OK', { user_id: user._id.toString() });
    this.cacheUser(user);
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
        user = dbUser;
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

    // Always run Argon2id — against the dummy hash when the email is unknown — so the response
    // time cannot be used to tell registered emails from unregistered ones (S1.1).
    const ok = await argon2.verify(
      user ? user.password_hash : await this.dummyHash(),
      dto.password,
    );
    if (!user || !ok) {
      this.attemptCountCache.set(key, attemptCount + 1);
      await this.attempts.create({ key });
      logEvent('LOGIN_FAILED', { email_hash: emailHash(email) });
      throw new UnauthorizedException('invalid credentials');
    }
    if (!user.is_active) {
      logEvent('LOGIN_FAILED', {
        email_hash: emailHash(email),
        reason: 'account_disabled',
      });
      throw new UnauthorizedException('invalid credentials');
    }

    const familyId = this.tokens.newFamilyId();
    const hadFailures = attemptCount > 0;
    if (hadFailures) {
      this.attemptCountCache.set(key, 0);
    }
    await this.users.updateOne(
      { _id: user._id },
      { $set: { last_login_at: new Date() } },
    );
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
      const live = await this.getActiveUser(r.userId);
      if (!live || !live.is_active) {
        await this.tokens.revokeFamily(r.familyId);
        logEvent('REFRESH_FAILED', { reason: 'user_gone' });
        throw new UnauthorizedException('refresh token invalid or expired');
      }
      logEvent('REFRESH_OK', { user_id: r.userId });
      const tokens = await this.tokens.issue(
        {
          id: cachedUser.id,
          roles: live.roles,
          tokenVersion: live.token_version,
        },
        r.familyId,
      );
      return { ...tokens, user: cachedUser };
    }
    const user = await this.users.findById(r.userId).lean();
    if (!user || !user.is_active) {
      await this.tokens.revokeFamily(r.familyId);
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
    this.userByEmailCache.set(user.email, user);
    return dto;
  }

  async changePassword(me: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const user = await this.mustFind(me.id);
    validatePassword(dto.new_password, user.email);
    if (!(await argon2.verify(user.password_hash, dto.old_password))) {
      throw new UnauthorizedException('old password incorrect');
    }
    user.password_hash = await argon2.hash(dto.new_password, {
      ...ARGON2_OPTIONS,
    });
    await user.save();
    this.userByEmailCache.delete(user.email);
    await this.revokeAllForUser(me.id);
    logEvent('PASSWORD_CHANGED');
  }

  /**
   * The account state the JWT guard checks on every request: existence, `is_active` and
   * `token_version`. Cached for a few seconds so a busy user does not query MongoDB on each request (S3).
   */
  async getActiveUser(id: string): Promise<LeanUser | null> {
    if (!isValidObjectId(id)) return null;
    const cached = this.tokenVersionCache.get(id);
    if (cached) return cached;
    const user = await this.users.findById(id).lean();
    if (!user) return null;
    this.tokenVersionCache.set(id, user);
    return user;
  }

  /**
   * Revokes every refresh token of a user and bumps `token_version`, so all previously issued
   * access tokens stop working immediately (S3).
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const revoked = await this.tokens.revokeAllForUser(userId);
    await this.users.updateOne(
      { _id: new Types.ObjectId(userId) },
      { $inc: { token_version: 1 } },
    );
    this.tokenVersionCache.delete(userId);
    return revoked;
  }

  /** Drops every cached view of a user. Called after a role change, a lock or a password change. */
  invalidateUserCaches(userId: string, email?: string): void {
    this.userCache.delete(userId);
    this.tokenVersionCache.delete(userId);
    if (email) this.userByEmailCache.delete(email);
  }

  private cacheUser(user: UserDocument | LeanUser): void {
    const id = user._id.toString();
    this.userCache.set(id, toUserDto(user));
    this.userByEmailCache.set(user.email, user);
    this.tokenVersionCache.set(id, user);
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
    this.tokenVersionCache.set(userDto.id, user);
    const tokens = await this.tokens.issue(
      {
        id: userDto.id,
        roles: userDto.roles,
        tokenVersion: user.token_version ?? 0,
      },
      familyId,
    );
    return { ...tokens, user: userDto };
  }
}
