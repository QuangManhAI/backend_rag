import { getModelToken } from '@nestjs/mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { TokenService } from '../auth/token.service';
import { encodeCursor } from '../common/pagination';
import { isUuid, uuidv7 } from '../common/uuid';
import { createTestApp, startMongo, TestApp } from '../testing/test-app';
import { ChatSessionsModule } from './chat-sessions.module';
import {
  ChatSessionsService,
  formatTimestampTitle,
  MAX_MESSAGES,
  SESSION_PAGE_SIZE,
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

  it('requires a JWT on all session routes (/api/v1/chat-sessions and /:id)', async () => {
    const randomUuid = uuidv7();
    await http().get('/api/v1/chat-sessions').expect(401);
    await http().get(`/api/v1/chat-sessions/${randomUuid}`).expect(401);
    await http()
      .patch(`/api/v1/chat-sessions/${randomUuid}`)
      .send({ title: 'hack' })
      .expect(401);
    await http().delete(`/api/v1/chat-sessions/${randomUuid}`).expect(401);
  });

  it('returns empty list and has_more=false when user has no conversations yet (0 sessions)', async () => {
    const list = await http()
      .get('/api/v1/chat-sessions')
      .set(as(alice))
      .expect(200);
    expect(list.body).toEqual({
      items: [],
      next_cursor: null,
      has_more: false,
    });
  });

  it('does not expose POST /api/v1/chat-sessions (sessions are created lazily on first message)', async () => {
    await http()
      .post('/api/v1/chat-sessions')
      .set(as(alice))
      .send({})
      .expect(404);
  });

  it('lazy-create via saveExchange, get, rename, soft-delete (with 3d tombstones on session and messages)', async () => {
    const first = await svc.saveExchange(ALICE, null, 'What is LoRA?', answer);
    const id = first.session_id;
    expect(isUuid(id)).toBe(true);

    const got = await http()
      .get(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .expect(200);
    expect(got.body).toMatchObject({
      id,
      title: expect.stringMatching(TIMESTAMP_TITLE_RE),
      message_count: 2,
      last_message_at: expect.any(String),
    });
    expect(got.body.messages).toHaveLength(2);

    const renamed = await http()
      .patch(`/api/v1/chat-sessions/${id}`)
      .set(as(alice))
      .send({ title: '  LoRA notes  ' })
      .expect(200);
    expect(renamed.body.title).toBe('LoRA notes');
    expect(renamed.body.last_message_at).toBe(got.body.last_message_at);

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

    // Tombstone remains in MongoDB with deleted_at set on both session and messages
    const sessionModel = t.app.get<Model<ChatSession>>(
      getModelToken(ChatSession.name),
    );
    const messageModel = t.app.get<Model<ChatMessage>>(
      getModelToken(ChatMessage.name),
    );
    const rawSession = await sessionModel.findById(id).lean();
    expect(rawSession?.deleted_at).toBeInstanceOf(Date);
    const rawMessages = await messageModel.find({ session_id: id }).lean();
    expect(rawMessages).toHaveLength(2);
    for (const m of rawMessages) {
      expect(m.deleted_at).toBeInstanceOf(Date);
    }
  });

  it('renaming an older session updates updated_at without changing last_message_at or list order', async () => {
    const s1 = await svc.saveExchange(ALICE, null, 'Older question', answer);
    await new Promise((r) => setTimeout(r, 15));
    const s2 = await svc.saveExchange(ALICE, null, 'Newer question', answer);

    const beforeRename = await svc.get(ALICE, s1.session_id);
    await new Promise((r) => setTimeout(r, 15));
    const renamed = await svc.rename(ALICE, s1.session_id, 'Older renamed');
    expect(renamed.last_message_at).toBe(beforeRename.last_message_at);
    expect(Date.parse(renamed.updated_at)).toBeGreaterThan(
      Date.parse(beforeRename.updated_at),
    );

    const list = await http()
      .get('/api/v1/chat-sessions')
      .set(as(alice))
      .expect(200);
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([
      s2.session_id,
      s1.session_id,
    ]);
  });

  it("another user's session ➔ 404, and delete does nothing", async () => {
    const { session_id: id } = await svc.saveExchange(
      ALICE,
      null,
      'mine',
      answer,
    );
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

  it('rejects mutations and reads on soft-deleted sessions (404) and handles malformed IDs', async () => {
    const s = await svc.saveExchange(ALICE, null, 'to be deleted', answer);
    await http()
      .delete(`/api/v1/chat-sessions/${s.session_id}`)
      .set(as(alice))
      .expect(204);

    // After soft-delete, GET and PATCH return 404, repeated DELETE returns 204
    await http()
      .get(`/api/v1/chat-sessions/${s.session_id}`)
      .set(as(alice))
      .expect(404);
    await http()
      .patch(`/api/v1/chat-sessions/${s.session_id}`)
      .set(as(alice))
      .send({ title: 'New title' })
      .expect(404);
    await expect(
      svc.saveExchange(ALICE, s.session_id, 'q', answer),
    ).rejects.toThrow('session not found');
    await http()
      .delete(`/api/v1/chat-sessions/${s.session_id}`)
      .set(as(alice))
      .expect(204);

    // Malformed UUIDs on PATCH and DELETE
    await http()
      .patch('/api/v1/chat-sessions/not-a-uuid')
      .set(as(alice))
      .send({ title: 'New title' })
      .expect(404);
    await http()
      .delete('/api/v1/chat-sessions/not-a-uuid')
      .set(as(alice))
      .expect(204);
  });

  it('assertOwned verifies ownership and rejects non-owners, soft-deleted sessions, and invalid UUIDs', async () => {
    const s = await svc.saveExchange(ALICE, null, 'ownership test', answer);
    await expect(svc.assertOwned(s.session_id, ALICE)).resolves.toBeUndefined();
    await expect(svc.assertOwned(s.session_id, BOB)).rejects.toThrow(
      'session not found',
    );
    await expect(svc.assertOwned('not-a-uuid', ALICE)).rejects.toThrow(
      'session not found',
    );

    await svc.remove(ALICE, s.session_id);
    await expect(svc.assertOwned(s.session_id, ALICE)).rejects.toThrow(
      'session not found',
    );
  });

  it('returns exact 10 sessions with has_more=false and next_cursor=null when count is exactly 10', async () => {
    for (let i = 1; i <= 10; i++) {
      await svc.saveExchange(ALICE, null, `Boundary Q${i}`, answer);
      await new Promise((r) => setTimeout(r, 5));
    }
    const res = await http()
      .get('/api/v1/chat-sessions')
      .set(as(alice))
      .expect(200);
    expect(res.body.items).toHaveLength(10);
    expect(res.body.has_more).toBe(false);
    expect(res.body.next_cursor).toBeNull();
  });

  it('paginates with fixed page size 10 and has_more, excluding any message_count = 0 documents', async () => {
    const model = t.app.get<Model<ChatSession>>(
      getModelToken(ChatSession.name),
    );
    const same = new Date('2026-10-20T00:00:00Z');
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) {
      const ts = i < 4 ? same : new Date(same.getTime() + i * 1000);
      const [doc] = await model.create(
        [
          {
            _id: uuidv7(same.getTime() + i),
            user_id: new Types.ObjectId(ALICE),
            title: `s${i}`,
            message_count: 2,
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
    // An unpopulated session with message_count = 0 must never be returned by list()
    await model.create(
      [
        {
          _id: uuidv7(same.getTime() + 99999),
          user_id: new Types.ObjectId(ALICE),
          title: 'empty-session',
          message_count: 0,
          last_message_at: new Date(same.getTime() + 99999),
          created_at: same,
          updated_at: same,
          deleted_at: null,
        },
      ],
      { timestamps: false },
    );

    const seen: string[] = [];
    const pageLengths: number[] = [];
    const hasMoreFlags: boolean[] = [];
    let cursor: string | null = null;
    do {
      const q: string = cursor ? `?cursor=${cursor}` : '';
      const r = await http()
        .get(`/api/v1/chat-sessions${q}`)
        .set(as(alice))
        .expect(200);
      const items = r.body.items as Array<{ id: string }>;
      expect(items.length).toBeLessThanOrEqual(SESSION_PAGE_SIZE);
      pageLengths.push(items.length);
      hasMoreFlags.push(r.body.has_more as boolean);
      seen.push(...items.map((x) => x.id));
      cursor = r.body.next_cursor as string | null;
    } while (cursor);

    expect(pageLengths).toEqual([10, 10, 3]);
    expect(hasMoreFlags).toEqual([true, true, false]);
    expect(new Set(seen).size).toBe(23);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('bad cursor ➔ 400 invalid cursor; client limit query param is rejected ➔ 400', async () => {
    const r = await http()
      .get('/api/v1/chat-sessions?cursor=abc!!')
      .set(as(alice))
      .expect(400);
    expect(r.body.message).toBe('invalid cursor');
    await http()
      .get('/api/v1/chat-sessions?limit=5')
      .set(as(alice))
      .expect(400);
  });

  it('q searches titles case-insensitively, regex characters are literal', async () => {
    const s1 = await svc.saveExchange(ALICE, null, 'q1', answer);
    await svc.rename(ALICE, s1.session_id, 'What is C++ (really)?');
    const s2 = await svc.saveExchange(ALICE, null, 'q2', answer);
    await svc.rename(ALICE, s2.session_id, 'LoRA basics');
    const s3 = await svc.saveExchange(BOB, null, 'q3', answer);
    await svc.rename(BOB, s3.session_id, 'lora for bob');

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

  it('safely handles ReDoS regex strings, blocks NoSQL object injection, and isolates cross-user cursors', async () => {
    const sAlice = await svc.saveExchange(
      ALICE,
      null,
      'Regex search target',
      answer,
    );
    await svc.saveExchange(BOB, null, 'Bob session', answer);

    // ReDoS and unescaped regex strings in ?q=
    const redosPayload = encodeURIComponent('((((a+)+)+)+)$');
    const r1 = await http()
      .get(`/api/v1/chat-sessions?q=${redosPayload}`)
      .set(as(alice))
      .expect(200);
    expect(r1.body.items).toEqual([]);

    const unescapedBracket = encodeURIComponent('[a-z');
    const r2 = await http()
      .get(`/api/v1/chat-sessions?q=${unescapedBracket}`)
      .set(as(alice))
      .expect(200);
    expect(r2.body.items).toEqual([]);

    // NoSQL object injection in query string (?q[$ne]=test) -> 400 Bad Request
    await http()
      .get('/api/v1/chat-sessions?q[$ne]=test')
      .set(as(alice))
      .expect(400);

    // Malformed / tampered cursor payloads in base64
    const tamperedCursor = Buffer.from(
      JSON.stringify({ m: { $gt: '' }, id: 'not-uuid' }),
    ).toString('base64url');
    await http()
      .get(`/api/v1/chat-sessions?cursor=${tamperedCursor}`)
      .set(as(alice))
      .expect(400);

    // Cross-user cursor: Bob uses Alice's cursor -> Bob only sees Bob's sessions
    const fakeCursorFromAlice = encodeCursor({
      m: new Date().toISOString(),
      id: sAlice.session_id,
    });
    const bobList = await http()
      .get(`/api/v1/chat-sessions?cursor=${fakeCursorFromAlice}`)
      .set(as(bob))
      .expect(200);
    for (const item of bobList.body.items) {
      expect(item.id).not.toBe(sAlice.session_id);
    }
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

    const initialTitle = (await svc.get(ALICE, first.session_id)).title;
    expect(initialTitle).toMatch(TIMESTAMP_TITLE_RE);

    await store.saveExchange(ALICE, first.session_id, 'And QLoRA?', answer);
    const r = await http()
      .get(`/api/v1/chat-sessions/${first.session_id}`)
      .set(as(alice))
      .expect(200);
    expect(r.body.title).toBe(initialTitle);
    expect(r.body.message_count).toBe(4);
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
    expect(list.body.has_more).toBe(false);
    expect(list.body.items[0]).toMatchObject({
      id: first.session_id,
      message_count: 4,
      last_message_at: expect.any(String),
    });
  });

  it("saveExchange into someone else's session ➔ 404 and nothing written", async () => {
    const s = await svc.saveExchange(ALICE, null, 'mine', answer);
    await expect(
      svc.saveExchange(BOB, s.session_id, 'q', answer),
    ).rejects.toThrow('session not found');
    expect((await svc.get(ALICE, s.session_id)).messages).toHaveLength(2);
  });

  it('caps messages at MAX_MESSAGES (200) and returns the newest 200 in chronological order', async () => {
    const s = await svc.saveExchange(ALICE, null, 'Initial question', answer);
    const messageModel = t.app.get<Model<ChatMessage>>(
      getModelToken(ChatMessage.name),
    );
    const now = Date.now();
    const batch = [];
    for (let i = 1; i <= 203; i++) {
      const msgDate = new Date(now + i * 10);
      batch.push({
        _id: uuidv7(now + i * 10),
        session_id: s.session_id,
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `Message ${i}`,
        created_at: msgDate,
        updated_at: msgDate,
        deleted_at: null,
      });
    }
    await messageModel.insertMany(batch);

    // Total messages in DB: 2 initial + 203 synthetic = 205 messages
    const totalCount = await messageModel.countDocuments({
      session_id: s.session_id,
    });
    expect(totalCount).toBe(205);

    const got = await http()
      .get(`/api/v1/chat-sessions/${s.session_id}`)
      .set(as(alice))
      .expect(200);

    expect(got.body.messages).toHaveLength(MAX_MESSAGES);
    // Oldest 5 messages omitted; newest 200 preserved in chronological order
    expect(got.body.messages[0].content).toBe('Message 4');
    expect(got.body.messages[got.body.messages.length - 1].content).toBe(
      'Message 203',
    );
  });

  it('rejects query parameters exceeding maximum length (q > 120, cursor > 512) with 400', async () => {
    const overlongQ = 'a'.repeat(121);
    const r1 = await http()
      .get(`/api/v1/chat-sessions?q=${overlongQ}`)
      .set(as(alice))
      .expect(400);
    const qErrors = Array.isArray(r1.body.message)
      ? r1.body.message
      : [r1.body.message];
    expect(qErrors.some((m: string) => /120/.test(m))).toBe(true);

    const overlongCursor = 'a'.repeat(513);
    const r2 = await http()
      .get(`/api/v1/chat-sessions?cursor=${overlongCursor}`)
      .set(as(alice))
      .expect(400);
    const cursorErrors = Array.isArray(r2.body.message)
      ? r2.body.message
      : [r2.body.message];
    expect(cursorErrors.some((m: string) => /512/.test(m))).toBe(true);
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
      expect((await svc.list(ALICE)).items[0].message_count).toBe(4);
    } finally {
      await t.close();
      await standalone.stop();
    }
  });
});
