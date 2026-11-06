import { ServiceUnavailableException } from '@nestjs/common';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { AppConfigService } from '../config/app-config.service';
import { createTestApp, startMongo, TestApp } from '../testing/test-app';
import { TreeRouterService } from '../tree-router/tree-router.service';
import type { ChunkPayload } from '../types/scientific-rag';
import {
  VECTOR_STORE_PORT,
  VectorStorePort,
} from '../vector-store/vector-store.service';
import { PapersController } from './papers.controller';
import { orderChunks, PapersService } from './papers.service';

const c = (
  paper: string,
  chunkId: string,
  type: string,
  extra: Partial<ChunkPayload> = {},
): ChunkPayload => ({
  chunk_id: `${paper}_${chunkId}`,
  paper_id: paper,
  title: 'LoRA: Low-Rank Adaptation',
  authors: ['Edward Hu'],
  primary_category: 'cs.CL',
  year: 2021,
  section_title: chunkId,
  section_type: type,
  text: `text ${chunkId}`,
  ...extra,
});

const store: Record<string, ChunkPayload[]> = {
  '2106.09685': [
    c('2106.09685', 'sec10', 'conclusion'),
    c('2106.09685', 'abs', 'abstract'),
    c('2106.09685', 'sec2', 'method'),
  ],
  'openalex:W2594538354': [
    c('openalex:W2594538354', 'abs', 'abstract', {
      primary_category: 'q-bio.NC',
    }),
  ],
};

describe('orderChunks', () => {
  it('abstract first, then natural chunk_id order', () => {
    expect(orderChunks(store['2106.09685']).map((x) => x.chunk_id)).toEqual([
      '2106.09685_abs',
      '2106.09685_sec2',
      '2106.09685_sec10',
    ]);
  });

  it('uses chunk_index when every chunk has one', () => {
    const chunks = [
      c('p', 'b', 'method', { chunk_index: 2 }),
      c('p', 'a', 'method', { chunk_index: 5 }),
      c('p', 'z', 'abstract', { chunk_index: 9 }),
    ];
    expect(orderChunks(chunks).map((x) => x.chunk_id)).toEqual([
      'p_z',
      'p_b',
      'p_a',
    ]);
  });
});

describe('GET /papers/:paper_id', () => {
  let mongo: MongoMemoryReplSet;
  let t: TestApp;
  let calls: string[];
  let fail = false;

  beforeAll(async () => {
    mongo = await startMongo();
    calls = [];
    const vectors: VectorStorePort = {
      search: () => Promise.resolve([]),
      scrollByPaper: (id) => {
        calls.push(id);
        if (fail)
          return Promise.reject(
            new ServiceUnavailableException('qdrant unavailable'),
          );
        return Promise.resolve(store[id] ?? []);
      },
      hasPayloadField: () => Promise.resolve(false),
      ping: () => Promise.resolve(true),
    };
    t = await createTestApp(mongo, {
      imports: [],
      controllers: [PapersController],
      providers: [
        PapersService,
        { provide: VECTOR_STORE_PORT, useValue: vectors },
        {
          provide: TreeRouterService,
          inject: [AppConfigService],
          useFactory: (cfg: AppConfigService) => {
            const r = new TreeRouterService(cfg);
            r.setCategories([
              { index: 0, code: 'cs.CL', name: 'CL' },
              { index: 7, code: 'other', name: 'Other' },
            ]);
            return r;
          },
        },
      ],
    });
  });

  afterAll(async () => {
    await t.close();
    await mongo.stop();
  });

  const http = () => request(t.server());

  it('builds PaperDetail with the abstract first', async () => {
    const r = await http().get('/api/v1/papers/2106.09685').expect(200);
    expect(r.body).toMatchObject({
      paper_id: '2106.09685',
      title: 'LoRA: Low-Rank Adaptation',
      authors: ['Edward Hu'],
      category_index: 0,
      primary_category: 'cs.CL',
      year: 2021,
      abstract: 'text abs',
      has_fulltext: true,
    });
    expect(
      r.body.chunks.map((x: { section_type: string }) => x.section_type),
    ).toEqual(['abstract', 'method', 'discussion']);
  });

  it('accepts a URL-encoded id with ":" and maps unknown categories to "other"', async () => {
    const r = await http()
      .get('/api/v1/papers/openalex%3AW2594538354')
      .expect(200);
    expect(r.body).toMatchObject({
      paper_id: 'openalex:W2594538354',
      category_index: 7,
      has_fulltext: false,
    });
    await http().get('/api/v1/papers/openalex:W2594538354').expect(200);
  });

  it('no chunks ➔ 404 paper not found', async () => {
    const r = await http().get('/api/v1/papers/9999.99999').expect(404);
    expect(r.body.message).toBe('paper not found');
    await http()
      .get(`/api/v1/papers/${'x'.repeat(201)}`)
      .expect(404);
  });

  it('cache hit does not call Qdrant again', async () => {
    calls.length = 0;
    await http().get('/api/v1/papers/2106.09685').expect(200);
    await http().get('/api/v1/papers/2106.09685').expect(200);
    expect(calls).toEqual([]); // cached by the first test
  });

  it('Qdrant down ➔ 503', async () => {
    fail = true;
    const r = await http().get('/api/v1/papers/2310.00297').expect(503);
    expect(r.body.message).toBe('qdrant unavailable');
    fail = false;
  });
});
