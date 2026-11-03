import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { Server } from 'http';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { seed } from '../scripts/seed-qdrant';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { EmbeddingService } from '../src/embedding/embedding.service';
import { HealthService } from '../src/health/health.service';
import { LLM_ENGINE } from '../src/llm/llm-engine';
import { startMongo } from '../src/testing/test-app';
import type { RagStreamEvent } from '../src/types/scientific-rag';
import { QDRANT_CLIENT } from '../src/vector-store/vector-store.service';
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
      .post('/api/v1/auth/register')
      .send({ email, password: 'correct horse', display_name: 'Flow' })
      .expect(201);
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'correct horse' })
      .expect(200);
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
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(200);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: refresh })
      .expect(401);
    await http()
      .post('/api/v1/auth/logout')
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

  it('OpenAPI lists all 17 routes', async () => {
    const doc = await http().get('/api/v1/docs-json').expect(200);
    const ops = Object.entries(
      doc.body.paths as Record<string, Record<string, unknown>>,
    ).flatMap(([path, methods]) =>
      Object.keys(methods).map((m) => `${m.toUpperCase()} ${path}`),
    );
    expect(ops.sort()).toEqual(
      [
        'POST /api/v1/auth/register',
        'POST /api/v1/auth/login',
        'POST /api/v1/auth/refresh',
        'POST /api/v1/auth/logout',
        'GET /api/v1/auth/me',
        'PATCH /api/v1/auth/me',
        'POST /api/v1/auth/change-password',
        'POST /api/v1/rag/chat',
        'POST /api/v1/rag/chat/stream',
        'GET /api/v1/chat-sessions',
        'GET /api/v1/chat-sessions/{id}',
        'PATCH /api/v1/chat-sessions/{id}',
        'DELETE /api/v1/chat-sessions/{id}',
        'GET /api/v1/papers/{paper_id}',
        'GET /api/v1/health',
        'GET /api/v1/health/live',
        'GET /api/v1/health/ready',
      ].sort(),
    );
  });
});
