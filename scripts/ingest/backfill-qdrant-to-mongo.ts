/**
 * Phase 1 — backfill `papers` and `paper_chunks` from Qdrant.
 *
 * Qdrant holds 1 042 767 points in `scientific_papers_gold`. Its payload
 * carries `chunk_id`, `paper_id`, `year`, `section_type` and
 * `primary_category` — but **no `text`**. So this job supplies the corpus
 * *shape* (which papers exist, which chunks belong to them).
 *
 * The chunk text comes from Silver (Phase 2), which does have it. Both jobs
 * upsert into the same collections, so running them in either order
 * converges on the same result.
 *
 * The point ID is `uuidv5(chunk_id, DNS)`, verified here for every point: a
 * mismatch means the payload was rewritten by a different pipeline, and is
 * reported rather than silently accepted.
 *
 * Usage:
 *   ts-node scripts/ingest/backfill-qdrant-to-mongo.ts [--limit N] [--dry-run]
 */
import { createHash } from 'crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { corpusCollection, corpusDb, log, withRetry } from './lib/ingest-lib';

const DATASET_VERSION = process.env.CORPUS_DATASET_VERSION ?? 'qdrant-v1';

/** RFC 4122 namespace for DNS. */
const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/** Recomputes the UUIDv5 of a chunk id, to check the point id against it. */
function uuidv5Dns(name: string): string {
  const ns = Buffer.from(DNS_NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface QdrantPoint {
  id: string;
  payload?: {
    chunk_id?: string;
    paper_id?: string;
    year?: number;
    section_type?: string;
    primary_category?: string;
    text?: string;
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limitIdx = argv.indexOf('--limit');
  const limit =
    limitIdx >= 0 && argv[limitIdx + 1]
      ? Number.parseInt(argv[limitIdx + 1], 10)
      : Number.POSITIVE_INFINITY;

  const qdrantUrl = process.env.QDRANT_URL;
  const collection = process.env.QDRANT_COLLECTION ?? 'scientific_papers_gold';
  if (!qdrantUrl) throw new Error('QDRANT_URL is required.');

  // The client derives the port from the URL scheme only when it is absent
  // from the URL, and for an https URL without an explicit port it falls back
  // to 6333 — which is not reachable behind the proxy. Passing the port
  // explicitly is what makes the request land.
  const parsed = new URL(qdrantUrl);
  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === 'https:'
      ? 443
      : 6333;

  const qdrant = new QdrantClient({
    url: qdrantUrl,
    port,
    apiKey: process.env.QDRANT_API_KEY,
    timeout: 60_000,
    checkCompatibility: false,
  });

  const { client, db } = await corpusDb();
  const papers = corpusCollection(db, 'papers');
  const chunks = corpusCollection(db, 'paper_chunks');

  // The point count is the hard bound on the scroll: if pagination ever
  // restarts, the loop stops instead of running forever.
  const collectionInfo = await qdrant.getCollection(collection);
  const pointCount = collectionInfo.points_count ?? Number.POSITIVE_INFINITY;
  log('QDRANT_START', {
    collection,
    points_count: pointCount,
    dry_run: dryRun,
  });

  let offset: number | string | null | undefined;
  let scrolled = 0;
  let chunkUpserts = 0;
  let paperUpserts = 0;
  let idMismatches = 0;
  let payloadWithText = 0;
  let missingChunkId = 0;
  const chunkIds = new Set<string>();
  const paperIds = new Set<string>();

  // Qdrant's scroll returns `next_page_offset: null` once the collection is
  // exhausted — *not* `undefined`. Feeding that null back into the next
  // request would restart the pagination from the first point and loop
  // forever, so the terminal offset has to break the loop explicitly.
  for (;;) {
    const page = await withRetry(
      () =>
        qdrant.scroll(collection, {
          limit: 1000,
          offset: offset ?? undefined,
          with_payload: true,
          with_vector: false,
        }),
      { label: 'qdrant.scroll' },
    );
    const points = (page.points ?? []) as QdrantPoint[];
    if (points.length === 0) break;

    const chunkOps: NonNullable<
      Parameters<typeof chunks.bulkWrite>[0]
    > extends readonly (infer T)[]
      ? T[]
      : never = [];
    for (const point of points) {
      scrolled += 1;
      const payload = point.payload ?? {};
      const chunkId = payload.chunk_id;
      if (!chunkId) {
        missingChunkId += 1;
        continue;
      }
      if (payload.text) payloadWithText += 1;

      // The point id must be uuidv5(chunk_id, DNS).
      if (uuidv5Dns(chunkId) !== point.id) idMismatches += 1;

      chunkIds.add(chunkId);
      if (payload.paper_id) paperIds.add(payload.paper_id);

      chunkOps.push({
        updateOne: {
          filter: { _id: chunkId },
          update: {
            $set: {
              paper_id: payload.paper_id ?? '',
              section_type: payload.section_type ?? null,
              dataset_version: DATASET_VERSION,
              schema_version: 1,
            },
          },
          upsert: true,
        },
      });
    }

    if (!dryRun && chunkOps.length > 0) {
      const res = await withRetry(
        () => chunks.bulkWrite(chunkOps, { ordered: false }),
        { label: 'mongo.chunks.bulkWrite' },
      );
      chunkUpserts += res.upsertedCount + res.modifiedCount;
    }

    const next = page.next_page_offset as number | string | null | undefined;
    offset = next ?? null;
    if (scrolled % 100_000 === 0) {
      log('QDRANT_PROGRESS', {
        scrolled,
        chunk_upserts: chunkUpserts,
        id_mismatches: idMismatches,
      });
    }
    if (scrolled >= limit) break;
    // Terminal offset: the collection has been fully scrolled.
    if (next === null || next === undefined) break;
    // Safety net: never scroll past the collection's point count.
    if (scrolled >= pointCount) break;
  }

  // ---- papers ----------------------------------------------------------
  if (!dryRun && paperIds.size > 0) {
    const ops: NonNullable<
      Parameters<typeof papers.bulkWrite>[0]
    > extends readonly (infer T)[]
      ? T[]
      : never = [];
    for (const paperId of paperIds) {
      ops.push({
        updateOne: {
          filter: { _id: paperId },
          update: {
            $set: { dataset_version: DATASET_VERSION, schema_version: 1 },
          },
          upsert: true,
        },
      });
    }
    const res = await withRetry(
      () => papers.bulkWrite(ops, { ordered: false }),
      { label: 'mongo.papers.bulkWrite' },
    );
    paperUpserts += res.upsertedCount + res.modifiedCount;
  }

  log('QDRANT_DONE', {
    scrolled,
    distinct_chunks: chunkIds.size,
    distinct_papers: paperIds.size,
    chunk_upserts: chunkUpserts,
    paper_upserts: paperUpserts,
    point_id_mismatches: idMismatches,
    payload_with_text: payloadWithText,
    points_missing_chunk_id: missingChunkId,
    dry_run: dryRun,
  });

  await client.close();
}

main().catch((e) => {
  log('QDRANT_FAILED', { err: String(e), stack: (e as Error).stack });
  process.exit(1);
});
