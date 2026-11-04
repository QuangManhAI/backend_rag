/**
 * Phase 5 — reconcile MongoDB against Qdrant.
 *
 * The job compares the two stores and records the outcome in `datasets`:
 *
 *   - every chunk in MongoDB must exist in Qdrant with the same `chunk_id`;
 *   - the chunk text — when Qdrant's payload carries it — must hash to the
 *     same `text_sha256`;
 *   - the per-paper `content_sha256` must match a recomputation over the
 *     chunks in reading order.
 *
 * A non-zero drift count is reported, never repaired silently: re-writing
 * Qdrant behind the operator's back would hide a pipeline bug.
 *
 * Usage:
 *   ts-node scripts/ingest/reconcile-qdrant.ts [--sample N] [--dry-run]
 */
import { createHash } from 'crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { corpusCollection, corpusDb, log, withRetry } from './lib/ingest-lib';
import {
  datasetContentSha256,
  paperContentSha256,
} from '../../src/corpus/checksum';

const DATASET_VERSION = process.env.CORPUS_DATASET_VERSION ?? 'silver-v1';

interface QdrantPoint {
  id: string;
  payload?: {
    chunk_id?: string;
    paper_id?: string;
    text?: string;
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const sampleIdx = argv.indexOf('--sample');
  const sample =
    sampleIdx >= 0 && argv[sampleIdx + 1]
      ? Number.parseInt(argv[sampleIdx + 1], 10)
      : 0;

  const qdrantUrl = process.env.QDRANT_URL;
  const collectionName =
    process.env.QDRANT_COLLECTION ?? 'scientific_papers_gold';
  if (!qdrantUrl) throw new Error('QDRANT_URL is required.');

  // The port must be passed explicitly: for an https URL without one the
  // client falls back to 6333, which the proxy does not serve.
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
    timeout: 120_000,
    checkCompatibility: false,
  });

  const { client, db } = await corpusDb();
  const chunks = corpusCollection(db, 'paper_chunks');
  const papers = corpusCollection(db, 'papers');
  const datasets = corpusCollection(db, 'datasets');

  // The point count is the hard bound on the scroll: if pagination ever
  // restarts, the loop stops instead of running forever.
  const collectionInfo = await qdrant.getCollection(collectionName);
  const pointCount = collectionInfo.points_count ?? Number.POSITIVE_INFINITY;

  // ---- Qdrant side ------------------------------------------------------
  const qdrantChunks = new Map<string, string | null>();
  let offset: number | string | null | undefined;
  let scrolled = 0;
  let payloadWithText = 0;
  // `next_page_offset` is `null` at the end of the collection, not
  // `undefined`; feeding it back would restart the pagination from the first
  // point and loop forever.
  for (;;) {
    const page = await withRetry(
      () =>
        qdrant.scroll(collectionName, {
          limit: 1000,
          offset: offset ?? undefined,
          with_payload: true,
          with_vector: false,
        }),
      { label: 'qdrant.scroll' },
    );
    const points = (page.points ?? []) as QdrantPoint[];
    if (points.length === 0) break;
    for (const p of points) {
      const chunkId = p.payload?.chunk_id;
      if (!chunkId) continue;
      const text = p.payload?.text ?? null;
      if (text !== null) payloadWithText += 1;
      qdrantChunks.set(chunkId, text);
      scrolled += 1;
    }
    const next = page.next_page_offset as number | string | null | undefined;
    offset = next ?? null;
    if (next === null || next === undefined) break;
    if (scrolled >= pointCount) break;
  }

  log('QDRANT_SCROLLED', {
    scrolled,
    payload_with_text: payloadWithText,
    note:
      payloadWithText === 0
        ? 'Qdrant carries no text payload; only the identifier set can be compared'
        : undefined,
  });

  // ---- Mongo side -------------------------------------------------------
  const mongoCount = await chunks.countDocuments();
  let missingInQdrant = 0;
  let extraInQdrant = 0;
  let textMismatch = 0;
  let textCompared = 0;
  let paperDigestMismatch = 0;
  let papersChecked = 0;
  const missingSamples: string[] = [];
  const extraSamples: string[] = [];

  const cursor = chunks.find(
    {},
    { projection: { chunk_id: 1, text: 1, text_sha256: 1, paper_id: 1 } },
  );
  const mongoChunkIds = new Set<string>();
  for await (const doc of cursor) {
    const chunkId = doc._id;
    mongoChunkIds.add(chunkId);
    if (!qdrantChunks.has(chunkId)) {
      missingInQdrant += 1;
      if (missingSamples.length < 10) missingSamples.push(chunkId);
      continue;
    }
    const qdrantText = qdrantChunks.get(chunkId) ?? null;
    if (qdrantText !== null && typeof doc.text_sha256 === 'string') {
      const local = createHash('sha256')
        .update(String(doc.text ?? ''), 'utf8')
        .digest('hex');
      textCompared += 1;
      if (local !== doc.text_sha256) {
        // The MongoDB copy disagrees with its own recorded digest.
        textMismatch += 1;
      } else if (
        createHash('sha256').update(qdrantText, 'utf8').digest('hex') !== local
      ) {
        // The two stores disagree about the text.
        textMismatch += 1;
      }
    }
  }

  // The set difference is computed in memory — one query per chunk would be
  // a million round trips.
  for (const chunkId of qdrantChunks.keys()) {
    if (!mongoChunkIds.has(chunkId)) {
      extraInQdrant += 1;
      if (extraSamples.length < 10) extraSamples.push(chunkId);
    }
  }

  // ---- per-paper digests -------------------------------------------------
  const paperCursor = papers.find(
    {},
    { projection: { content_sha256: 1, chunk_count: 1 } },
  );
  for await (const paper of paperCursor) {
    papersChecked += 1;
    if (sample > 0 && papersChecked > sample) break;
    const recorded: unknown = paper.content_sha256;
    if (typeof recorded !== 'string' || !recorded) continue;
    const paperChunks = await chunks
      .find({ paper_id: paper._id })
      .sort({ chunk_index: 1 })
      .toArray();
    const recomputed = paperContentSha256(
      paperChunks.map((c: { _id: string; text?: unknown }) => ({
        chunk_id: c._id,
        text: typeof c.text === 'string' ? c.text : '',
      })),
    );
    if (recomputed !== recorded) paperDigestMismatch += 1;
  }

  // ---- dataset stamp -----------------------------------------------------
  const counts: Record<string, number> = {
    papers: await papers.countDocuments(),
    paper_chunks: mongoCount,
    source_objects: await db.collection('source_objects').countDocuments(),
    authors: await db.collection('authors').countDocuments(),
    association_rules: await db
      .collection('association_rules')
      .countDocuments(),
  };
  const paperDigests = await papers
    .find({ content_sha256: { $exists: true, $ne: '' } })
    .project<{ _id: string; content_sha256: string }>({
      _id: 1,
      content_sha256: 1,
    })
    .toArray();
  const datasetDigest = datasetContentSha256(
    paperDigests.map((p) => ({
      paper_id: p._id,
      content_sha256: p.content_sha256,
    })),
    counts,
  );

  const driftCount = missingInQdrant + extraInQdrant + textMismatch;
  const now = new Date();

  if (!dryRun) {
    await datasets.updateOne(
      { _id: DATASET_VERSION },
      {
        $set: {
          source: 'qdrant',
          pipeline_version: process.env.PIPELINE_VERSION ?? null,
          counts,
          content_sha256: datasetDigest,
          ingested_at: now,
          qdrant_verified_at: now,
          qdrant_drift_count: driftCount,
        },
        $setOnInsert: { dataset_version: DATASET_VERSION },
      },
      { upsert: true },
    );
  }

  log('RECONCILE_DONE', {
    dataset_version: DATASET_VERSION,
    qdrant_points: qdrantChunks.size,
    mongo_chunks: mongoCount,
    missing_in_qdrant: missingInQdrant,
    extra_in_qdrant: extraInQdrant,
    text_compared: textCompared,
    text_mismatch: textMismatch,
    papers_checked: papersChecked,
    paper_digest_mismatch: paperDigestMismatch,
    drift_count: driftCount,
    dataset_content_sha256: datasetDigest,
    missing_samples: missingSamples,
    extra_samples: extraSamples,
    dry_run: dryRun,
  });

  await client.close();
}

main().catch((e) => {
  log('RECONCILE_FAILED', { err: String(e), stack: (e as Error).stack });
  process.exit(1);
});
