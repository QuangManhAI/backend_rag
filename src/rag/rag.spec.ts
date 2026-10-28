import {
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { TokenService } from '../auth/token.service';
import {
  SESSION_STORE,
  SessionStorePort,
} from '../chat-sessions/session-store.port';
import { AppConfigService } from '../config/app-config.service';
import { EMBEDDING_PORT, EmbeddingPort } from '../embedding/embedding.service';
import { AbortedError } from '../llm/llm-queue';
import { LLM_PORT, LlmPort } from '../llm/llm.service';
import { MiningService } from '../mining/mining.service';
import { createTestApp, startMongo, TestApp } from '../testing/test-app';
import { TreeRouterService } from '../tree-router/tree-router.service';
import type { RagStreamEvent, ScoredChunk } from '../types/scientific-rag';
import {
  VECTOR_STORE_PORT,
  VectorStorePort,
} from '../vector-store/vector-store.service';
import { extractCitations } from './citations';
import { RagController } from './rag.controller';
import { RagService, topPapers } from './rag.service';

const hit = (paper: string, score: number, i = 0): ScoredChunk => ({
  chunk_id: `${paper}_sec${i}`,
  paper_id: paper,
  title: `Title ${paper}`,
  authors: [],
  primary_category: 'cs.LG',
  year: 2024,
  section_title: 'Method',
  section_type: 'method',
  text: `text of ${paper}`,
  score,
});

/** Fakes for every port; tests tweak them per case. */
class Fakes {
  hits: ScoredChunk[] = [
    hit('2106.09685', 0.83),
    hit('2106.09685', 0.8, 1),
    hit('2305.14314', 0.7),
  ];
  tokens = [
    'LoRA ',
    'adapts [Paper: 2106.09685, 2305.14314]',
    ' well [Paper: 2106.09685].',
  ];
  llmCalls = 0;
  llmSignal: AbortSignal | null = null;
  llmError: Error | null = null;
  /** Resolves when the LLM has emitted its first token (for abort tests). */
  firstToken!: Promise<void>;
  private markFirst!: () => void;
  hangAfterFirst = false;
  saved: Array<{ userId: string; sessionId: string | null; question: string }> =
    [];
  owned = new Set<string>(['0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b10']);

  constructor() {
    this.firstToken = new Promise((r) => (this.markFirst = r));
  }

  embedding: EmbeddingPort = {
    embedQuery: () => Promise.resolve([1, 0, 0]),
    isReady: () => true,
  };

  vectors: VectorStorePort = {
    search: () => Promise.resolve(this.hits),
    scrollByPaper: () => Promise.resolve([]),
    hasPayloadField: () => Promise.resolve(false),
    ping: () => Promise.resolve(true),
  };

  llm: LlmPort = {
    status: () => ({ ready: true, model_id: 'm', gpu: 'cpu', queue_length: 0 }),
    generate: (_s: string, _u: string, signal: AbortSignal) => {
      this.llmCalls++;
      this.llmSignal = signal;
      const self = this;
      return (async function* () {
        for (const [i, t] of self.tokens.entries()) {
          if (signal.aborted) throw new AbortedError();
          if (self.llmError && i === 1) throw self.llmError;
          yield t;
          if (i === 0) self.markFirst();
          if (self.hangAfterFirst) {
            await new Promise<void>((_, reject) =>
              signal.addEventListener('abort', () =>
                reject(new AbortedError()),
              ),
            );
          }
        }
      })();
    },
  };

  sessions: SessionStorePort = {
    assertOwned: (id: string) =>
      this.owned.has(id)
        ? Promise.resolve()
        : Promise.reject(new NotFoundException('session not found')),
    saveExchange: (userId, sessionId, question) => {
      this.saved.push({ userId, sessionId, question });
      return Promise.resolve({
        session_id: sessionId ?? '0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b11',
        user_message_id: 'u1',
        assistant_message_id: 'a1',
      });
    },
  };
}

function parseSse(text: string): RagStreamEvent[] {
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)) as RagStreamEvent);
}

