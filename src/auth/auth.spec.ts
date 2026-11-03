import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import {
  createTestApp,
  startMongo,
  TEST_ENV,
  TestApp,
} from '../testing/test-app';
import type { AuthUser } from '../types/auth-user';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard, OptionalJwtAuthGuard } from './guards/jwt-auth.guard';
import { Roles, RolesGuard } from './guards/roles.guard';
import { RefreshToken } from './schemas/refresh-token.schema';
import { User } from './schemas/user.schema';

@Controller('probe')
class ProbeController {
  @Get('optional')
  @UseGuards(OptionalJwtAuthGuard)
  optional(@CurrentUser() u?: AuthUser) {
    return { user_id: u?.id ?? null };
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  admin() {
    return { ok: true };
  }
}

interface AuthBody {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: { id: string; email: string; roles: string[] } & Record<
    string,
    unknown
  >;
}

describe('Auth (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let t: TestApp;
  let n = 0;

  beforeAll(async () => {
    mongo = await startMongo();
    t = await createTestApp(mongo, {
      imports: [AuthModule],
    });
  });

  afterAll(async () => {
    await t.close();
    await mongo.stop();
  });

  const http = () => request(t.server());
  const newEmail = () => `user${++n}@Example.com `;

  async function register(email = newEmail(), password = 'correct horse') {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, password, display_name: 'Manh' })
      .expect(201);
    return res.body as AuthBody;
  }

  describe('register', () => {
    it('returns tokens and a user without password_hash', async () => {
      const b = await register();
      expect(b.token_type).toBe('Bearer');
      expect(b.expires_in).toBe(900);
      expect(b.user.email).toMatch(/^user\d+@example\.com$/);
      expect(b.user.roles).toEqual(['user']);
      expect(b.user).not.toHaveProperty('password_hash');
    });

    it('409 on duplicate email (case and spaces ignored)', async () => {
      await register('dup@example.com');
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          email: ' DUP@example.com',
          password: 'correct horse',
          display_name: 'x',
        })
        .expect(409);
      expect(res.body.message).toBe('email already exists');
    });

    it.each([
      [
        { email: 'nope', password: 'correct horse', display_name: 'x' },
        'invalid email',
      ],
      [
        { email: 'a@b.co', password: 'short', display_name: 'x' },
        'password too short',
      ],
      [
        { email: 'a@b.co', password: 'correct horse', display_name: '' },
        'invalid display_name',
      ],
    ])('400 %#', async (body, message) => {
      const res = await http()
        .post('/api/v1/auth/register')
        .send(body)
        .expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message,
      });
    });

    it('stores only the refresh token hash', async () => {
      const b = await register();
      const tokens = t.app.get<Model<RefreshToken>>(
        getModelToken(RefreshToken.name),
      );
      const all = await tokens.find().lean();
      expect(JSON.stringify(all)).not.toContain(b.refresh_token);
      expect(all.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
      const users = t.app.get<Model<User>>(getModelToken(User.name));
      const u = await users.findById(b.user.id).lean();
      expect(u?.password_hash).toMatch(/^\$argon2id\$/);
    });
  });

  describe('login', () => {
    it('200 with good credentials', async () => {
      const email = newEmail();
      await register(email);
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'correct horse' })
        .expect(200);
    });

    it('5 failures then 429', async () => {
      const email = newEmail();
      await register(email);
      for (let i = 0; i < 5; i++) {
        const r = await http()
          .post('/api/v1/auth/login')
          .send({ email, password: 'wrong password' })
          .expect(401);
        expect(r.body.message).toBe('invalid credentials');
      }
      const r = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'correct horse' })
        .expect(429);
      expect(r.body.message).toBe('too many login attempts');
    });

    it('401 for an unknown email', async () => {
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@example.com', password: 'whatever1' })
        .expect(401);
    });
  });

  describe('refresh', () => {
    it('rotates; reusing the old token revokes the whole family', async () => {
      const first = await register();
      const second = (
        await http()
          .post('/api/v1/auth/refresh')
          .send({ refresh_token: first.refresh_token })
          .expect(200)
      ).body as AuthBody;
      expect(second.refresh_token).not.toBe(first.refresh_token);

      const reuse = await http()
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: first.refresh_token })
        .expect(401);
      expect(reuse.body.message).toBe('refresh token invalid or expired');

      await http()
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: second.refresh_token })
        .expect(401);
    });

    it('two concurrent refreshes: exactly one succeeds', async () => {
      const b = await register();
      const results = await Promise.all(
        [1, 2].map(() =>
          http()
            .post('/api/v1/auth/refresh')
            .send({ refresh_token: b.refresh_token }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('401 for an unknown token', async () => {
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: 'nope' })
        .expect(401);
    });

    it('logout revokes the token', async () => {
      const b = await register();
      await http()
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${b.access_token}`)
        .send({ refresh_token: b.refresh_token })
        .expect(204);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: b.refresh_token })
        .expect(401);
    });
  });

  describe('me / profile / password', () => {
    it('GET and PATCH /auth/me', async () => {
      const b = await register();
      const auth = `Bearer ${b.access_token}`;
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', auth)
        .expect(200);
      expect(me.body.id).toBe(b.user.id);
      const upd = await http()
        .patch('/api/v1/auth/me')
        .set('Authorization', auth)
        .send({ display_name: '  New name ' })
        .expect(200);
      expect(upd.body.display_name).toBe('New name');
      const bad = await http()
        .patch('/api/v1/auth/me')
        .set('Authorization', auth)
        .send({ display_name: 'x'.repeat(61) })
        .expect(400);
      expect(bad.body.message).toBe('invalid display_name');
    });

    it('change-password revokes every refresh token', async () => {
      const email = newEmail();
      const a = await register(email);
      const b = (
        await http()
          .post('/api/v1/auth/login')
          .send({ email, password: 'correct horse' })
          .expect(200)
      ).body as AuthBody;
      const wrong = await http()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${a.access_token}`)
        .send({ old_password: 'not it!!', new_password: 'brand new pass' })
        .expect(401);
      expect(wrong.body.message).toBe('old password incorrect');
      await http()
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${a.access_token}`)
        .send({ old_password: 'correct horse', new_password: 'brand new pass' })
        .expect(204);
      for (const tok of [a.refresh_token, b.refresh_token]) {
        await http()
          .post('/api/v1/auth/refresh')
          .send({ refresh_token: tok })
          .expect(401);
      }
      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: 'brand new pass' })
        .expect(200);
    });
  });

  describe('guards', () => {
    let probe: TestApp;
    let jwt: JwtService;
    let userId: string;
    let adminId: string;

    beforeAll(async () => {
      probe = await createTestApp(mongo, {
        imports: [AuthModule],
        controllers: [ProbeController],
      });
      jwt = probe.app.get(JwtService);
      // The guards now look the account up in the database (prompt_security S3), so the probe
      // needs two real accounts.
      const plain = await register();
      userId = plain.user.id;
      const admin = await register();
      adminId = admin.user.id;
      const users = probe.app.get<Model<User>>(getModelToken(User.name));
      await users.updateOne(
        { _id: new Types.ObjectId(adminId) },
        { $set: { roles: ['user', 'admin'] } },
      );
    });

    afterAll(() => probe.close());

    const sign = (claims: object, expiresIn: number) =>
      jwt.sign(claims, { secret: TEST_ENV.JWT_ACCESS_SECRET, expiresIn });

    it('expired token ➔ 401 token expired', async () => {
      const tok = sign({ sub: 'x', roles: ['user'], iat: 1000 }, 1);
      const r = await request(probe.server())
        .get('/api/v1/probe/optional')
        .set('Authorization', `Bearer ${tok}`)
        .expect(401);
      expect(r.body.message).toBe('token expired');
    });

    it('OptionalJwtAuthGuard: none ➔ anonymous, valid ➔ user, bad ➔ 401', async () => {
      const s = () => request(probe.server()).get('/api/v1/probe/optional');
      expect((await s().expect(200)).body).toEqual({ user_id: null });
      const tok = sign({ sub: userId, roles: ['user'] }, 60);
      expect(
        (await s().set('Authorization', `Bearer ${tok}`).expect(200)).body,
      ).toEqual({
        user_id: userId,
      });
      const bad = await s()
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
      expect(bad.body.message).toBe('unauthorized');
    });

    it('RolesGuard: user ➔ 403, admin ➔ 200, none ➔ 401', async () => {
      const s = () => request(probe.server()).get('/api/v1/probe/admin');
      const user = sign({ sub: userId, roles: ['user'] }, 60);
      const r = await s().set('Authorization', `Bearer ${user}`).expect(403);
      expect(r.body.message).toBe('admin role required');
      const admin = sign({ sub: adminId, roles: ['user', 'admin'] }, 60);
      await s().set('Authorization', `Bearer ${admin}`).expect(200);
      await s().expect(401);
    });

    it('a token issued before a role change stops working (token_version)', async () => {
      const users = probe.app.get<Model<User>>(getModelToken(User.name));
      const auth = probe.app.get(AuthService);
      const tok = sign({ sub: adminId, roles: ['user', 'admin'], ver: 0 }, 60);
      await request(probe.server())
        .get('/api/v1/probe/admin')
        .set('Authorization', `Bearer ${tok}`)
        .expect(200);
      await users.updateOne(
        { _id: new Types.ObjectId(adminId) },
        { $inc: { token_version: 1 } },
      );
      // The account-state cache is dropped, exactly like an admin role change does.
      auth.invalidateUserCaches(adminId);
      await request(probe.server())
        .get('/api/v1/probe/admin')
        .set('Authorization', `Bearer ${tok}`)
        .expect(401);
    });
  });
});
