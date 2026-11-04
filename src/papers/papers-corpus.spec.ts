import { NotFoundException } from '@nestjs/common';
import type { CorpusReaderService } from '../corpus/corpus-reader.service';
import { TreeRouterService } from '../tree-router/tree-router.service';
import type { ChunkPayload } from '../types/scientific-rag';
import type { VectorStorePort } from '../vector-store/vector-store.service';
import { PapersService } from './papers.service';

/**
 * The corpus is the source of truth for the chunk text, but it is filled
 * progressively. These tests pin the rule that decides what happens in the
 * middle of that fill: a **partial** corpus read is never served.
 */
describe('PapersService — corpus read', () => {
  const chunk = (id: string, index: number): ChunkPayload => ({
    chunk_id: id,
    paper_id: 'p1',
    title: 'A paper',
    authors: ['A. Author'],
    primary_category: 'cs.LG',
    year: 2024,
    section_title: id,
    section_type: 'method',
    text: `text ${id}`,
    chunk_index: index,
  });

  const vectors: VectorStorePort = {
    search: () => Promise.resolve([]),
    scrollByPaper: () => Promise.resolve([chunk('p1_a', 0)]),
    hasPayloadField: () => Promise.resolve(false),
    ping: () => Promise.resolve(true),
  };

  const router = {
    categoryIndex: () => 0,
  } as unknown as TreeRouterService;

  const makeCorpus = (
    readPaper: CorpusReaderService['readPaper'],
  ): CorpusReaderService => ({ readPaper }) as unknown as CorpusReaderService;

  it('serves the corpus when the read is complete', async () => {
    const corpus = makeCorpus(() =>
      Promise.resolve({
        paper: {
          _id: 'p1',
          source: 'arxiv',
          title: 'A paper',
          authors: ['A. Author'],
          primary_category: 'cs.LG',
          year: 2024,
          abstract: 'abs',
          chunk_count: 2,
        },
        chunks: [{ ...chunk('p1_a', 0) }, { ...chunk('p1_b', 1) }] as never,
      }),
    );
    const svc = new PapersService(vectors, router, corpus);
    const detail = await svc.get('p1');
    expect(detail.chunks).toHaveLength(2);
  });

  it('falls back to Qdrant when the corpus copy is still incomplete', async () => {
    // The corpus knows about 2 chunks but only one has been written yet.
    const corpus = makeCorpus(() =>
      Promise.resolve({
        paper: {
          _id: 'p1',
          source: 'arxiv',
          title: 'A paper',
          authors: ['A. Author'],
          primary_category: 'cs.LG',
          year: 2024,
          abstract: 'abs',
          chunk_count: 2,
        },
        chunks: [{ ...chunk('p1_a', 0) }] as never,
      }),
    );
    const svc = new PapersService(vectors, router, corpus);
    const detail = await svc.get('p1');
    // The Qdrant fallback served the single chunk it knows about.
    expect(detail.chunks).toHaveLength(1);
  });

  it('404s when neither store knows the paper', async () => {
    const corpus = makeCorpus(() => Promise.resolve(null));
    const emptyVectors: VectorStorePort = {
      ...vectors,
      scrollByPaper: () => Promise.resolve([]),
    };
    const svc = new PapersService(emptyVectors, router, corpus);
    await expect(svc.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