describe('extractCitations', () => {
  it('splits on commas, dedups, keeps order', () => {
    expect(
      extractCitations(
        'a [Paper: 2106.09685, 2305.14314] b [Paper: 2106.09685] c [Paper:openalex:W1]',
      ),
    ).toEqual(['2106.09685', '2305.14314', 'openalex:W1']);
  });

  it('none ➔ []', () => expect(extractCitations('no refs')).toEqual([]));

  it('accepts a copied context header [Paper ID: id | Title …]', () => {
    expect(
      extractCitations(
        'see [Paper ID: 2403.04303 | Title: "LORS" | Section: Method] and [Paper: 2106.09685]',
      ),
    ).toEqual(['2403.04303', '2106.09685']);
  });
});

describe('topPapers', () => {
  it('groups by paper with the best score, max limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => hit(`p${i}`, i / 100));
    expect(topPapers(many, 5)).toHaveLength(5);
    expect(topPapers(many, 5)[0]).toEqual({ paper_id: 'p39', score: 0.39 });
    expect(topPapers([hit('a', 0.5), hit('a', 0.9), hit('b', 0.7)], 5)).toEqual(
      [
        { paper_id: 'a', score: 0.9 },
        { paper_id: 'b', score: 0.7 },
      ],
    );
  });
});

