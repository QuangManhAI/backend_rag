import { z } from 'zod';

const secret = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters`);

const required = (name: string) =>
  z.string({ error: `${name} is required` }).min(1, `${name} is required`);

const int = (def: number, min: number) =>
  z.coerce.number().int().min(min).default(def);

export const envSchema = z.object({
  PORT: int(3000, 1),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  MONGO_URI: required('MONGO_URI'),
  /** Corpus database. Falls back to MONGO_URI when unset. */
  MONGO_CORPUS_URI: z.string().min(1).optional(),
  MONGO_CORPUS_DB: z.string().min(1).default('rag_ts_corpus'),
  QDRANT_URL: required('QDRANT_URL'),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().min(1).default('scientific_papers_gold'),
  JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
  EMBEDDING_MODEL: z.string().min(1).default('nomic-ai/nomic-embed-text-v1.5'),
  MODEL_PATH: required('MODEL_PATH'),
  LLM_GPU: z.enum(['auto', 'cuda', 'metal', 'vulkan', 'false']).default('auto'),
  LLM_MAX_QUEUE: int(8, 0),
  LLM_CONCURRENCY: int(1, 1),
  LLM_TIMEOUT_MS: int(60000, 1000),
  WORLD_DATA_DIR: required('WORLD_DATA_DIR'),
  MINING_DIR: required('MINING_DIR'),
  CORS_ORIGINS: z.string().default('http://localhost:5174'),

  /**
   * MinIO (S3-compatible) — Bronze raw artefacts and Silver Parquet.
   *
   * Optional: only the ingest scripts need the object store, and they are
   * standalone processes. The running application reads the corpus from
   * MongoDB and never touches MinIO, so an unset value must not stop the
   * server from booting.
   */
  MINIO_ENDPOINT: z.string().min(1).optional(),
  MINIO_ACCESS_KEY: z.string().min(1).optional(),
  MINIO_SECRET_KEY: z.string().min(1).optional(),
  MINIO_BUCKET_NAME: z.string().min(1).optional(),
  /**
   * The S3 SDK requires a region to sign requests, but MinIO ignores its
   * value. `auto` is the conventional choice for S3-compatible stores.
   */
  MINIO_REGION: z.string().min(1).default('auto'),
})
  /** Placeholders shipped in `.env.example`; forbidden once the app runs for real. */
  .superRefine((v, ctx) => {
    const PLACEHOLDER_MARKERS = ['change-me', 'your-secret', 'replace-me'];
    // Production-only guards (prompt_security S1.1): a placeholder or shared secret must never
    // reach a real deployment, and MongoDB must be reached with credentials.
    if (v.NODE_ENV !== 'production') return;
    for (const [name, value] of [
      ['JWT_ACCESS_SECRET', v.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', v.JWT_REFRESH_SECRET],
    ] as const) {
      if (PLACEHOLDER_MARKERS.some((m) => value.toLowerCase().includes(m))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `${name} still contains a placeholder value`,
        });
      }
    }
    if (v.JWT_ACCESS_SECRET === v.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
      });
    }
    if (v.MONGO_URI.startsWith('mongodb://') && !v.MONGO_URI.includes('@')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MONGO_URI'],
        message: 'MONGO_URI must contain credentials in production',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n  - ${issues.join('\n  - ')}`);
  }
}

/** Validates the environment; throws EnvValidationError listing every bad variable. */
export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map(
        (i) =>
          `${i.path.join('.')}: ${i.message.replace(/^Invalid input: /, '')}`,
      ),
    );
  }
  return result.data;
}
