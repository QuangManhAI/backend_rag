/**
 * Phase 0c — install the `$jsonSchema` validators on the corpus collections.
 *
 * The spec ([`backend_rag/docs/MONGODB_SCHEMA_DESIGN.md`](../../docs/MONGODB_SCHEMA_DESIGN.md)
 * §10.2) requires a validator with `validationLevel: "strict"` and
 * `validationAction: "error"` on every corpus collection, so malformed data
 * is rejected **at the database** rather than at runtime.
 *
 * MongoDB does not re-validate the documents that already exist when a
 * validator is installed — it validates every subsequent insert and update.
 * The corpus therefore has to be ingested *before* this job runs, or the
 * first write to a not-yet-complete collection would fail.
 *
 * The job is idempotent: `collMod` replaces the validator wholesale.
 *
 * Usage:
 *   ts-node scripts/ingest/apply-validators.ts [--dry-run]
 */
import { corpusDb, log } from './lib/ingest-lib';

type Validator = Record<string, unknown>;

const PAPER_SOURCES = ['arxiv', 'openalex', 'cvf', 'zenodo', 'openreview'];

const MEDIA_TYPES = ['text/html', 'application/pdf', 'application/json'];

const DATASET_SOURCES = ['qdrant', 'silver', 'world', 'mining'];

/** A string `_id` — every corpus collection uses a natural external key. */
const stringId = { bsonType: 'string', minLength: 1, maxLength: 1024 };

