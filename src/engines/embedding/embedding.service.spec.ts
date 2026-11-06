import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { parseEnv } from '../config/env.schema';
import { TEST_ENV } from '../testing/test-app';
import {
  EMBEDDING_DIM,
  EmbeddingService,
  Extractor,
  normalizeQuery,
} from './embedding.service';

const config = new AppConfigService(
  parseEnv({ ...TEST_ENV, MONGO_URI: 'mongodb://x' }),
);

function unit(n = EMBEDDING_DIM): Float32Array {
  const v = new Float32Array(n).fill(1 / Math.sqrt(n));
  return v;
}

class FakeEmbedding extends EmbeddingService {
  calls: string[] = [];
  constructor(private readonly impl: Extractor | Error = async () => unit()) {
    super(config);
  }
  protected loadExtractor(): Promise<Extractor> {
    if (this.impl instanceof Error) return Promise.reject(this.impl);
    const impl = this.impl;
    return Promise.resolve(async (t: string) => {
      this.calls.push(t);
      return impl(t);
    });
  }
}

describe('EmbeddingService', () => {
  it('prefixes search_query: and trims', async () => {
    const s = new FakeEmbedding();
    const v = await s.embedQuery('  transformer   self attention ');
    expect(s.calls).toEqual(['search_query: transformer self attention']);
    expect(v).toHaveLength(EMBEDDING_DIM);
    expect(v.reduce((a, x) => a + x * x, 0)).toBeCloseTo(1, 5);
    expect(s.isReady()).toBe(true);
  });

  it('empty query ➔ 400', async () => {
    await expect(new FakeEmbedding().embedQuery('   ')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('wrong dimension ➔ error', async () => {
    const s = new FakeEmbedding(async () => unit(384));
    await expect(s.embedQuery('x')).rejects.toThrow(/384 dimensions/);
  });

  it('cache hit does not call the model again', async () => {
    const s = new FakeEmbedding();
    await s.embedQuery('lora');
    await s.embedQuery(' lora ');
    expect(s.calls).toHaveLength(1);
  });

  it('model that fails to load ➔ 503 embedding unavailable', async () => {
    const s = new FakeEmbedding(new Error('no model'));
    await expect(s.embedQuery('x')).rejects.toThrow(
      new ServiceUnavailableException('embedding unavailable'),
    );
    expect(s.isReady()).toBe(false);
  });

  it('inference error ➔ 503', async () => {
    const s = new FakeEmbedding(async () => {
      throw new Error('onnx crashed');
    });
    await expect(s.embedQuery('x')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('loads the model once for concurrent callers', async () => {
    let loads = 0;
    class Counting extends FakeEmbedding {
      protected loadExtractor(): Promise<Extractor> {
        loads++;
        return super.loadExtractor();
      }
    }
    const s = new Counting();
    await Promise.all([
      s.embedQuery('a'),
      s.embedQuery('b'),
      s.embedQuery('c'),
    ]);
    expect(loads).toBe(1);
  });

  it('normalizeQuery collapses whitespace', () => {
    expect(normalizeQuery(' a \n\t b ')).toBe('a b');
  });
});
