import { getModelToken } from '@nestjs/mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { TokenService } from '../auth/token.service';
import { isUuid, uuidv7 } from '../common/uuid';
import { createTestApp, startMongo, TestApp } from '../testing/test-app';
import { ChatSessionsModule } from './chat-sessions.module';
import {
  ChatSessionsService,
  formatTimestampTitle,
  titleFromQuestion,
  validTitle,
} from './chat-sessions.service';
import { ChatMessage } from './schemas/chat-message.schema';
import { ChatSession } from './schemas/chat-session.schema';
import { SESSION_STORE, SessionStorePort } from './session-store.port';

const ALICE = new Types.ObjectId().toString();
const BOB = new Types.ObjectId().toString();
const TIMESTAMP_TITLE_RE = /^\d{2}-\d{2}-\d{2}:\d{2}-\d{2}-\d{2}$/;

const answer = {
  content: 'LoRA ... [Paper: 2106.09685]',
  citations: ['2106.09685'],
  grounded_chunks: [],
  timings: {
    embed_ms: 1,
    route_ms: 0,
    search_ms: 2,
    rerank_ms: 0,
    llm_ms: 10,
    total_ms: 13,
  },
};

describe('title helpers', () => {
  it('validTitle trims and counts Unicode characters', () => {
    expect(validTitle('  Hi  ')).toBe('Hi');
    expect(validTitle('😀'.repeat(120))).toHaveLength(240); // 120 emoji = 240 UTF-16 units
    expect(() => validTitle('😀'.repeat(121))).toThrow('invalid title');
    expect(() => validTitle('   ')).toThrow('invalid title');
  });

  it('formatTimestampTitle formats Date as YY-MM-DD:HH-MM-SS in UTC+07', () => {
    // 2026-10-19T07:28:33Z == 2026-10-19T14:28:33+07:00
    expect(formatTimestampTitle(new Date('2026-10-19T07:28:33.000Z'))).toBe(
      '26-10-19:14-28-33',
    );
  });

  it('titleFromQuestion keeps the first 60 characters', () => {
    expect(titleFromQuestion('a'.repeat(80))).toBe('a'.repeat(60));
    expect(titleFromQuestion('  How  does\nLoRA work? ')).toBe(
      'How does LoRA work?',
    );
  });
});

