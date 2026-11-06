import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Server } from 'http';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { seed } from '../scripts/seed-qdrant';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { EmbeddingService } from '../src/engines/embedding/embedding.service';
import { HealthService } from '../src/modules/health/health.service';
import { LLM_ENGINE } from '../src/engines/llm/llm-engine';
import { startMongo } from '../src/testing/test-app';
import type { RagStreamEvent } from '../src/types/scientific-rag';
import { QDRANT_CLIENT } from '../src/engines/vector-store/vector-store.service';
import { fakeEmbedding, FakeLlmEngine, inMemoryQdrant } from './support/fakes';

/**
 * Whole app, real Mongo (in-memory replica set) and real modules; only the models are fakes.
 * Qdrant: in-memory by default, or a real server when E2E_QDRANT_URL is set (a `_test`
 * collection is seeded there first).
 */
describe('RAG_TS end-to-end flow', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication;
  const server = () => app.getHttpServer() as Server;
  const http = () => request(server());

  beforeAll(async () => {
    mongo = await startMongo();
    process.env.MONGO_URI = mongo.getUri('rag_ts_e2e');
    const realQdrant = process.env.E2E_QDRANT_URL;
    if (realQdrant) {
      process.env.QDRANT_URL = realQdrant;
      process.env.QDRANT_COLLECTION = 'rag_ts_e2e_test';
      await seed(
        new QdrantClient({ url: realQdrant, checkCompatibility: false }),
        'rag_ts_e2e_test',
      );
    }
    let builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmbeddingService)
      .useValue(fakeEmbedding)
      .overrideProvider(LLM_ENGINE)
      .useValue(new FakeLlmEngine());
    if (!realQdrant)
      builder = builder
        .overrideProvider(QDRANT_CLIENT)
        .useValue(inMemoryQdrant());
    app = (await builder.compile()).createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  const events = (body: string) =>
    body
      .split('\n\n')
      .filter((b) => b.startsWith('data: '))
      .map((b) => JSON.parse(b.slice(6)) as RagStreamEvent);

  const stream = (query: string, token?: string) => {
    const r = http()
      .post('/api/v1/rag/chat/stream')
      .send({ query, top_k: 3 })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('register ➔ login ➔ ask ➔ sessions ➔ paper ➔ refresh ➔ reuse ➔ logout', async () => {
    const email = 'flow@example.com';
    await http()
      .post('/api/v1/users')
      .send({ email, password: 'correct horse', display_name: 'Flow' })
      .expect(201);
    const login = await http()
      .post('/api/v1/auth/tokens')
      .send({ email, password: 'correct horse' })
      .expect(201);
    const access = login.body.access_token as string;
    const refresh = login.body.refresh_token as string;

    const res = await stream(
      'How does low-rank adaptation work?',
      access,
    ).expect(200);
    const evs = events(res.body as string);
    const done = evs.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') throw new Error('no done event');
    expect(done.session_id).toEqual(expect.any(String));
    const retrieval = evs.find((e) => e.type === 'retrieval');
    if (retrieval?.type !== 'retrieval') throw new Error('no retrieval event');
    const cited = done.citations[0];
    expect(cited).toBe(retrieval.grounded_chunks[0].paper_id);

    const list = await http()
      .get('/api/v1/chat-sessions')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.has_more).toBe(false);
    expect(list.body.items[0]).toMatchObject({
      id: done.session_id,
      message_count: 2,
    });

    const session = await http()
      .get(`/api/v1/chat-sessions/${done.session_id}`)
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(session.body.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(session.body.messages[1].citations).toEqual([cited]);

    const paper = await http()
      .get(`/api/v1/papers/${encodeURIComponent(cited)}`)
      .expect(200);
    expect(paper.body).toMatchObject({ paper_id: cited, has_fulltext: true });
    expect(paper.body.chunks[0].section_type).toBe('abstract');

    const rotated = await http()
      .post('/api/v1/auth/token-rotations')
      .send({ refresh_token: refresh })
      .expect(201);
    await http()
      .post('/api/v1/auth/token-rotations')
      .send({ refresh_token: refresh })
      .expect(401);
    await http()
      .post('/api/v1/auth/token-revocations')
      .set('Authorization', `Bearer ${rotated.body.access_token as string}`)
      .send({ refresh_token: rotated.body.refresh_token })
      .expect(204);
  });

  it('unknown route ➔ 404 with the §1.2 body and X-Request-Id', async () => {
    const res = await http().get('/api/v1/nope').expect(404);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /api/v1/nope',
      request_id: res.headers['x-request-id'],
    });
  });

  it('keeps a valid client request id, replaces an invalid one', async () => {
    const id = '0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b10';
    const ok = await http().get('/api/v1/nope').set('X-Request-Id', id);
    expect(ok.headers['x-request-id']).toBe(id);
    const bad = await http()
      .get('/api/v1/nope')
      .set('X-Request-Id', 'not-a-uuid');
    expect(bad.headers['x-request-id']).not.toBe('not-a-uuid');
  });

  it('asking without a JWT ➔ session_id null', async () => {
    const res = await stream('diffusion models').expect(200);
    expect(events(res.body as string).at(-1)).toMatchObject({
      type: 'done',
      session_id: null,
      message_id: null,
    });
  });

  it('health ok with every dependency up', async () => {
    await app.get(HealthService).check();
    const h = await http().get('/api/v1/health').expect(200);
    expect(h.body).toMatchObject({
      status: 'ok',
      components: { mongo: true, qdrant: true, llm: true },
    });
    await http().get('/api/v1/health/ready').expect(200);
    await http().get('/api/v1/health/live').expect(200, { status: 'ok' });
  });

  it('a repeated chat request replays the stored answer instead of saving twice', async () => {
    const email = 'idem@example.com';
    const reg = await http()
      .post('/api/v1/users')
      .send({ email, password: 'correct horse', display_name: 'Idem' })
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.access_token as string}` };
    const key = '0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b42';
    const body = { query: 'How does low-rank adaptation work?', top_k: 3 };
    const ask = () =>
      http()
        .post('/api/v1/rag/chat')
        .set(auth)
        .set('Idempotency-Key', key)
        .send(body);

    const first = await ask().expect(200);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const second = await ask().expect(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toMatchObject({
      session_id: first.body.session_id,
      message_id: first.body.message_id,
      answer: first.body.answer,
    });
    const replayed = await http()
      .post('/api/v1/rag/chat/stream')
      .set(auth)
      .set('Idempotency-Key', key)
      .send(body)
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      })
      .expect(200);
    expect(replayed.headers['idempotent-replayed']).toBe('true');
    expect(events(replayed.body as string).at(-1)).toMatchObject({
      type: 'done',
      session_id: first.body.session_id,
    });

    const list = await http()
      .get('/api/v1/chat-sessions')
      .set(auth)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].message_count).toBe(2);

    await http()
      .post('/api/v1/rag/chat')
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ ...body, query: 'another question' })
      .expect(409);
    await http()
      .post('/api/v1/rag/chat')
      .set(auth)
      .set('Idempotency-Key', 'not-a-uuid')
      .send(body)
      .expect(400);
  });

  it('wrong method ➔ 405 with Allow; non-JSON body ➔ 415; unknown path stays 404', async () => {
    const res = await http().delete('/api/v1/health').expect(405);
    expect(res.headers.allow).toBe('GET');
    expect(res.body).toMatchObject({
      statusCode: 405,
      error: 'Method Not Allowed',
      request_id: expect.any(String),
    });
    const allow = (await http().put('/api/v1/chat-sessions').expect(405))
      .headers.allow;
    expect(allow).toBe('DELETE, GET');
    await http().get('/api/v1/nope').expect(404);

    const media = await http()
      .post('/api/v1/auth/tokens')
      .set('Content-Type', 'text/plain')
      .send('hello')
      .expect(415);
    expect(media.body).toMatchObject({
      statusCode: 415,
      request_id: expect.any(String),
    });
    await http()
      .post('/api/v1/auth/tokens')
      .set('Content-Type', 'application/json; charset=utf-8')
      .send('{}')
      .expect(400);
  });

  it('batch-reads papers and reports the unknown ones', async () => {
    const hit = await stream('How does low-rank adaptation work?').expect(200);
    const done = events(hit.body as string).at(-1);
    if (done?.type !== 'done') throw new Error('no done event');
    const known = done.citations[0];
    const res = await http()
      .get(`/api/v1/papers?ids=${encodeURIComponent(known)},missing.paper`)
      .expect(200);
    expect(res.body.items.map((p: { paper_id: string }) => p.paper_id)).toEqual(
      [known],
    );
    expect(res.body.not_found).toEqual(['missing.paper']);
    await http().get('/api/v1/papers').expect(400);
  });

  it('accepts and returns XML, negotiated per request', async () => {
    const xml = (r: { text: string }) => r.text;
    const email = 'xml@example.com';
    const created = await http()
      .post('/api/v1/users')
      .set('Content-Type', 'application/xml')
      .set('Accept', 'application/xml')
      .send(
        `<?xml version="1.0"?><user><email>${email}</email><password>1234567890 &amp; more</password><display_name>12345</display_name></user>`,
      )
      .expect(201);
    expect(created.headers['content-type']).toContain('application/xml');
    expect(xml(created)).toContain(`<email>${email}</email>`);
    expect(xml(created)).toContain('<display_name>12345</display_name>');
    expect(xml(created)).toContain('<href>/api/v1/users/me</href>');

    // The password survived as a string with its entity decoded.
    const login = await http()
      .post('/api/v1/auth/tokens')
      .send({ email, password: '1234567890 & more' })
      .expect(201);
    const auth = {
      Authorization: `Bearer ${login.body.access_token as string}`,
    };
    const answer = await http()
      .post('/api/v1/rag/chat')
      .set(auth)
      .set('Content-Type', 'text/xml')
      .send(
        '<chat><query>How does low-rank adaptation work?</query><top_k>3</top_k><expand_query>false</expand_query></chat>',
      )
      .expect(200);
    expect(answer.body.session_id).toEqual(expect.any(String));

    const list = await http()
      .get('/api/v1/chat-sessions')
      .set(auth)
      .set('Accept', 'application/xml, application/json;q=0.5')
      .expect(200);
    expect(xml(list)).toContain('<items>');
    expect(xml(list)).toContain('<has_more>false</has_more>');

    const missing = await http()
      .get('/api/v1/nope')
      .set('Accept', 'application/xml')
      .expect(404);
    expect(xml(missing)).toContain('<statusCode>404</statusCode>');
    await http().get('/api/v1/health').set('Accept', 'image/png').expect(406);
  });

  it('rejects malformed XML and any document type (XXE, entity expansion)', async () => {
    for (const body of [
      '<user><email>a</user>',
      'not xml',
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><user><email>&e;</email></user>',
    ]) {
      const res = await http()
        .post('/api/v1/auth/tokens')
        .set('Content-Type', 'application/xml')
        .send(body)
        .expect(400);
      expect(res.body.message).toBe('invalid xml');
    }
    await http()
      .post('/api/v1/auth/tokens')
      .set('Content-Type', 'application/xml')
      .send('<user><__proto__><polluted>yes</polluted></__proto__></user>')
      .expect(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('responses carry hypermedia links a client can follow', async () => {
    const root = await http().get('/api/v1').expect(200);
    expect(root.body._links.tokens).toEqual({
      href: '/api/v1/auth/tokens',
      method: 'POST',
    });
    const reg = await http()
      .post(root.body._links.register.href as string)
      .send({
        email: 'links@example.com',
        password: 'correct horse',
        display_name: 'Links',
      })
      .expect(201);
    const auth = { Authorization: `Bearer ${reg.body.access_token as string}` };
    for (let i = 0; i < 2; i++) {
      await http()
        .post('/api/v1/rag/chat')
        .set(auth)
        .send({ query: `question ${i}`, top_k: 3 })
        .expect(200);
    }
    const first = await http()
      .get(`${reg.body._links['chat-sessions'].href as string}?limit=1`)
      .set(auth)
      .expect(200);
    expect(first.body._links.self.href).toBe('/api/v1/chat-sessions?limit=1');
    const item = first.body.items[0];
    expect(item._links.rename.method).toBe('PATCH');

    const second = await http()
      .get(first.body._links.next.href as string)
      .set(auth)
      .expect(200);
    expect(second.body.items[0].id).not.toBe(item.id);
    expect(second.body._links.next).toBeUndefined();

    const messages = await http()
      .get(item._links.messages.href as string)
      .set(auth)
      .expect(200);
    expect(messages.body.items).toHaveLength(2);
    await http()
      .get(messages.body._links.session.href as string)
      .set(auth)
      .expect(200);
  });

  describe('API contract (OpenAPI)', () => {
    const operations = async () => {
      const doc = await http().get('/api/v1/docs-json').expect(200);
      return Object.entries(
        doc.body.paths as Record<string, Record<string, unknown>>,
      ).flatMap(([path, methods]) =>
        Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`),
      );
    };

    it('lists exactly the documented routes', async () => {
      expect((await operations()).sort()).toEqual(
        [
          'GET /api/v1',
          'POST /api/v1/users',
          'GET /api/v1/users/me',
          'PATCH /api/v1/users/me',
          'PUT /api/v1/users/me/password',
          'POST /api/v1/auth/tokens',
          'POST /api/v1/auth/token-rotations',
          'POST /api/v1/auth/token-revocations',
          'POST /api/v1/rag/chat',
          'POST /api/v1/rag/chat/stream',
          'GET /api/v1/chat-sessions',
          'DELETE /api/v1/chat-sessions',
          'GET /api/v1/chat-sessions/{id}',
          'PATCH /api/v1/chat-sessions/{id}',
          'DELETE /api/v1/chat-sessions/{id}',
          'GET /api/v1/chat-sessions/{id}/messages',
          'GET /api/v1/papers',
          'GET /api/v1/papers/{paper_id}',
          'GET /api/v1/health',
          'GET /api/v1/health/live',
          'GET /api/v1/health/ready',
          'GET /api/v1/admin/users',
          'GET /api/v1/admin/users/{id}',
          'PUT /api/v1/admin/users/{id}/roles',
          'PUT /api/v1/admin/users/{id}/status',
          'GET /api/v1/admin/users/{id}/tokens',
          'DELETE /api/v1/admin/users/{id}/tokens',
          'GET /api/v1/admin/users/{id}/chat-sessions',
          'GET /api/v1/admin/chat-sessions/{id}',
          'GET /api/v1/admin/chat-sessions/{id}/messages',
          'GET /api/v1/admin/stats',
          'GET /api/v1/admin/login-attempts',
          'GET /api/v1/admin/health',
          'GET /api/v1/admin/audit-logs',
        ].sort(),
      );
    });

    it('follows the design rules: versioned kebab-case nouns, no verbs', async () => {
      // `rag/chat/stream` is the one transport-named route: same resource, SSE representation.
      const VERBS =
        /^(login|logout|register|refresh|disable|enable|revoke|create|update|delete|get|list|change|set)$/;
      for (const op of await operations()) {
        const path = op.split(' ')[1];
        expect(path).toMatch(/^\/api\/v1(\/|$)/);
        for (const seg of path.replace(/^\/api\/v1\/?/, '').split('/')) {
          if (!seg || seg.startsWith('{')) continue;
          expect(seg).toMatch(/^[a-z]+(-[a-z]+)*$/);
          expect(seg).not.toMatch(VERBS);
        }
      }
    });
  });
});
