/**
 * Phase 2 — enrich `papers` from the Silver Parquet corpus in MinIO.
 *
 * Source of truth: `silver/papers/year=<YYYY>/papers.parquet` (metadata) and
 * `silver/chunks/year=<YYYY>/chunks.parquet` (text, section breakdown).
 *
 * Scope note: this job is **Silver-only**. The Bronze raw objects stay in
 * MinIO and are referenced — never downloaded — by Phase 4.
 *
 * The Silver corpus also carries the chunk text, which Qdrant's payload no
 * longer has. So this job writes `paper_chunks` as well, and it is the
 * authoritative source for `text`; Qdrant is only used later for the vector
 * side of the reconciliation.
 *
 * Usage:
 *   ts-node scripts/ingest/enrich-from-silver.ts [--years 2024,2025] [--dry-run]
 */
import { assignChunkIndexes } from '../../src/corpus/chunk-order';
import { chunkTextSha256, paperContentSha256 } from '../../src/corpus/checksum';
import { normalizeName } from '../../src/mining/name-normalizer';
import {
  BulkOps,
  chunked,
  corpusCollection,
  corpusDb,
  getBytes,
  listPrefixes,
  log,
  readParquet,
  s3Client,
  toNumber,
  toStr,
  toStrArray,
  withRetry,
} from './lib/ingest-lib';
import { fromPipelineLabel } from './lib/source-family';

const DATASET_VERSION = process.env.CORPUS_DATASET_VERSION ?? 'silver-v1';

/**
 * How many operations go into one `bulkWrite`.
 *
 * A whole partition in a single call is one enormous round trip that holds
 * the connection open for minutes; when the connection drops, everything
 * before the drop is lost. Batches keep each round trip short.
 */
const BATCH_SIZE = 5_000;

interface Args {
  years: string[] | null;
  dryRun: boolean;
  chunks: boolean;
}