describe('RAG endpoints', () => {
  let mongo: MongoMemoryReplSet;
  let t: TestApp;
  let f: Fakes;
  let token: string;

  beforeAll(async () => {
    mongo = await startMongo();
  });
  afterAll(() => mongo.stop());

  beforeEach(async () => {
    f = new Fakes();
    t = await createTestApp(mongo, {
      imports: [AuthModule],
      controllers: [RagController],
      providers: [
        RagService,
        { provide: EMBEDDING_PORT, useValue: f.embedding },
        { provide: VECTOR_STORE_PORT, useValue: f.vectors },
        { provide: LLM_PORT, useValue: f.llm },
        { provide: SESSION_STORE, useValue: f.sessions },
        {
          provide: MiningService,
          useFactory: (c: AppConfigService) => new MiningService(c),
          inject: [AppConfigService],
        },
        {
          provide: TreeRouterService,
          useFactory: (c: AppConfigService) => new TreeRouterService(c),
          inject: [AppConfigService],
        },
      ],
    });
    token = (
      await t.app
        .get(TokenService)
        .issue({ id: '64b000000000000000000001', roles: ['user'] }, 'fam')
    ).access_token;
  });
  afterEach(() => t.close());

  const http = () => request(t.server());
  const stream = (body: object, auth?: string) => {
    const r = http()
      .post('/api/v1/rag/chat/stream')
      .send(body)
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
    return auth ? r.set('Authorization', `Bearer ${auth}`) : r;
  };

  it('stream: events in the documented order', async () => {
    const res = await stream({ query: 'How does LoRA work?' }).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    const events = parseSse(res.body as string);
    const shape = events.map((e) =>
      e.type === 'phase' ? `phase:${e.phase}` : e.type,
    );
    expect(shape).toEqual([
      'phase:embedding',
      'phase:flying',
      'route',
      'phase:comparing',
      'compare',
      'phase:found',
      'retrieval',
      'phase:generating',
      'token',
      'token',
      'token',
      'done',
    ]);
    const compare = events.find((e) => e.type === 'compare');
    expect(compare).toEqual({
      type: 'compare',
      candidates: [
        { paper_id: '2106.09685', score: 0.83 },
        { paper_id: '2305.14314', score: 0.7 },
      ],
    });
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: 'done',
      citations: ['2106.09685', '2305.14314'],
      session_id: null,
      message_id: null,
    });
    expect(f.saved).toHaveLength(0); // no JWT ➔ nothing stored
  });

  it('stream with JWT saves the exchange and returns ids in done', async () => {
    const res = await stream({ query: 'LoRA?' }, token).expect(200);
    const done = parseSse(res.body as string).at(-1);
    expect(done).toMatchObject({
      session_id: '0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b11',
      message_id: 'a1',
    });
    expect(f.saved).toEqual([
      {
        userId: '64b000000000000000000001',
        sessionId: null,
        question: 'LoRA?',
      },
    ]);
  });

  it("someone else's session ➔ 404 before streaming", async () => {
    const res = await stream(
      { query: 'x', session_id: '0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b12' },
      token,
    ).expect(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(JSON.parse(res.body as string)).toMatchObject({
      message: 'session not found',
    });
  });

  it('no chunks ➔ fixed answer, LLM not called', async () => {
    f.hits = [];
    const res = await http()
      .post('/api/v1/rag/chat')
      .send({ query: 'unknown topic' })
      .expect(200);
    expect(res.body.answer).toBe(
      'The provided literature does not contain sufficient details regarding this question.',
    );
    expect(res.body.citations).toEqual([]);
    expect(f.llmCalls).toBe(0);
  });

  it('LLM error mid-stream ➔ error event, no done, nothing saved', async () => {
    f.llmError = new ServiceUnavailableException('llm unavailable');
    const res = await stream({ query: 'x' }, token).expect(200);
    const events = parseSse(res.body as string);
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'llm unavailable',
      status: 503,
    });
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(f.saved).toHaveLength(0);
  });

  it('client closes ➔ LLM aborted, nothing saved', async () => {
    f.hangAfterFirst = true;
    await t.app.listen(0);
    const addr = t.server().address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const ctrl = new AbortController();
    const resP = fetch(`http://127.0.0.1:${port}/api/v1/rag/chat/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: 'x' }),
      signal: ctrl.signal,
    });
    const res = await resP;
    const reader = res.body!.getReader();
    await f.firstToken;
    await reader.read();
    ctrl.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect(f.llmSignal?.aborted).toBe(true);
    expect(f.saved).toHaveLength(0);
  });

  it('non-stream: full ChatRes', async () => {
    const res = await http()
      .post('/api/v1/rag/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '  LoRA?  ', top_k: 1 })
      .expect(200);
    expect(res.body).toMatchObject({
      session_id: '0199f0c2-7a3e-7c1d-9a52-3c9d8f1e2b11',
      message_id: 'a1',
      query: 'LoRA?',
      answer:
        'LoRA adapts [Paper: 2106.09685, 2305.14314] well [Paper: 2106.09685].',
      citations: ['2106.09685', '2305.14314'],
      expanded_terms: [],
    });
    expect(res.body.grounded_chunks).toHaveLength(1);
    expect(Object.keys(res.body.timings).sort()).toEqual([
      'embed_ms',
      'llm_ms',
      'rerank_ms',
      'route_ms',
      'search_ms',
      'total_ms',
    ]);
  });

  it('non-stream: LLM 429 is passed through', async () => {
    f.llmError = new HttpException('llm queue is full', 429);
    const res = await http()
      .post('/api/v1/rag/chat')
      .send({ query: 'x' })
      .expect(429);
    expect(res.body.message).toBe('llm queue is full');
  });

  it.each([
    [{}, 'query should not be empty'],
    [{ query: '   ' }, 'query should not be empty'],
    [{ query: 'x'.repeat(2001) }, 'query must be at most 2000 characters'],
    [{ query: 'x', top_k: 21 }, 'top_k must be an integer between 1 and 20'],
    [{ query: 'x', nprobe: 7 }, 'nprobe must be an integer between 1 and 6'],
    [{ query: 'x', category: 'cs.LG OR 1' }, 'validation error'],
    [{ query: 'x', session_id: 'nope' }, 'invalid session_id'],
    [{ query: 'x', extra: 1 }, 'property extra should not exist'],
  ])('400 %#', async (body, message) => {
    const res = await http().post('/api/v1/rag/chat').send(body).expect(400);
    expect(res.body.message).toBe(message);
  });

  it('bad token on an optional route ➔ 401', async () => {
    await http()
      .post('/api/v1/rag/chat')
      .set('Authorization', 'Bearer junk')
      .send({ query: 'x' })
      .expect(401);
  });
});
