import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { parseEnv } from '../config/env.schema';
import { TEST_ENV } from '../testing/test-app';
import {
  QDRANT_TIMEOUT_MS,
  QdrantReader,
  toChunkPayload,
  VectorStoreService,
} from './vector-store.service';

const config = new AppConfigService(
  parseEnv({ ...TEST_ENV, MONGO_URI: 'mongodb://x' }),
);

const payload = (i: number, extra: Record<string, unknown> = {}) => ({
  chunk_id: `p${i}_sec0`,
  paper_id: `p${i}`,
  title: `Paper ${i}`,
  authors: ['A. Author'],
  primary_category: 'cs.LG',
  year: 2024,
  section_title: 'Intro',
  section_type: 'introduction',
  text: `text ${i}`,
  ...extra,
});

function fakeClient(schema: string[] = ['paper_id', 'primary_category']) {
  const query = jest.fn().mockResolvedValue({
    points: [
      { id: 'a', score: 0.9, payload: payload(1) },
      { id: 'b', score: 0.8, payload: { title: 'no ids' } },
    ],
  });
  const scroll = jest.fn();
  const getCollection = jest.fn().mockResolvedValue({
    config: { params: { vectors: { size: 768, distance: 'Cosine' } } },
    payload_schema: Object.fromEntries(
      schema.map((k) => [k, { data_type: 'keyword' }]),
    ),
  });
  const client = { query, scroll, getCollection } as unknown as QdrantReader;
  return { client, query, scroll, getCollection };
}

describe('VectorStoreService', () => {
  it('searches with with_vector false and maps scores', async () => {
    const f = fakeClient();
    const s = new VectorStoreService(f.client, config);
    const hits = await s.search([0.1], { limit: 40 });
    expect(f.query).toHaveBeenCalledWith('scientific_papers_gold', {
      query: [0.1],
      limit: 40,
      filter: undefined,
      with_payload: true,
      with_vector: false,
    });
    expect(hits).toHaveLength(1); // the malformed point is skipped
    expect(hits[0]).toMatchObject({
      chunk_id: 'p1_sec0',
      score: 0.9,
      year: 2024,
    });
  });

  it('category becomes a structured filter', async () => {
    const f = fakeClient();
    await new VectorStoreService(f.client, config).search([0], {
      limit: 5,
      category: 'cs.LG',
    });
    expect(f.query.mock.calls[0][1].filter).toEqual({
      must: [{ key: 'primary_category', match: { value: 'cs.LG' } }],
    });
  });

  it.each(['cs.LG" OR 1=1', 'CS', 'cs.LG; drop', ''])(
    'invalid category %p ➔ 400',
    async (c) => {
      const f = fakeClient();
      await expect(
        new VectorStoreService(f.client, config).search([0], {
          limit: 5,
          category: c,
        }),
      ).rejects.toThrow(new BadRequestException('validation error'));
      expect(f.query).not.toHaveBeenCalled();
    },
  );

  it('filters twigs only when the collection has twig_id', async () => {
    const without = fakeClient();
    await new VectorStoreService(without.client, config).search([0], {
      limit: 5,
      twigIds: [3, 4],
    });
    expect(without.query.mock.calls[0][1].filter).toBeUndefined();

    const withTwig = fakeClient(['paper_id', 'twig_id']);
    await new VectorStoreService(withTwig.client, config).search([0], {
      limit: 5,
      twigIds: [3, 4],
    });
    expect(withTwig.query.mock.calls[0][1].filter).toEqual({
      must: [{ key: 'twig_id', match: { any: [3, 4] } }],
    });
  });

  it('caches the payload schema', async () => {
    const f = fakeClient(['twig_id']);
    const s = new VectorStoreService(f.client, config);
    await s.hasPayloadField('twig_id');
    await s.hasPayloadField('chunk_index');
    expect(f.getCollection).toHaveBeenCalledTimes(1);
  });

  it('client error ➔ 503 qdrant unavailable', async () => {
    const f = fakeClient();
    f.query.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new VectorStoreService(f.client, config).search([0], { limit: 5 }),
    ).rejects.toThrow(new ServiceUnavailableException('qdrant unavailable'));
  });

  it('no answer within 3 s ➔ 503', async () => {
    jest.useFakeTimers();
    try {
      const f = fakeClient();
      f.query.mockReturnValue(new Promise(() => undefined));
      const p = new VectorStoreService(f.client, config).search([0], {
        limit: 5,
      });
      jest.advanceTimersByTime(QDRANT_TIMEOUT_MS + 1);
      await expect(p).rejects.toThrow(ServiceUnavailableException);
    } finally {
      jest.useRealTimers();
    }
  });

  it('scrollByPaper follows pages and filters by paper_id', async () => {
    const f = fakeClient();
    f.scroll
      .mockResolvedValueOnce({
        points: [{ id: 1, payload: payload(1) }],
        next_page_offset: 'n',
      })
      .mockResolvedValueOnce({
        points: [{ id: 2, payload: payload(1, { chunk_id: 'p1_sec1' }) }],
        next_page_offset: null,
      });
    const chunks = await new VectorStoreService(f.client, config).scrollByPaper(
      'p1',
    );
    expect(chunks.map((c) => c.chunk_id)).toEqual(['p1_sec0', 'p1_sec1']);
    expect(f.scroll).toHaveBeenCalledTimes(2);
    const req = f.scroll.mock.calls[0][1];
    expect(req.filter).toEqual({
      must: [{ key: 'paper_id', match: { value: 'p1' } }],
    });
    expect(req.with_vector).toBe(false);
    expect(f.scroll.mock.calls[1][1].offset).toBe('n');
  });

  it('ping reports reachability', async () => {
    const f = fakeClient();
    expect(await new VectorStoreService(f.client, config).ping()).toBe(true);
    f.getCollection.mockRejectedValue(new Error('down'));
    expect(await new VectorStoreService(f.client, config).ping()).toBe(false);
  });
});