function parseArgs(argv: string[]): Args {
  const yearsIdx = argv.indexOf('--years');
  const years =
    yearsIdx >= 0 && argv[yearsIdx + 1]
      ? argv[yearsIdx + 1].split(',').map((y) => y.trim())
      : null;
  return {
    years,
    dryRun: argv.includes('--dry-run'),
    chunks: !argv.includes('--no-chunks'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = s3Client();
  const { client, db } = await corpusDb();

  const papers = corpusCollection(db, 'papers');
  const chunks = corpusCollection(db, 'paper_chunks');

  const yearPrefixes = await listPrefixes(target, 'silver/papers/');
  const years = yearPrefixes
    .map((p) => /^silver\/papers\/year=(\d{4})\/$/.exec(p)?.[1] ?? null)
    .filter((y): y is string => y !== null)
    .sort();

  const wanted =
    args.years && args.years.length > 0
      ? years.filter((y) => args.years!.includes(y))
      : years;

  log('SILVER_SCAN', {
    years_available: years.length,
    years_selected: wanted.length,
    dry_run: args.dryRun,
  });

  let paperUpserts = 0;
  let chunkUpserts = 0;
  let papersSeen = 0;
  let chunksSeen = 0;
  let missingText = 0;
  let indexed = 0;
  let unindexed = 0;
  const sourceHistogram = new Map<string, number>();

  for (const year of wanted) {
    // ---- metadata -------------------------------------------------------
    const papersKey = `silver/papers/year=${year}/papers.parquet`;
    let paperRows: Record<string, unknown>[] = [];
    try {
      paperRows = await readParquet(await getBytes(target, papersKey));
    } catch (e) {
      log('SILVER_YEAR_SKIPPED', { year, key: papersKey, err: String(e) });
    }

    const paperOps: BulkOps = [];
    for (const row of paperRows) {
      papersSeen += 1;
      const paperId = toStr(row.paper_id);
      if (!paperId) continue;

      const source = fromPipelineLabel(toStr(row.source));
      if (source) {
        sourceHistogram.set(source, (sourceHistogram.get(source) ?? 0) + 1);
      }

      const authors = toStrArray(row.authors);
      const published = toStr(row.published_date);
      const yearNum = published ? Number.parseInt(published, 10) : NaN;

      const set: Record<string, unknown> = {
        source: source ?? 'arxiv',
        title: toStr(row.title),
        authors,
        author_ids: authors.map((a) => normalizeName(a)).filter(Boolean),
        primary_category: toStr(row.primary_category),
        categories: toStrArray(row.categories),
        doi: toStr(row.doi) || null,
        journal_ref: toStr(row.journal_ref) || null,
        abstract: toStr(row.abstract),
        abstract_hash: toStr(row.abstract_hash) || null,
        published_date: published || null,
        crawled_at: toStr(row.crawled_at) || null,
        transformed_at: toStr(row.transformed_at) || null,
        pdf_url: toStr(row.pdf_url) || null,
        html_url: toStr(row.html_url) || null,
        cite_count: toNumber(row.cite_count),
        total_sections: toNumber(row.total_sections),
        total_math_count: toNumber(row.total_math_count),
        total_words: toNumber(row.total_words),
        sections_json: toStr(row.sections_json) || null,
        dataset_version: DATASET_VERSION,
        schema_version: 1,
      };
      if (Number.isFinite(yearNum)) set.year = yearNum;

      paperOps.push({
        updateOne: {
          filter: { _id: paperId },
          update: { $set: set },
          upsert: true,
        },
      });
    }

    if (!args.dryRun && paperOps.length > 0) {
      for (const batch of chunked(paperOps, BATCH_SIZE)) {
        const res = await withRetry(
          () => papers.bulkWrite(batch, { ordered: false }),
          { label: `mongo.papers.bulkWrite:${year}` },
        );
        paperUpserts += res.upsertedCount + res.modifiedCount;
      }
    }

    // ---- chunks ---------------------------------------------------------
    if (!args.chunks) continue;

    const chunksKey = `silver/chunks/year=${year}/chunks.parquet`;
    let chunkRows: Record<string, unknown>[] = [];
    try {
      chunkRows = await readParquet(await getBytes(target, chunksKey));
    } catch (e) {
      log('SILVER_CHUNKS_SKIPPED', { year, key: chunksKey, err: String(e) });
      continue;
    }

    // The reading order is derived from the chunk_id grammar, not inherited
    // from the Parquet row order — the row order is lexicographic, so it puts
    // `_sec10` before `_sec1_p1`.
    const byPaper = new Map<string, string[]>();
    for (const row of chunkRows) {
      const chunkId = toStr(row.chunk_id);
      const paperId = toStr(row.paper_id);
      if (!chunkId || !paperId) continue;
      const list = byPaper.get(paperId);
      if (list) list.push(chunkId);
      else byPaper.set(paperId, [chunkId]);
    }
    const indexOf = new Map<string, number | null>();
    const perPaperChunks = new Map<
      string,
      Array<{ chunk_id: string; text: string }>
    >();
    for (const ids of byPaper.values()) {
      for (const [chunkId, idx] of assignChunkIndexes(
        ids.map((chunk_id) => ({ chunk_id })),
      )) {
        indexOf.set(chunkId, idx);
      }
    }
    for (const row of chunkRows) {
      const chunkId = toStr(row.chunk_id);
      const paperId = toStr(row.paper_id);
      if (!chunkId || !paperId) continue;
      const list = perPaperChunks.get(paperId);
      const entry = { chunk_id: chunkId, text: toStr(row.text) };
      if (list) list.push(entry);
      else perPaperChunks.set(paperId, [entry]);
    }

    const chunkOps: BulkOps = [];
    for (const row of chunkRows) {
      const chunkId = toStr(row.chunk_id);
      const paperId = toStr(row.paper_id);
      if (!chunkId || !paperId) continue;
      chunksSeen += 1;

      const text = toStr(row.text);
      if (!text.trim()) missingText += 1;

      const chunkIndex = indexOf.get(chunkId) ?? null;
      if (chunkIndex === null) unindexed += 1;
      else indexed += 1;

      chunkOps.push({
        updateOne: {
          filter: { _id: chunkId },
          update: {
            $set: {
              paper_id: paperId,
              chunk_index: chunkIndex,
              section_title: toStr(row.section_title) || null,
              section_type: toStr(row.section_type) || null,
              text,
              text_sha256: chunkTextSha256(text),
              word_count: toNumber(row.word_count),
              dataset_version: DATASET_VERSION,
              schema_version: 1,
            },
          },
          upsert: true,
        },
      });
    }

    if (!args.dryRun && chunkOps.length > 0) {
      // The operations are written in batches. A single `bulkWrite` over a
      // whole partition is one enormous round trip: when the connection
      // drops mid-way, everything before the drop is lost and the retry
      // starts over from zero. Batches keep each round trip small, so a
      // failure costs one batch, not one partition.
      for (const batch of chunked(chunkOps, BATCH_SIZE)) {
        const res = await withRetry(
          () => chunks.bulkWrite(batch, { ordered: false }),
          { label: `mongo.chunks.bulkWrite:${year}` },
        );
        chunkUpserts += res.upsertedCount + res.modifiedCount;
      }
    }

    // ---- paper-level integrity digest ----------------------------------
    const digestOps: BulkOps = [];
    for (const [paperId, list] of perPaperChunks) {
      const ordered = [...list].sort((a, b) => {
        const ia = indexOf.get(a.chunk_id);
        const ib = indexOf.get(b.chunk_id);
        return (
          (ia ?? Number.MAX_SAFE_INTEGER) - (ib ?? Number.MAX_SAFE_INTEGER)
        );
      });
      digestOps.push({
        updateOne: {
          filter: { _id: paperId },
          update: {
            $set: { content_sha256: paperContentSha256(ordered) },
          },
          upsert: false,
        },
      });
    }
    if (!args.dryRun && digestOps.length > 0) {
      for (const batch of chunked(digestOps, BATCH_SIZE)) {
        await withRetry(() => papers.bulkWrite(batch, { ordered: false }), {
          label: `mongo.papers.digest:${year}`,
        });
      }
    }

    log('SILVER_YEAR_DONE', {
      year,
      papers: paperRows.length,
      chunks: chunkRows.length,
    });
  }

  // ---- chunk_count per paper -------------------------------------------
  if (!args.dryRun) {
    // The aggregation is a full scan over the whole collection, so it is the
    // longest-running call in the job — and therefore the one most likely to
    // lose its connection. It is retried like every other write.
    const counts = await withRetry(
      () =>
        chunks
          .aggregate<{ _id: string; n: number }>([
            { $group: { _id: '$paper_id', n: { $sum: 1 } } },
          ])
          .toArray(),
      { label: 'mongo.chunks.chunk_count.aggregate' },
    );
    if (counts.length > 0) {
      const countOps = counts.map((c) => ({
        updateOne: {
          filter: { _id: c._id },
          update: { $set: { chunk_count: c.n } },
          upsert: false,
        },
      }));
      for (const batch of chunked(countOps, BATCH_SIZE)) {
        await withRetry(() => papers.bulkWrite(batch, { ordered: false }), {
          label: 'mongo.papers.chunk_count',
        });
      }
    }
  }

  log('SILVER_DONE', {
    papers_seen: papersSeen,
    chunks_seen: chunksSeen,
    paper_upserts: paperUpserts,
    chunk_upserts: chunkUpserts,
    chunks_without_text: missingText,
    chunks_indexed: indexed,
    chunks_unindexed: unindexed,
    source_histogram: Object.fromEntries(sourceHistogram),
  });

  await client.close();
}

main().catch((e) => {
  log('SILVER_FAILED', { err: String(e), stack: (e as Error).stack });
  process.exit(1);
});
