import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync } from 'fs';
import { LRUCache } from 'lru-cache';
import { basename, dirname, resolve } from 'path';
import { AppConfigService } from '../config/app-config.service';

export const EMBEDDING_DIM = 768;
export const QUERY_PREFIX = 'search_query: ';
export const EMBEDDING_UNAVAILABLE = 'embedding unavailable';

/** What the RAG pipeline needs from an embedder; mocked in tests. */
export interface EmbeddingPort {
  embedQuery(q: string): Promise<number[]>;
  isReady(): boolean;
}

export const EMBEDDING_PORT = Symbol('EMBEDDING_PORT');

/** Text ➔ mean-pooled, L2-normalised vector (same as the pipeline's NomicEmbedder). */
export type Extractor = (text: string) => Promise<ArrayLike<number>>;

/** Trim and collapse whitespace: the cache key and the text actually embedded. */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ');
}

@Injectable()
export class EmbeddingService implements EmbeddingPort, OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private extractor: Extractor | null = null;
  private loading: Promise<Extractor | null> | null = null;
  private readonly cache = new LRUCache<string, number[]>({
    max: 500,
    ttl: 10 * 60 * 1000,
  });

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    // Load in the background: the app serves auth/health while the model warms up.
    void this.ensureLoaded();
  }

  isReady(): boolean {
    return this.extractor !== null;
  }

  async embedQuery(q: string): Promise<number[]> {
    const text = normalizeQuery(q);
    if (!text) throw new BadRequestException('query should not be empty');
    const hit = this.cache.get(text);
    if (hit) return hit;

    const extractor = await this.ensureLoaded();
    if (!extractor)
      throw new ServiceUnavailableException(EMBEDDING_UNAVAILABLE);
    let raw: ArrayLike<number>;
    try {
      raw = await extractor(QUERY_PREFIX + text);
    } catch (e) {
      this.logger.error({ err: e }, 'EMBEDDING_FAILED');
      throw new ServiceUnavailableException(EMBEDDING_UNAVAILABLE);
    }
    if (raw.length !== EMBEDDING_DIM) {
      throw new Error(
        `embedding has ${raw.length} dimensions, expected ${EMBEDDING_DIM}`,
      );
    }
    const vector = Array.from(raw);
    this.cache.set(text, vector);
    return vector;
  }

  /** Loads the model once; concurrent callers share the same promise. A failed load can retry. */
  private ensureLoaded(): Promise<Extractor | null> {
    if (this.extractor) return Promise.resolve(this.extractor);
    this.loading ??= this.loadExtractor()
      .then((ex) => {
        this.extractor = ex;
        this.logger.log(
          { model: this.config.get('EMBEDDING_MODEL') },
          'EMBEDDING_READY',
        );
        return ex;
      })
      .catch((e: unknown) => {
        this.logger.error({ err: e }, 'EMBEDDING_LOAD_FAILED');
        this.loading = null;
        return null;
      });
    return this.loading;
  }

  /** Overridden in tests. A local directory is loaded offline, anything else is a Hub id. */
  protected async loadExtractor(): Promise<Extractor> {
    const { pipeline, env } = await import('@huggingface/transformers');
    const model = this.config.get('EMBEDDING_MODEL');
    const local = resolve(model);
    let id = model;
    if (existsSync(local)) {
      env.localModelPath = dirname(local);
      env.allowRemoteModels = false;
      id = basename(local);
    }
    const extract = await pipeline('feature-extraction', id, { dtype: 'fp32' });
    return async (text: string) => {
      const out = await extract(text, { pooling: 'mean', normalize: true });
      return out.data as Float32Array;
    };
  }
}