const validators: Record<string, Validator> = {
  papers: {
    bsonType: 'object',
    required: ['_id', 'source', 'title', 'dataset_version', 'schema_version'],
    properties: {
      _id: stringId,
      source: { enum: PAPER_SOURCES },
      title: { bsonType: 'string' },
      authors: {
        bsonType: 'array',
        maxItems: 256,
        items: { bsonType: 'string' },
      },
      author_ids: {
        bsonType: 'array',
        maxItems: 256,
        items: { bsonType: 'string' },
      },
      primary_category: { bsonType: 'string' },
      categories: {
        bsonType: 'array',
        maxItems: 32,
        items: { bsonType: 'string' },
      },
      year: { bsonType: ['int', 'double', 'null'], minimum: 1900 },
      doi: { bsonType: ['string', 'null'] },
      journal_ref: { bsonType: ['string', 'null'] },
      abstract: { bsonType: 'string' },
      abstract_hash: { bsonType: ['string', 'null'] },
      published_date: { bsonType: ['string', 'null'] },
      crawled_at: { bsonType: ['string', 'null'] },
      transformed_at: { bsonType: ['string', 'null'] },
      pdf_url: { bsonType: ['string', 'null'] },
      html_url: { bsonType: ['string', 'null'] },
      cite_count: { bsonType: ['int', 'double'], minimum: 0 },
      total_sections: { bsonType: ['int', 'double'], minimum: 0 },
      total_math_count: { bsonType: ['int', 'double'], minimum: 0 },
      total_words: { bsonType: ['int', 'double'], minimum: 0 },
      sections_json: { bsonType: ['string', 'null'] },
      chunk_count: { bsonType: ['int', 'double'], minimum: 0 },
      content_sha256: { bsonType: ['string', 'null'] },
      dataset_version: { bsonType: 'string', minLength: 1 },
      schema_version: { bsonType: ['int', 'double'], minimum: 1 },
    },
  },
  paper_chunks: {
    bsonType: 'object',
    required: [
      '_id',
      'paper_id',
      'text',
      'text_sha256',
      'dataset_version',
      'schema_version',
    ],
    properties: {
      _id: stringId,
      paper_id: { bsonType: 'string', minLength: 1 },
      chunk_index: { bsonType: ['int', 'double', 'null'], minimum: 0 },
      twig_id: { bsonType: ['int', 'double', 'null'] },
      section_title: { bsonType: ['string', 'null'] },
      section_type: { bsonType: ['string', 'null'] },
      text: { bsonType: 'string' },
      text_sha256: { bsonType: 'string', pattern: '^[0-9a-f]{64}$' },
      word_count: { bsonType: ['int', 'double'], minimum: 0 },
      dataset_version: { bsonType: 'string', minLength: 1 },
      schema_version: { bsonType: ['int', 'double'], minimum: 1 },
    },
  },
  source_objects: {
    bsonType: 'object',
    required: [
      '_id',
      'bucket',
      'key',
      'source',
      'source_id',
      'media_type',
      'size',
      'dataset_version',
      'schema_version',
    ],
    properties: {
      _id: stringId,
      bucket: { bsonType: 'string', minLength: 1 },
      key: { bsonType: 'string', minLength: 1 },
      source: { enum: PAPER_SOURCES },
      source_id: { bsonType: 'string', minLength: 1 },
      media_type: { enum: MEDIA_TYPES },
      size: { bsonType: ['int', 'double'], minimum: 0 },
      /**
       * The ETag the object store reports. It is an MD5 for single-part
       * uploads — 32 hex characters — not a SHA-256.
       */
      etag: { bsonType: ['string', 'null'] },
      paper_id: { bsonType: ['string', 'null'] },
      dataset_version: { bsonType: 'string', minLength: 1 },
      schema_version: { bsonType: ['int', 'double'], minimum: 1 },
    },
  },
  authors: {
    bsonType: 'object',
    required: ['_id', 'schema_version'],
    properties: {
      _id: stringId,
      display_name: { bsonType: 'string' },
      pagerank: { bsonType: ['int', 'double'], minimum: 0 },
      degree: { bsonType: ['int', 'double', 'null'], minimum: 0 },
      paper_count: { bsonType: ['int', 'double'], minimum: 0 },
      schema_version: { bsonType: ['int', 'double'], minimum: 1 },
    },
  },
  categories: {
    bsonType: 'object',
    required: ['_id', 'code'],
    properties: {
      _id: stringId,
      code: { bsonType: 'string', minLength: 1 },
      name: { bsonType: 'string' },
      color: { bsonType: 'string' },
    },
  },
  world_nodes: {
    bsonType: 'object',
    required: ['_id', 'depth', 'label', 'schema_version'],
    properties: {
      _id: stringId,
      parent_id: { bsonType: ['string', 'null'] },
      depth: { enum: [0, 1, 2] },
      label: { bsonType: 'string', minLength: 1 },
      vector: { bsonType: ['binData', 'null'] },
      vector_sha256: { bsonType: ['string', 'null'] },
      schema_version: { bsonType: ['int', 'double'], minimum: 1 },
    },
  },
  association_rules: {
    bsonType: 'object',
    required: ['_id', 'antecedents', 'consequents', 'schema_version'],
    properties: {
      _id: stringId,
      antecedents: {
        bsonType: 'array',
        maxItems: 16,
        items: { bsonType: 'string' },
      },
      consequents: {
        bsonType: 'array',
        maxItems: 16,
        items: { bsonType: 'string' },
      },
      support: { bsonType: ['int', 'double'], minimum: 0 },
      confidence: { bsonType: ['int', 'double'], minimum: 0 },
      lift: { bsonType: ['int', 'double'] },
      score: { bsonType: ['int', 'double'] },
      item_prefix: { bsonType: ['string', 'null'] },
      schema_version: { bsonType: ['int', 'double'], minimum: 1 },
    },
  },
  datasets: {
    bsonType: 'object',
    required: ['_id', 'source'],
    properties: {
      _id: stringId,
      source: { enum: DATASET_SOURCES },
      pipeline_version: { bsonType: ['string', 'null'] },
      counts: { bsonType: 'object' },
      content_sha256: { bsonType: ['string', 'null'] },
      ingested_at: { bsonType: ['date', 'null'] },
      qdrant_verified_at: { bsonType: ['date', 'null'] },
      qdrant_drift_count: { bsonType: ['int', 'double'], minimum: 0 },
    },
  },
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const { client, db } = await corpusDb();

  const existing = await db.listCollections().toArray();
  const present = new Set(existing.map((c) => c.name));

  for (const [collection, validator] of Object.entries(validators)) {
    if (!present.has(collection)) {
      log('VALIDATOR_SKIPPED_NO_COLLECTION', { collection });
      continue;
    }
    if (dryRun) {
      log('VALIDATOR_PLANNED', { collection });
      continue;
    }
    await db.command({
      collMod: collection,
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    log('VALIDATOR_APPLIED', { collection });
  }

  // Verify: every collection must report a validator and the strict/error
  // levels, so a partial run is visible in the log.
  const infos = await db.listCollections({}, { nameOnly: false }).toArray();
  const report = infos
    .filter((i) => validators[i.name])
    .map((i) => {
      const options =
        (i as { options?: Record<string, unknown> }).options ?? {};
      return {
        collection: i.name,
        has_validator: Boolean(options.validator),
        validationLevel: options.validationLevel ?? null,
        validationAction: options.validationAction ?? null,
      };
    });
  log('VALIDATORS_DONE', { dry_run: dryRun, report });

  await client.close();
}

main().catch((e) => {
  log('VALIDATORS_FAILED', { err: String(e), stack: (e as Error).stack });
  process.exit(1);
});
