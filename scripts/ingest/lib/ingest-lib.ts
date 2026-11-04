/**
 * Shared plumbing for the corpus ingest scripts.
 *
 * Every script in `scripts/ingest/` is idempotent — it upserts by `_id` — so
 * it can be re-run safely after a partial failure.
 */
import 'dotenv/config';
import { MongoClient, type Collection, type Db } from 'mongodb';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { compressors } from 'hyparquet-compressors';
import { parquetMetadataAsync, parquetReadObjects } from 'hyparquet';

export const CORPUS_DB_NAME = process.env.MONGO_CORPUS_DB ?? 'rag_ts_corpus';

/**
 * Runs an operation, retrying transient network failures.
 *
 * The ingest jobs talk to Qdrant, MongoDB and MinIO through TLS endpoints that
 * occasionally drop a connection under load. A single `fetch failed` should
 * not abort a job that takes an hour, so the retry covers transport-level
 * errors only — a genuine application error propagates immediately.
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  opts: { attempts?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 5;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await op();
    } catch (e) {
      lastError = e;
      const message = String((e as Error)?.message ?? e);
      const transient =
        /fetch failed|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND|network|timeout|socket hang up|connection \d+ to .* closed|connection .* closed|topology was destroyed|server selection|Connection pool/i.test(
          message,
        );
      if (!transient || attempt === attempts) throw e;
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 15_000);
      log('RETRY', {
        label: opts.label ?? 'operation',
        attempt,
        of: attempts,
        backoff_ms: backoff,
        err: message,
      });
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastError;
}

export interface S3Target {
  client: S3Client;
  bucket: string;
}

export function s3Client(): S3Target {
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKeyId = process.env.MINIO_ACCESS_KEY;
  const secretAccessKey = process.env.MINIO_SECRET_KEY;
  const bucket = process.env.MINIO_BUCKET_NAME;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'MinIO is not configured: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY and MINIO_BUCKET_NAME are required.',
    );
  }
  return {
    bucket,
    client: new S3Client({
      endpoint,
      // MinIO ignores the region, but the SDK refuses to sign without one.
      region: process.env.MINIO_REGION ?? 'auto',
      // MinIO serves /{bucket}/{key}; the virtual-host style does not resolve.
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

/**
 * Connects straight to MongoDB.
 *
 * The ingest jobs deliberately bypass the application's tunnel: loading
 * hundreds of thousands of documents through a proxied connection is not
 * viable.
 */
export async function corpusDb(): Promise<{
  client: MongoClient;
  db: Db;
}> {
  const uri = process.env.MONGO_CORPUS_URI ?? process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI or MONGO_CORPUS_URI is required.');
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });
  await client.connect();
  return { client, db: client.db(CORPUS_DB_NAME) };
}

/** A corpus collection, typed so `_id` is the string natural key. */
export function corpusCollection(db: Db, name: string) {
  return db.collection<CorpusDoc>(name);
}

export interface S3Object {
  key: string;
  size: number;
  etag: string | null;
}

/** Lists every object under a prefix, following pagination. */
export async function listObjects(
  target: S3Target,
  prefix: string,
): Promise<S3Object[]> {
  const out: S3Object[] = [];
  let token: string | undefined;
  do {
    const res = await target.client.send(
      new ListObjectsV2Command({
        Bucket: target.bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of res.Contents ?? []) {
      out.push({
        key: o.Key ?? '',
        size: o.Size ?? 0,
        etag: o.ETag ? o.ETag.replaceAll('"', '') : null,
      });
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Lists the "directory" entries directly under a prefix. */
export async function listPrefixes(
  target: S3Target,
  prefix: string,
): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await target.client.send(
      new ListObjectsV2Command({
        Bucket: target.bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const cp of res.CommonPrefixes ?? []) out.push(cp.Prefix ?? '');
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Downloads an object as a byte buffer. */
export async function getBytes(target: S3Target, key: string): Promise<Buffer> {
  return withRetry(
    async () => {
      const res = await target.client.send(
        new GetObjectCommand({ Bucket: target.bucket, Key: key }),
      );
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    { label: `s3.GetObject:${key}` },
  );
}

export type ParquetRow = Record<string, unknown>;

/**
 * Minimal shape of the corpus documents, as seen by the raw driver.
 *
 * The driver's default `Document` type declares `_id` as `ObjectId`, which does
 * not match the corpus, where every `_id` is a string natural key.
 */
export interface CorpusDoc {
  _id: string;
  // The corpus documents have widely varying shapes, so the index signature
  // has to allow any value type for the driver's update filters to type-check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * The mutable array of bulk-write operations.
 *
 * The driver's own type for it is a readonly tuple union, which cannot be
 * pushed into; this alias recovers the element type so the ingest scripts can
 * accumulate operations and hand them to `bulkWrite` in one call.
 */
export type BulkOps =
  NonNullable<
    Parameters<Collection<CorpusDoc>['bulkWrite']>[0]
  > extends readonly (infer T)[]
    ? T[]
    : never;

/**
 * Splits a list of bulk-write operations into batches.
 *
 * A whole partition in a single `bulkWrite` is one enormous round trip that
 * holds the connection open for minutes; when the connection drops, the work
 * before the drop is lost and the retry starts over from zero. Batching keeps
 * each round trip short, so a failure costs one batch, not one partition.
 */
export function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Reads a Parquet file into plain objects.
 *
 * The Silver corpus uses ZSTD compression and nested LIST columns, so the
 * companion codec package is required. INT64 columns arrive as `bigint`.
 */
export async function readParquet(buffer: Buffer): Promise<ParquetRow[]> {
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  await parquetMetadataAsync(ab);
  return (await parquetReadObjects({
    file: ab,
    compressors,
  })) as ParquetRow[];
}

/** Coerces a Parquet INT64 value to a JS number, safely. */
export function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Coerces a Parquet value to a string, treating null as empty. */
export function toStr(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/** Coerces a Parquet value to a string array. */
export function toStrArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => toStr(v)).filter((v) => v.length > 0);
}

/** Logs a progress line with a stable shape. */
export function log(event: string, data: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`,
  );
}
