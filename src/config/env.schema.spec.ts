import { EnvValidationError, parseEnv } from './env.schema';

const valid = {
  MONGO_URI: 'mongodb://localhost/x',
  QDRANT_URL: 'http://localhost:6333',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  MODEL_PATH: '/models/q.gguf',
  WORLD_DATA_DIR: '/data/world',
  MINING_DIR: '/data/mining',
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const c = parseEnv(valid);
    expect(c.PORT).toBe(3000);
    expect(c.QDRANT_COLLECTION).toBe('scientific_papers_gold');
    expect(c.LLM_MAX_QUEUE).toBe(8);
    expect(c.LLM_GPU).toBe('auto');
  });

  it('coerces numbers', () => {
    expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('lists every missing required variable', () => {
    try {
      parseEnv({});
      fail('expected error');
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      const issues = (e as EnvValidationError).issues.join('\n');
      for (const k of [
        'MONGO_URI',
        'QDRANT_URL',
        'JWT_ACCESS_SECRET',
        'JWT_REFRESH_SECRET',
        'MODEL_PATH',
        'WORLD_DATA_DIR',
        'MINING_DIR',
      ]) {
        expect(issues).toContain(k);
      }
    }
  });

  it('rejects short secrets', () => {
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET must be at least 32 characters/,
    );
  });

  it('rejects an unknown LLM_GPU', () => {
    expect(() => parseEnv({ ...valid, LLM_GPU: 'tpu' })).toThrow(
      EnvValidationError,
    );
  });

  describe('production guards', () => {
    const prod = { ...valid, NODE_ENV: 'production' };

    it('rejects a placeholder secret', () => {
      expect(() =>
        parseEnv({
          ...prod,
          JWT_ACCESS_SECRET: 'change-me-access-secret-32-chars!!',
        }),
      ).toThrow(/placeholder/);
    });

    it('rejects two identical secrets', () => {
      expect(() =>
        parseEnv({
          ...prod,
          JWT_REFRESH_SECRET: 'a'.repeat(32),
        }),
      ).toThrow(/must differ/);
    });

    it('rejects a MongoDB URI without credentials', () => {
      expect(() =>
        parseEnv({ ...prod, MONGO_URI: 'mongodb://localhost:27017/rag_ts' }),
      ).toThrow(/must contain credentials/);
    });

    it('accepts a proper production configuration', () => {
      const c = parseEnv({
        ...prod,
        MONGO_URI: 'mongodb://user:pass@localhost:27017/rag_ts',
      });
      expect(c.NODE_ENV).toBe('production');
    });

    it('trusts no proxy unless the deployment declares one', () => {
      const base = {
        ...prod,
        MONGO_URI: 'mongodb://user:pass@localhost:27017/rag_ts',
      };
      expect(parseEnv(base).TRUST_PROXY_HOPS).toBe(0);
      expect(
        parseEnv({ ...base, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS,
      ).toBe(1);
    });

    it('does not apply the guards outside production', () => {
      const c = parseEnv({
        ...valid,
        JWT_ACCESS_SECRET: 'change-me-access-secret-32-chars!!',
      });
      expect(c.NODE_ENV).toBe('development');
    });
  });
});
