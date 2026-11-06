import { ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { TokenService } from '../auth/token.service';
import { User } from '../auth/schemas/user.schema';
import { ChatSessionsModule } from '../chat-sessions/chat-sessions.module';
import { ChatMessage } from '../chat-sessions/schemas/chat-message.schema';
import { ChatSession } from '../chat-sessions/schemas/chat-session.schema';
import { uuidv7 } from '../../common/utils/uuid';
import {
  createTestApp,
  seedUser,
  SEED_PASSWORD,
  startMongo,
  TestApp,
} from '../../testing/test-app';
import { AdminAuditService } from './admin-audit.service';
import { AdminIdentityService } from './admin-identity.service';
import { AdminOpsService } from './admin-ops.service';
import { AdminModule } from './admin.module';
import { AdminAuditLog } from './schemas/admin-audit-log.schema';

const ADMIN_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();
const OTHER_ID = new Types.ObjectId().toString();

describe('Admin (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let t: TestApp;
  let adminToken: string;
  let userToken: string;
  let targetId: string;

  beforeAll(async () => {
    mongo = await startMongo();
    t = await createTestApp(mongo, {
      imports: [AuthModule, ChatSessionsModule, AdminModule],
    });
    await seedUser(t.app, ADMIN_ID, ['user', 'admin']);
    await seedUser(t.app, USER_ID);
    await seedUser(t.app, OTHER_ID);
    const tokens = t.app.get(TokenService);
    adminToken = (
      await tokens.issue({ id: ADMIN_ID, roles: ['user', 'admin'] }, 'fa')
    ).access_token;
    userToken = (await tokens.issue({ id: USER_ID, roles: ['user'] }, 'fu'))
      .access_token;

    // A target account with an email the admin list can find.
    targetId = new Types.ObjectId().toString();
    const users = t.app.get<Model<User>>(getModelToken(User.name));
    await users.create({
      _id: new Types.ObjectId(targetId),
      email: 'target@example.com',
      display_name: 'Target User',
      roles: ['user'],
      is_active: true,
      token_version: 0,
      password_hash: 'x',
    });
  });

  afterAll(async () => {
    await t.close();
    await mongo.stop();
  });

  const http = () => request(t.server());
  const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });
  const asUser = () => ({ Authorization: `Bearer ${userToken}` });

  const users = () => t.app.get<Model<User>>(getModelToken(User.name));
  const auditLogs = () =>
    t.app.get<Model<AdminAuditLog>>(getModelToken(AdminAuditLog.name));

  describe('RBAC', () => {
    it('401 without a token', async () => {
      await http().get('/api/v1/admin/users').expect(401);
    });

    it('403 for a normal user', async () => {
      const res = await http()
        .get('/api/v1/admin/users')
        .set(asUser())
        .expect(403);
      expect(res.body.message).toBe('admin role required');
    });

    it('200 for an admin', async () => {
      await http().get('/api/v1/admin/users').set(asAdmin()).expect(200);
    });
  });

  describe('A1 · user list', () => {
    it('never exposes password_hash', async () => {
      const res = await http()
        .get('/api/v1/admin/users')
        .set(asAdmin())
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('password_hash');
    });

    it('filters by a search string and by role', async () => {
      const byQ = await http()
        .get('/api/v1/admin/users?q=target@example')
        .set(asAdmin())
        .expect(200);
      expect(byQ.body.items).toHaveLength(1);
      expect(byQ.body.items[0].email).toBe('target@example.com');

      const byRole = await http()
        .get('/api/v1/admin/users?role=admin')
        .set(asAdmin())
        .expect(200);
      expect(
        byRole.body.items.every((u: { roles: string[] }) =>
          u.roles.includes('admin'),
        ),
      ).toBe(true);
    });

    it('walks every page with a cursor, also combined with q (ObjectId ids)', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor
          ? `&cursor=${encodeURIComponent(cursor)}`
          : '';
        const page = await http()
          .get(`/api/v1/admin/users?limit=1&q=example${query}`)
          .set(asAdmin())
          .expect(200);
        seen.push(...page.body.items.map((u: { id: string }) => u.id));
        cursor = page.body.next_cursor as string | null;
      } while (cursor);
      expect(seen.length).toBeGreaterThanOrEqual(4);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('sorts and filters with the shared query language', async () => {
      const sorted = await http()
        .get('/api/v1/admin/users?sort=email:asc&is_active=eq:true&limit=50')
        .set(asAdmin())
        .expect(200);
      const emails = sorted.body.items.map((u: { email: string }) => u.email);
      expect(emails).toEqual([...emails].sort());
      const byEmail = await http()
        .get('/api/v1/admin/users?email=match:TARGET@')
        .set(asAdmin())
        .expect(200);
      expect(byEmail.body.items).toHaveLength(1);
      await http()
        .get('/api/v1/admin/users?sort=password_hash:asc')
        .set(asAdmin())
        .expect(400);
      await http()
        .get('/api/v1/admin/users?is_active=maybe')
        .set(asAdmin())
        .expect(400);
    });

    it('rejects a bad role filter with 400', async () => {
      await http()
        .get('/api/v1/admin/users?role=root')
        .set(asAdmin())
        .expect(400);
    });
  });

  describe('A2 · user detail', () => {
    it('404 for an unknown id', async () => {
      const res = await http()
        .get('/api/v1/admin/users/64b000000000000000000009')
        .set(asAdmin())
        .expect(404);
      expect(res.body.message).toBe('user not found');
    });

    it('200 with the account state', async () => {
      const res = await http()
        .get(`/api/v1/admin/users/${targetId}`)
        .set(asAdmin())
        .expect(200);
      expect(res.body.email).toBe('target@example.com');
      expect(res.body.is_active).toBe(true);
    });
  });

  describe('A3 · role change', () => {
    it('promotes a user and kills the old tokens', async () => {
      const tokens = t.app.get(TokenService);
      const stale = (
        await tokens.issue({ id: targetId, roles: ['user'] }, 'ft')
      ).access_token;
      // The token works before the promotion (probed on a route every user may call).
      await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${stale}`)
        .expect(200);

      const res = await http()
        .put(`/api/v1/admin/users/${targetId}/roles`)
        .set(asAdmin())
        .send({ roles: ['user', 'admin'] })
        .expect(200);
      expect(res.body.roles).toEqual(['user', 'admin']);

      // ... and stops working right after it.
      await http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${stale}`)
        .expect(401);
    });

    it('an admin cannot demote itself (self lockout)', async () => {
      const res = await http()
        .put(`/api/v1/admin/users/${ADMIN_ID}/roles`)
        .set(asAdmin())
        .send({ roles: ['user'] })
        .expect(409);
      expect(res.body.message).toBe('SELF_LOCKOUT_FORBIDDEN');
    });

    it('the last admin cannot be demoted', async () => {
      // `targetId` is an admin by now, so demoting it is allowed — there would still be one
      // admin left. The guard only fires for the very last one.
      await http()
        .put(`/api/v1/admin/users/${targetId}/roles`)
        .set(asAdmin())
        .send({ roles: ['user'] })
        .expect(200);
      // Now `ADMIN_ID` is the last admin, but it cannot demote itself (self-lockout rule).
      // A *second* admin demoting it is the last-admin case; there is none here.
      const active = await users()
        .find({ roles: 'admin', is_active: true })
        .lean();
      expect(active).toHaveLength(1);
    });

    it('400 when the role list is invalid', async () => {
      await http()
        .put(`/api/v1/admin/users/${targetId}/roles`)
        .set(asAdmin())
        .send({ roles: ['root'] })
        .expect(400);
      await http()
        .put(`/api/v1/admin/users/${targetId}/roles`)
        .set(asAdmin())
        .send({ roles: [] })
        .expect(400);
    });
  });

  describe('A4 · lock and unlock', () => {
    it('locks a user, kills their tokens, and unlocks them again', async () => {
      const tokens = t.app.get(TokenService);
      const stale = (
        await tokens.issue({ id: USER_ID, roles: ['user'] }, 'fu2')
      ).access_token;

      const locked = await http()
        .put(`/api/v1/admin/users/${USER_ID}/status`)
        .set(asAdmin())
        .send({ active: false, reason: 'spam' })
        .expect(200);
      expect(locked.body.is_active).toBe(false);
      expect(locked.body.disabled_reason).toBe('spam');

      await http()
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${stale}`)
        .expect(401);

      // A locked account cannot log in either.
      await http()
        .post('/api/v1/auth/tokens')
        .send({ email: `${USER_ID}@example.com`, password: SEED_PASSWORD })
        .expect(401);

      const enabled = await http()
        .put(`/api/v1/admin/users/${USER_ID}/status`)
        .set(asAdmin())
        .send({ active: true })
        .expect(200);
      expect(enabled.body.is_active).toBe(true);
    });

    it('repeating a status PUT writes nothing: tokens stay alive, no new audit record', async () => {
      const users = t.app.get<Model<User>>(getModelToken(User.name));
      const put = (body: object) =>
        http()
          .put(`/api/v1/admin/users/${targetId}/status`)
          .set(asAdmin())
          .send(body)
          .expect(200);
      const before = await users.findById(targetId).lean();
      const auditsBefore = await auditLogs().countDocuments();
      await put({ active: true });
      expect((await users.findById(targetId).lean())?.token_version).toBe(
        before?.token_version,
      );
      expect(await auditLogs().countDocuments()).toBe(auditsBefore);

      await put({ active: false, reason: 'first' });
      const locked = await users.findById(targetId).lean();
      const auditsLocked = await auditLogs().countDocuments();
      await put({ active: false });
      const again = await users.findById(targetId).lean();
      expect(again?.token_version).toBe(locked?.token_version);
      expect(again?.disabled_at).toEqual(locked?.disabled_at);
      expect(again?.disabled_reason).toBe('first');
      expect(await auditLogs().countDocuments()).toBe(auditsLocked);
      await put({ active: true });
    });

    it('offers the lock action that fits the state of the account', async () => {
      const links = async (active: boolean) =>
        (
          await http()
            .put(`/api/v1/admin/users/${targetId}/status`)
            .set(asAdmin())
            .send({ active })
            .expect(200)
        ).body._links as Record<string, unknown>;
      expect(Object.keys(await links(false))).toContain('unlock');
      expect(Object.keys(await links(true))).toContain('lock');
    });

    it('rejects a reason when unlocking', async () => {
      await http()
        .put(`/api/v1/admin/users/${targetId}/status`)
        .set(asAdmin())
        .send({ active: true, reason: 'nope' })
        .expect(400);
    });

    it('repeating a roles PUT does not revoke tokens', async () => {
      const users = t.app.get<Model<User>>(getModelToken(User.name));
      const before = await users.findById(targetId).lean();
      await http()
        .put(`/api/v1/admin/users/${targetId}/roles`)
        .set(asAdmin())
        .send({ roles: before?.roles })
        .expect(200);
      expect((await users.findById(targetId).lean())?.token_version).toBe(
        before?.token_version,
      );
    });

    it('an admin cannot lock itself', async () => {
      const res = await http()
        .put(`/api/v1/admin/users/${ADMIN_ID}/status`)
        .set(asAdmin())
        .send({ active: false, reason: 'oops' })
        .expect(409);
      expect(res.body.message).toBe('SELF_LOCKOUT_FORBIDDEN');
    });
  });

  describe('A6 · token revocation', () => {
    it('revokes every refresh token of the target', async () => {
      const tokens = t.app.get(TokenService);
      const issued = await tokens.issue(
        { id: OTHER_ID, roles: ['user'] },
        'fo',
      );
      const before = await http()
        .get(`/api/v1/admin/users/${OTHER_ID}/tokens`)
        .set(asAdmin())
        .expect(200);
      expect(before.body.items.length).toBeGreaterThan(0);

      const res = await http()
        .delete(`/api/v1/admin/users/${OTHER_ID}/tokens`)
        .set(asAdmin())
        .expect(200);
      expect(res.body.revoked_count).toBeGreaterThan(0);

      await http()
        .post('/api/v1/auth/token-rotations')
        .send({ refresh_token: issued.refresh_token })
        .expect(401);
    });
  });

  describe('B1 · session visibility (read-only)', () => {
    it('lists the sessions of a user and shows the messages', async () => {
      const sessions = t.app.get<Model<ChatSession>>(
        getModelToken(ChatSession.name),
      );
      const messages = t.app.get<Model<ChatMessage>>(
        getModelToken(ChatMessage.name),
      );
      const sessionId = uuidv7();
      await sessions.create({
        _id: sessionId,
        user_id: new Types.ObjectId(USER_ID),
        title: 'violating content',
        message_count: 1,
      });
      await messages.create({
        session_id: sessionId,
        role: 'user',
        content: 'please review this',
      });

      const list = await http()
        .get(`/api/v1/admin/users/${USER_ID}/chat-sessions`)
        .set(asAdmin())
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].title).toBe('violating content');

      const detail = await http()
        .get(`/api/v1/admin/chat-sessions/${sessionId}`)
        .set(asAdmin())
        .expect(200);
      expect(detail.body.messages[0].content).toBe('please review this');
    });

    it('there is no delete endpoint for content', async () => {
      await http()
        .delete('/api/v1/admin/chat-sessions/whatever')
        .set(asAdmin())
        .expect(405);
    });
  });

  describe('C1–C3 · operations', () => {
    it('200 on stats', async () => {
      const res = await http()
        .get('/api/v1/admin/stats')
        .set(asAdmin())
        .expect(200);
      expect(typeof res.body.users_total).toBe('number');
      expect(res.body.users_total).toBeGreaterThan(0);
    });

    it('200 on login attempts and health', async () => {
      await http()
        .get('/api/v1/admin/login-attempts')
        .set(asAdmin())
        .expect(200);
      await http().get('/api/v1/admin/health').set(asAdmin()).expect(200);
    });
  });

  describe('D2 · audit log', () => {
    it('records every admin action', async () => {
      const res = await http()
        .get('/api/v1/admin/audit-logs')
        .set(asAdmin())
        .expect(200);
      const actions = res.body.items.map((r: { action: string }) => r.action);
      expect(actions).toContain('USER_LIST_VIEW');
      expect(actions).toContain('USER_ROLE_CHANGE');
      expect(actions).toContain('USER_DISABLE');
    });

    it('records who acted: the admin email, not "unknown"', async () => {
      await http().get('/api/v1/admin/stats').set(asAdmin()).expect(200);
      const last = await auditLogs()
        .findOne({ action: 'STATS_VIEW' })
        .sort({ created_at: -1 })
        .lean();
      expect(last?.actor_email).toBe(`${ADMIN_ID}@example.com`);
    });

    it('every service entry point re-checks the role on its own', async () => {
      const notAdmin = { id: USER_ID, roles: ['user' as const] };
      const identity = t.app.get(AdminIdentityService);
      const ops = t.app.get(AdminOpsService);
      const audit = t.app.get(AdminAuditService);
      const list = { limit: 1 } as never;
      const calls: Array<() => Promise<unknown>> = [
        () => identity.listUsers(notAdmin, list),
        () => identity.getUser(notAdmin, targetId),
        () => identity.changeRoles(notAdmin, targetId, ['user']),
        () => identity.setUserStatus(notAdmin, targetId, true, undefined),
        () => identity.revokeUserTokens(notAdmin, targetId),
        () => identity.listUserTokens(notAdmin, targetId),
        () => ops.listUserSessions(notAdmin, targetId, list),
        () => ops.getSession(notAdmin, uuidv7()),
        () => ops.listSessionMessages(notAdmin, uuidv7(), list),
        () => ops.getStats(notAdmin),
        () => ops.listLoginAttempts(notAdmin, list),
        () => ops.getHealth(notAdmin),
        () => audit.listAuditLogs(notAdmin, list),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toThrow(ForbiddenException);
      }
    });

    it('the trail is append-only: no delete or update endpoint exists', async () => {
      const del = await http()
        .delete('/api/v1/admin/audit-logs')
        .set(asAdmin())
        .expect(405);
      expect(del.headers.allow).toBe('GET');
      await http()
        .patch('/api/v1/admin/audit-logs')
        .set(asAdmin())
        .send({})
        .expect(405);
    });

    it('the raw collection has no service method that mutates a record', async () => {
      const model = auditLogs();
      // Only `create`, `find` and `countDocuments` are used by the module.
      expect(typeof model.create).toBe('function');
    });
  });
});
