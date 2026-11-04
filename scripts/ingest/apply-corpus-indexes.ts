/**
 * Phase 0b — create the corpus indexes declared in
 * [`backend_rag/docs/MONGODB_SCHEMA_DESIGN.md`](../../docs/MONGODB_SCHEMA_DESIGN.md)
 * §10.1.
 *
 * The Mongoose schemas declare the same indexes, but `autoIndex` is off in
 * production and a schema is not a migration: this job is what actually
 * creates them on an existing database. It is idempotent — `createIndex` on an
 * index that already exists is a no-op.
 *
 * The index list is kept here rather than derived from the schemas because the
 * script talks to MongoDB with the raw driver, on a database that the running
 * application may not have connected to yet.
 *
 * Usage:
 *   ts-node scripts/ingest/apply-corpus-indexes.ts [--dry-run]
 */
import { corpusDb, log } from './lib/ingest-lib';

interface IndexSpec {
  name: string;
  key: Record<string, 1 | -1>;
  options?: Record<string, unknown>;
}

/**
 * The corpus indexes.
 *
 * Every one of them must have a query behind it — a query that never runs is
 * a write cost with no payoff. The purpose column states that query.
 */
const INDEXES: Record<string, IndexSpec[]> = {
  papers: [
    {
      name: 'papers_doi_unique',
      key: { doi: 1 },
      options: { unique: true, sparse: true },
    },
    {
      name: 'papers_primary_category_year',
      key: { primary_category: 1, year: -1 },
    },
    {
      name: 'papers_author_ids',
      key: { author_ids: 1 },
    },
    {
      name: 'papers_source_year',
      key: { source: 1, year: -1 },
    },
    { name: 'papers_dataset_version', key: { dataset_version: 1 } },
  ],
  paper_chunks: [
    {
      name: 'paper_chunks_paper_id_chunk_index',
      key: { paper_id: 1, chunk_index: 1 },
    },
    { name: 'paper_chunks_dataset_version', key: { dataset_version: 1 } },
  ],
  source_objects: [
    { name: 'source_objects_paper_id', key: { paper_id: 1 } },
    {
      name: 'source_objects_source_source_id',
      key: { source: 1, source_id: 1 },
    },
    { name: 'source_objects_etag', key: { etag: 1 } },
    { name: 'source_objects_dataset_version', key: { dataset_version: 1 } },
  ],
  authors: [{ name: 'authors_pagerank', key: { pagerank: -1 } }],
  categories: [],
  world_nodes: [
    { name: 'world_nodes_depth', key: { depth: 1 } },
    { name: 'world_nodes_parent_id', key: { parent_id: 1 } },
  ],
  association_rules: [],
  datasets: [],
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const { client, db } = await corpusDb();

  const existing = await db.listCollections().toArray();
  const present = new Set(existing.map((c) => c.name));

  for (const [collection, specs] of Object.entries(INDEXES)) {
    if (!present.has(collection)) {
      // The collection is created by the ingest job that owns it. Creating an
      // empty collection here would leave a phantom collection behind.
      log('INDEXES_SKIPPED_NO_COLLECTION', { collection });
      continue;
    }
    for (const spec of specs) {
      if (dryRun) {
        log('INDEXES_PLANNED', { collection, ...spec });
        continue;
      }
      const name = await db
        .collection(collection)
        .createIndex(spec.key, { name: spec.name, ...spec.options });
      log('INDEXES_APPLIED', {
        collection,
        name: name ?? spec.name,
        key: spec.key,
      });
    }
  }

  // Report the result so a run is verifiable from the log alone.
  const report: Array<{ collection: string; indexes: string[] }> = [];
  for (const collection of Object.keys(INDEXES)) {
    if (!present.has(collection)) continue;
    const idx = await db.collection(collection).indexes();
    report.push({
      collection,
      indexes: idx.map((i) => i.name ?? '(unnamed)'),
    });
  }
  log('INDEXES_DONE', { dry_run: dryRun, report });

  await client.close();
}

main().catch((e) => {
  log('INDEXES_FAILED', { err: String(e), stack: (e as Error).stack });
  process.exit(1);
});