describe('Chat sessions (integration)', () => {
  let mongo: MongoMemoryReplSet;
  let t: TestApp;
  let alice: string;
  let bob: string;
  let svc: ChatSessionsService;

  beforeAll(async () => {
    mongo = await startMongo();
    t = await createTestApp(mongo, {
      imports: [AuthModule, ChatSessionsModule],
    });
    const tokens = t.app.get(TokenService);
    alice = (await tokens.issue({ id: ALICE, roles: ['user'] }, 'f1'))
      .access_token;
    bob = (await tokens.issue({ id: BOB, roles: ['user'] }, 'f2')).access_token;
    svc = t.app.get(ChatSessionsService);
  });

  afterAll(async () => {
    await t.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await t.app
      .get<Model<ChatSession>>(getModelToken(ChatSession.name))
      .deleteMany({});
    await t.app
      .get<Model<ChatMessage>>(getModelToken(ChatMessage.name))
      .deleteMany({});
  });

  const http = () => request(t.server());
  const as = (tok: string) => ({ Authorization: `Bearer ${tok}` });

  it('requires a JWT', async () => {
    await http().get('/api/v1/chat-sessions').expect(401);
  });

  it('create, get, rename, soft-delete (with 3d tombstone)', async () => {
    const created = await http()
      .post('/api/v1/chat-sessions')
      .set(as(alice))
      .send({})
      .expect(201);
    expect(created.body).toMatchObject({
      title: expect.stringMatching(TIMESTAMP_TITLE_RE),
      message_count: 0,
      last_message_at: expect.any(String),
    });
    const id = created.body.id as string;
    expect(isUuid(id)).toBe(true);

    const got = await http()
      .get(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .expect(200);
    expect(got.body).toMatchObject({
      id,
      title: created.body.title,
      last_message_at: created.body.last_message_at,
      messages: [],
    });

    const renamed = await http()
      .patch(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .send({ title: '  LoRA notes  ' })
      .expect(200);
    expect(renamed.body.title).toBe('LoRA notes');
    expect(renamed.body.last_message_at).toBe(created.body.last_message_at);

    const bad = await http()
      .patch(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .send({ title: ' ' })
      .expect(400);
    expect(bad.body.message).toBe('invalid title');

    await http()
      .delete(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .expect(204);
    await http()
      .delete(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .expect(204);
    await http().get(`/api/v1/chat-sessions/${id}`).set(as(alice)).expect(404);

    // Tombstone remains in MongoDB with deleted_at set
    const sessionModel = t.app.get<Model<ChatSession>>(
      getModelToken(ChatSession.name),
    );
    const raw = await sessionModel.findById(id).lean();
    expect(raw?.deleted_at).toBeInstanceOf(Date);
  });

  it('renaming an older session updates updated_at without changing last_message_at or list order', async () => {
    const s1 = await svc.create(ALICE, 'Older session');
    await new Promise((r) => setTimeout(r, 15));
    const s2 = await svc.create(ALICE, 'Newer session');

    await new Promise((r) => setTimeout(r, 15));
    const renamed = await svc.rename(ALICE, s1.id, 'Older renamed');
    expect(renamed.last_message_at).toBe(s1.last_message_at);
    expect(Date.parse(renamed.updated_at)).toBeGreaterThan(
      Date.parse(s1.updated_at),
    );

    const list = await http()
      .get('/api/v1/chat-sessions')
      .set(as(alice))
      .expect(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([
      s2.id,
      s1.id,
    ]);
  });

  it("another user's session ➔ 404, and delete does nothing", async () => {
    const { id } = await svc.create(ALICE, 'mine');
    const reads = [
      () => http().get(`/api/v1/chat-sessions/${id}`),
      () => http().patch(`/api/v1/chat-sessions/${id}`).send({ title: 'x' }),
    ];
    for (const req of reads) {
      const r = await req().set(as(bob)).expect(404);
      expect(r.body.message).toBe('session not found');
    }
    await http().delete(`/api/v1/chat-sessions/${id}`).set(as(bob)).expect(204);
    await http().get(`/api/v1/chat-sessions/${id}`).set(as(alice)).expect(200);
    await http()
      .get('/api/v1/chat-sessions/not-an-id')
      .set(as(alice))
      .expect(404);
  });

  it('paginates 3 pages with no duplicates and no gaps (same last_message_at too)', async () => {
    const model = t.app.get<Model<ChatSession>>(
      getModelToken(ChatSession.name),
    );
    const same = new Date('2026-10-20T00:00:00Z');
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const ts = i < 4 ? same : new Date(same.getTime() + i * 1000);
      const [doc] = await model.create(
        [
          {
            _id: uuidv7(same.getTime() + i),
            user_id: new Types.ObjectId(ALICE),
            title: `s${i}`,
            last_message_at: ts,
            created_at: same,
            updated_at: ts,
            deleted_at: null,
          },
        ],
        { timestamps: false },
      );
      ids.push(doc._id);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = cursor ? `?limit=3&cursor=${cursor}` : '?limit=3';
      const r = await http()
        .get(`/api/v1/chat-sessions${q}`)
        .set(as(alice))
        .expect(200);
      seen.push(...(r.body.items as Array<{ id: string }>).map((x) => x.id));
      cursor = r.body.next_cursor as string | null;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('bad cursor ➔ 400 invalid cursor; limit out of range ➔ 400', async () => {
    const r = await http()
      .get('/api/v1/chat-sessions?cursor=abc!!')
      .set(as(alice))
      .expect(400);
    expect(r.body.message).toBe('invalid cursor');
    await http()
      .get('/api/v1/chat-sessions?limit=51')
      .set(as(alice))
      .expect(400);
  });

  it('q searches titles case-insensitively, regex characters are literal', async () => {
    await svc.create(ALICE, 'What is C++ (really)?');
    await svc.create(ALICE, 'LoRA basics');
    await svc.create(BOB, 'lora for bob');
    const plus = await http()
      .get(`/api/v1/chat-sessions?q=${encodeURIComponent('c++ (REALLY')}`)
      .set(as(alice))
      .expect(200);
    expect(plus.body.items.map((x: { title: string }) => x.title)).toEqual([
      'What is C++ (really)?',
    ]);
    const lora = await http()
      .get('/api/v1/chat-sessions?q=LORA')
      .set(as(alice))
      .expect(200);
    expect(lora.body.items.map((x: { title: string }) => x.title)).toEqual([
      'LoRA basics',
    ]);
    const dot = await http()
      .get('/api/v1/chat-sessions?q=.*')
      .set(as(alice))
      .expect(200);
    expect(dot.body.items).toEqual([]);
  });

  it('saveExchange: new session has timestamp title, UUIDv7 ids, count +2, messages in order', async () => {
    const store = t.app.get<SessionStorePort>(SESSION_STORE);
    const first = await store.saveExchange(
      ALICE,
      null,
      'How does LoRA reduce trainable parameters in practice?',
      answer,
    );
    expect(isUuid(first.session_id)).toBe(true);
    expect(isUuid(first.user_message_id)).toBe(true);
    expect(isUuid(first.assistant_message_id)).toBe(true);

    await store.saveExchange(ALICE, first.session_id, 'And QLoRA?', answer);
    const r = await http()
      .get(`/api/v1/chat-sessions/${first.session_id}`)
      .set(as(alice))
      .expect(200);
    expect(r.body.title).toMatch(TIMESTAMP_TITLE_RE);
    expect(
      r.body.messages.map((m: { role: string; content: string }) => [
        m.role,
        m.content,
      ]),
    ).toEqual([
      ['user', 'How does LoRA reduce trainable parameters in practice?'],
      ['assistant', answer.content],
      ['user', 'And QLoRA?'],
      ['assistant', answer.content],
    ]);
    expect(r.body.messages[1]).toMatchObject({
      citations: ['2106.09685'],
      timings: answer.timings,
      updated_at: expect.any(String),
    });
    expect(r.body.messages[0]).not.toHaveProperty('citations');
    const list = await http()
      .get('/api/v1/chat-sessions')
      .set(as(alice))
      .expect(200);
    expect(list.body.items[0]).toMatchObject({
      id: first.session_id,
      message_count: 4,
      last_message_at: expect.any(String),
    });
  });

  it('saveExchange preserves default timestamp title until manually renamed', async () => {
    const s = await svc.create(ALICE);
    expect(s.title).toMatch(TIMESTAMP_TITLE_RE);
    await svc.saveExchange(ALICE, s.id, 'Diffusion models?', answer);
    expect((await svc.get(ALICE, s.id)).title).toBe(s.title);
  });

  it("saveExchange into someone else's session ➔ 404 and nothing written", async () => {
    const s = await svc.create(ALICE, 'mine');
    await expect(svc.saveExchange(BOB, s.id, 'q', answer)).rejects.toThrow(
      'session not found',
    );
    expect((await svc.get(ALICE, s.id)).messages).toHaveLength(0);
  });
});

describe('Chat sessions on a standalone MongoDB (no transactions)', () => {
  it('saveExchange falls back to sequential writes', async () => {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const standalone = await MongoMemoryServer.create();
    const t = await createTestApp(standalone as unknown as MongoMemoryReplSet, {
      imports: [AuthModule, ChatSessionsModule],
    });
    try {
      const svc = t.app.get(ChatSessionsService);
      const first = await svc.saveExchange(ALICE, null, 'Standalone?', answer);
      await svc.saveExchange(ALICE, first.session_id, 'Again', answer);
      const s = await svc.get(ALICE, first.session_id);
      expect(s.messages).toHaveLength(4);
      expect((await svc.list(ALICE, 20)).items[0].message_count).toBe(4);
    } finally {
      await t.close();
      await standalone.stop();
    }
  });
});
