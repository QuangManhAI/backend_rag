import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { AppConfigService } from '../config/app-config.service';
import { EMBEDDING_DIM } from '../embedding/embedding.service';
import type { ChunkPayload, ScoredChunk } from '../types/scientific-rag';

export const QDRANT_UNAVAILABLE = 'qdrant unavailable';
export const MAX_CHUNKS_PER_PAPER = 500;
export const QDRANT_TIMEOUT_MS = 15000;

/** arXiv-style category code, e.g. `cs.LG`, `stat.ML`, `math-ph`. */
export const CATEGORY_RE = /^[a-z-]+(\.[A-Za-z-]+)?$/;

/** The read-only subset of the Qdrant client this service uses (faked in tests). */
export type QdrantReader = Pick<
  QdrantClient,
  'query' | 'scroll' | 'getCollection'
>;
export const QDRANT_CLIENT = Symbol('QDRANT_CLIENT');

export interface SearchOptions {
  limit: number;
  category?: string;
  twigIds?: number[];
}

export interface VectorStorePort {
  search(vector: number[], opts: SearchOptions): Promise<ScoredChunk[]>;
  scrollByPaper(paperId: string): Promise<ChunkPayload[]>;
  hasPayloadField(field: string): Promise<boolean>;
  ping(): Promise<boolean>;
}

export const VECTOR_STORE_PORT = Symbol('VECTOR_STORE_PORT');

type Payload = Record<string, unknown> | null | undefined;
type Condition = { key: string; match: { value: string } | { any: number[] } };

const str = (v: unknown, def = ''): string => (typeof v === 'string' ? v : def);

/** Strictly typed chunk from a Qdrant payload; null when a required field is missing. */
export function toChunkPayload(p: Payload): ChunkPayload | null {
  if (!p) return null;
  const { chunk_id, paper_id, text } = p;
  if (
    typeof chunk_id !== 'string' ||
    typeof paper_id !== 'string' ||
    typeof text !== 'string'
  ) {
    return null;
  }
  const authors = Array.isArray(p.authors)
    ? p.authors.filter((a): a is string => typeof a === 'string')
    : [];
  const chunk: ChunkPayload = {
    chunk_id,
    paper_id,
    title: str(p.title),
    authors,
    primary_category: str(p.primary_category),
    year:
      typeof p.year === 'number' && Number.isInteger(p.year) ? p.year : null,
    section_title: str(p.section_title),
    section_type: str(p.section_type, 'other'),
    text,
  };
  if (typeof p.twig_id === 'number') chunk.twig_id = p.twig_id;
  if (typeof p.chunk_index === 'number') chunk.chunk_index = p.chunk_index;
  return chunk;
}

/**
 * Read-only access to `scientific_papers_gold` (written by the UTH pipeline). Filters are always
 * structured Qdrant conditions, never strings built from user input.
 */
@Injectable()
export class VectorStoreService implements VectorStorePort, OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private readonly collection: string;
  private schema: Promise<Set<string>> | null = null;

  constructor(
    @Inject(QDRANT_CLIENT) private readonly client: QdrantReader,
    config: AppConfigService,
  ) {
    this.collection = config.get('QDRANT_COLLECTION');
  }

  async onModuleInit(): Promise<void> {
    try {
      const info = await this.client.getCollection(this.collection);
      const vectors = info.config.params.vectors;
      const size = vectors && 'size' in vectors ? vectors.size : undefined;
      if (size !== EMBEDDING_DIM) {
        this.logger.error(
          { collection: this.collection, size, expected: EMBEDDING_DIM },
          'QDRANT_DIMENSION_MISMATCH',
        );
      }
      if (!(await this.hasPayloadField('twig_id'))) {
        this.logger.warn(
          { collection: this.collection },
          'QDRANT_NO_TWIG_ID: compare is not restricted to the routed twigs',
        );
      }
    } catch (e) {
      this.logger.error(
        { err: e, collection: this.collection },
        'QDRANT_UNREACHABLE',
      );
    }
  }

  async search(vector: number[], opts: SearchOptions): Promise<ScoredChunk[]> {
    const must: Condition[] = [];
    if (opts.category !== undefined) {
      if (!CATEGORY_RE.test(opts.category))
        throw new BadRequestException('validation error');
      must.push({ key: 'primary_category', match: { value: opts.category } });
    }
    if (opts.twigIds?.length && (await this.hasPayloadField('twig_id'))) {
      must.push({ key: 'twig_id', match: { any: opts.twigIds } });
    }
    const res = await this.call(() =>
      this.client.query(this.collection, {
        query: vector,
        limit: opts.limit,
        filter: must.length ? { must } : undefined,
        with_payload: true,
        with_vector: false,
      }),
    );
    const out: ScoredChunk[] = [];
    for (const p of res.points) {
      const chunk = this.mapOrWarn(p.payload, p.id);
      if (chunk) out.push({ ...chunk, score: p.score });
    }
    return out;
  }

  async scrollByPaper(paperId: string): Promise<ChunkPayload[]> {
    const out: ChunkPayload[] = [];
    let offset: string | number | Record<string, unknown> | null | undefined;
    do {
      const page = await this.call(() =>
        this.client.scroll(this.collection, {
          filter: { must: [{ key: 'paper_id', match: { value: paperId } }] },
          limit: Math.min(256, MAX_CHUNKS_PER_PAPER - out.length),
          offset: offset ?? undefined,
          with_payload: true,
          with_vector: false,
        }),
      );
      for (const p of page.points) {
        const chunk = this.mapOrWarn(p.payload, p.id);
        if (chunk) out.push(chunk);
      }
      offset = page.next_page_offset;
    } while (offset != null && out.length < MAX_CHUNKS_PER_PAPER);
    return out;
  }

  /** True when the collection has a payload index on `field` (cached after the first look). */
  async hasPayloadField(field: string): Promise<boolean> {
    this.schema ??= this.call(() => this.client.getCollection(this.collection))
      .then((info) => new Set(Object.keys(info.payload_schema ?? {})))
      .catch((e: unknown) => {
        this.schema = null;
        throw e;
      });
    return (await this.schema).has(field);
  }

  async ping(): Promise<boolean> {
    try {
      await this.call(() => this.client.getCollection(this.collection));
      return true;
    } catch {
      return false;
    }
  }

  private mapOrWarn(
    payload: Payload,
    id: string | number,
  ): ChunkPayload | null {
    const chunk = toChunkPayload(payload);
    if (!chunk) {
      const chunkId =
        payload && typeof payload.chunk_id === 'string' ? payload.chunk_id : id;
      this.logger.warn(
        { chunk_id: chunkId },
        'QDRANT_CHUNK_SKIPPED: missing required payload',
      );
    }
    return chunk;
  }

  /** Every Qdrant call: 3 s deadline, any failure ➔ 503 `qdrant unavailable`. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('qdrant timeout')),
        QDRANT_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([fn(), deadline]);
    } catch (e) {
      this.logger.warn({ err: e }, 'QDRANT_CALL_FAILED');
      throw new ServiceUnavailableException(QDRANT_UNAVAILABLE);
    } finally {
      clearTimeout(timer);
    }
  }
}
