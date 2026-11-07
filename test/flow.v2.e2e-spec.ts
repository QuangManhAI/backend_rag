import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { EmbeddingService } from '../src/engines/embedding/embedding.service';
import { LLM_ENGINE } from '../src/engines/llm/llm-engine';
import { startMongo } from '../src/testing/test-app';
import type { RagStreamEvent } from '../src/types/scientific-rag';
import { QDRANT_CLIENT } from '../src/engines/vector-store/vector-store.service';
import { fakeEmbedding, FakeLlmEngine, inMemoryQdrant } from './support/fakes';

describe('RAG_TS v2 API End-to-End Flow & RFC 9457 Verification', () => {
  jest.setTimeout(60000);
  let mongo: MongoMemoryReplSet;
  let app: INestApplication;
  const server = () => app.getHttpServer() as Server;
  const http = () => request(server());

  beforeAll(async () => {
    mongo = await startMongo();
    process.env.MONGO_URI = mongo.getUri('rag_ts_v2_e2e');

    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmbeddingService)
      .useValue(fakeEmbedding)
      .overrideProvider(LLM_ENGINE)
      .useValue(new FakeLlmEngine())
      .overrideProvider(QDRANT_CLIENT)
      .useValue(inMemoryQdrant());

    app = (await builder.compile()).createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (mongo) await mongo.stop();
  });

  const events = (body: string) =>
    body
      .split('\n\n')
      .filter((b) => b.startsWith('data: '))
      .map((b) => JSON.parse(b.slice(6)) as RagStreamEvent);

  const stream = (query: string, token?: string) => {
    const r = http()
      .post('/api/v2/rag/queries/stream')
      .send({ query, top_k: 3 })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  it('GET /api/v2 root discovery returns v2 hypermedia links', async () => {
    const res = await http().get('/api/v2').expect(200);
    expect(res.body).toMatchObject({
      name: 'RAG_TS API',
      version: 'v2',
      _links: expect.objectContaining({
        self: { href: '/api/v2' },
        register: { href: '/api/v2/users', method: 'POST' },
        tokens: { href: '/api/v2/auth/tokens', method: 'POST' },
        'tokens-refresh': {
          href: '/api/v2/auth/tokens/refresh',
          method: 'POST',
        },
        'tokens-revoke': { href: '/api/v2/auth/tokens/revoke', method: 'POST' },
      }),
    });
  });

  it('v2 Full lifecycle: register ➔ login ➔ query sync & stream ➔ sessions ➔ refresh ➔ revoke', async () => {
    const email = 'v2_flow@example.com';
    const reg = await http()
      .post('/api/v2/users')
      .send({
        email,
        password: 'correct horse battery',
        display_name: 'V2Flow',
      })
      .expect(201);
    expect(reg.body.user).toMatchObject({ email, display_name: 'V2Flow' });

    // Login
    const login = await http()
      .post('/api/v2/auth/tokens')
      .send({ email, password: 'correct horse battery' })
      .expect(201);
    const access = login.body.access_token as string;
    const refresh = login.body.refresh_token as string;
    expect(access).toBeDefined();

    // GET /users/me
    const me = await http()
      .get('/api/v2/users/me')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(me.body.email).toBe(email);

    // PATCH /users/me
    const updated = await http()
      .patch('/api/v2/users/me')
      .set('Authorization', `Bearer ${access}`)
      .send({ display_name: 'V2Flow Renamed' })
      .expect(200);
    expect(updated.body.display_name).toBe('V2Flow Renamed');

    // Sync Query: POST /api/v2/rag/queries
    const syncRes = await http()
      .post('/api/v2/rag/queries')
      .set('Authorization', `Bearer ${access}`)
      .send({ query: 'Explain LoRA fine tuning', top_k: 2 })
      .expect(200);
    expect(syncRes.body.session_id).toEqual(expect.any(String));

    // Streaming Query: POST /api/v2/rag/queries/stream
    const streamRes = await stream(
      'How does low-rank adaptation work?',
      access,
    ).expect(200);
    const evs = events(streamRes.body as string);
    const done = evs.at(-1);
    expect(done?.type).toBe('done');
    if (done?.type !== 'done') throw new Error('no done event');
    expect(done.session_id).toEqual(expect.any(String));

    // GET /api/v2/chat-sessions with search parameter
    const list = await http()
      .get('/api/v2/chat-sessions?search=low-rank')
      .set('Authorization', `Bearer ${access}`)
      .expect(200);
    expect(list.body.items).toBeDefined();

    // Refresh token: POST /api/v2/auth/tokens/refresh (RFC 6749)
    const rotated = await http()
      .post('/api/v2/auth/tokens/refresh')
      .send({ refresh_token: refresh })
      .expect(201);
    expect(rotated.body.access_token).toBeDefined();

    // Revoke token: POST /api/v2/auth/tokens/revoke (RFC 7009)
    await http()
      .post('/api/v2/auth/tokens/revoke')
      .set('Authorization', `Bearer ${rotated.body.access_token as string}`)
      .send({ refresh_token: rotated.body.refresh_token })
      .expect(204);
  });

  it('RFC 9457: 404 Not Found returns application/problem+json', async () => {
    const res = await http().get('/api/v2/nonexistent-resource').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toEqual({
      type: 'urn:rag:error:not-found',
      title: 'Not Found',
      status: 404,
      detail: expect.stringContaining('/api/v2/nonexistent-resource'),
      instance: '/api/v2/nonexistent-resource',
      request_id: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('RFC 9457: 400 Bad Request returns problem details with invalid_params', async () => {
    const res = await http()
      .post('/api/v2/users')
      .send({ email: 'not-an-email', password: 'short' })
      .expect(400);

    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'urn:rag:error:bad-request',
      title: 'Bad Request',
      status: 400,
      instance: '/api/v2/users',
      request_id: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('Health v2 endpoints answer correctly', async () => {
    const h = await http().get('/api/v2/health').expect(200);
    expect(h.body.status).toBeDefined();
    await http().get('/api/v2/health/live').expect(200, { status: 'ok' });
    await http().get('/api/v2/health/ready').expect(200);
  });
});