describe('toChunkPayload', () => {
  it('fills optional fields with safe defaults', () => {
    expect(
      toChunkPayload({
        chunk_id: 'c',
        paper_id: 'p',
        text: 't',
        year: '2024',
        authors: ['a', 3],
      }),
    ).toEqual({
      chunk_id: 'c',
      paper_id: 'p',
      title: '',
      authors: ['a'],
      primary_category: '',
      year: null,
      section_title: '',
      section_type: 'other',
      text: 't',
    });
  });

  it('keeps twig_id and chunk_index when present', () => {
    expect(
      toChunkPayload({ ...payload(1), twig_id: 7, chunk_index: 2 }),
    ).toMatchObject({ twig_id: 7, chunk_index: 2 });
  });

  it('rejects payloads without ids or text', () => {
    expect(toChunkPayload({ paper_id: 'p', text: 't' })).toBeNull();
    expect(toChunkPayload(null)).toBeNull();
  });
});

describe('VectorStoreService with the corpus', () => {
  const point = (id: string, score = 0.9) => ({
    id,
    score,
    payload: {
      chunk_id: id,
      paper_id: `paper-${id}`,
      year: 2024,
      section_type: 'other',
      primary_category: 'cs.LG',
    },
  });

  function withPoints(points: ReturnType<typeof point>[]) {
    const f = fakeClient();
    f.query.mockResolvedValue({ points });
    return f;
  }

  it('takes text and metadata from the corpus in one batched read', async () => {
    const f = withPoints([point('c1'), point('c2')]);
    const hydrate = jest.fn().mockResolvedValue(
      new Map([
        [
          'c1',
          {
            text: 'from mongo',
            section_title: 'Sec',
            section_type: 'method',
            chunk_index: 3,
            title: 'Title',
            authors: ['A'],
          },
        ],
      ]),
    );
    const s = new VectorStoreService(f.client, config, { hydrate });
    const hits = await s.search([0], { limit: 5 });
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledWith([
      { chunk_id: 'c1', paper_id: 'paper-c1' },
      { chunk_id: 'c2', paper_id: 'paper-c2' },
    ]);
    // c2 is not synced yet: skipped rather than sent to the LLM empty.
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      chunk_id: 'c1',
      text: 'from mongo',
      title: 'Title',
      authors: ['A'],
      section_type: 'method',
      chunk_index: 3,
      score: 0.9,
    });
  });

  it('does not read the corpus for a point that still has its text', async () => {
    const f = fakeClient();
    const hydrate = jest.fn().mockResolvedValue(new Map());
    const s = new VectorStoreService(f.client, config, { hydrate });
    const hits = await s.search([0], { limit: 5 });
    expect(hydrate).toHaveBeenCalledWith([]);
    expect(hits[0].text).toBe('text 1');
  });

  it('a corpus outage fails the search', async () => {
    const f = withPoints([point('c1')]);
    const s = new VectorStoreService(f.client, config, {
      hydrate: () =>
        Promise.reject(new ServiceUnavailableException('corpus unavailable')),
    });
    await expect(s.search([0], { limit: 5 })).rejects.toThrow(
      'corpus unavailable',
    );
  });
});
