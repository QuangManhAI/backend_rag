/**
 * Phase 4 — record the Bronze raw objects as manifests.
 *
 * The raw bytes stay in MinIO. This job only records *where* each object is
 * and how big it is — it never downloads the content. The object listing
 * already carries the size and the ETag, so a full manifest pass costs one
 * `ListObjectsV2` per prefix and no GET requests at all.
 *
 * `_id` is `${bucket}/${key}`: the object's identity inside the store.
 *
 * Usage:
 *   ts-node scripts/ingest/ingest-source-objects.ts [--dry-run] [--limit N]
 */
import {
  corpusCollection,
  corpusDb,
  listObjects,
  log,
  s3Client,
} from './lib/ingest-lib';
import { fromBronzeKey } from './lib/source-family';

const DATASET_VERSION = process.env.CORPUS_DATASET_VERSION ?? 'silver-v1';

/** The Bronze families that exist in the bucket. */
const BRONZE_PREFIXES = [
  'bronze/arxiv/',
  'bronze/papers/',
  'bronze/openalex/',
  'bronze/semantic_scholar/',
];

interface ObjectRow {
  _id: string;
  bucket: string;
  key: string;
  source: string;
  source_id: string;
  media_type: string;
  size: number;
  /** The ETag the object store reports — an MD5 for single-part uploads. */
  etag: string | null;
  paper_id: string | null;
  dataset_version: string;
  schema_version: number;
}

/**
 * Maps the key onto a media type.
 *
 * The `.gz` suffix means the object is a compressed HTML document; the
 * compressed byte stream is still `text/html` underneath, so the type records
 * the payload rather than the transfer encoding.
 */
function mediaTypeOf(key: string): string | null {
  if (key.endsWith('.html.gz') || key.endsWith('.html')) return 'text/html';
  if (key.endsWith('.pdf')) return 'application/pdf';
  if (key.endsWith('.json') || key.endsWith('.json.gz')) {
    return 'application/json';
  }
  return null;
}

/**
 * Extracts the original identifier from a Bronze key.
 *
 *   bronze/arxiv/raw_html/2026/2211.16780.html.gz  -> 2211.16780
 *   bronze/papers/2026/2211.16780.json              -> 2211.16780
 *   bronze/semantic_scholar/raw_pdf/2024/<id>.pdf   -> <id>
 */
function sourceIdOf(key: string): string | null {
  const file = key.slice(key.lastIndexOf('/') + 1);
  const stem = file.replace(/\.(html\.gz|html|pdf|json\.gz|json)$/i, '');
  return stem || null;
}

/**
 * Infers the `paper_id` a Bronze object belongs to.
 *
 * arXiv HTML and JSON both carry the bare arXiv identifier, which is exactly
 * the `paper_id` used by the corpus. Semantic Scholar objects use their own
 * hash, which is also a valid `paper_id`.
 *
 * One wrinkle: the Bronze HTML layout writes the old-style arXiv identifier
 * with an underscore (`cs_0510001`) where the corpus uses a slash
 * (`cs/0510001`). The underscore form is converted back so the link resolves.
 */
function paperIdOf(sourceId: string): string | null {
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(sourceId)) return sourceId;
  if (/^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/.test(sourceId)) return sourceId;
  if (/^s2_[0-9a-f]{40}$/.test(sourceId)) return sourceId;
  const oldStyle = /^([a-z-]+(\.[A-Z]{2})?)_(\d{7})(v\d+)?$/.exec(sourceId);
  if (oldStyle) {
    return `${oldStyle[1]}/${oldStyle[3]}${oldStyle[4] ?? ''}`;
  }
  return null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limitIdx = argv.indexOf('--limit');
  const limit =
    limitIdx >= 0 && argv[limitIdx + 1]
      ? Number.parseInt(argv[limitIdx + 1], 10)
      : Number.POSITIVE_INFINITY;

  const target = s3Client();
  const { client, db } = await corpusDb();
  const sourceObjects = corpusCollection(db, 'source_objects');

  let scanned = 0;
  let written = 0;
  let skippedNoFamily = 0;
  let skippedNoMediaType = 0;
  let skippedNoSourceId = 0;
  let linkedToPaper = 0;
  let totalBytes = 0;
  const familyHistogram = new Map<string, number>();
  const mediaHistogram = new Map<string, number>();

  for (const prefix of BRONZE_PREFIXES) {
    const objects = await listObjects(target, prefix);
    log('BRONZE_PREFIX_LISTED', { prefix, objects: objects.length });

    const ops = [];
    for (const obj of objects) {
      if (ops.length >= limit) break;
      scanned += 1;

      const family = fromBronzeKey(obj.key);
      if (!family) {
        skippedNoFamily += 1;
        continue;
      }
      const mediaType = mediaTypeOf(obj.key);
      if (!mediaType) {
        skippedNoMediaType += 1;
        continue;
      }
      const sourceId = sourceIdOf(obj.key);
      if (!sourceId) {
        skippedNoSourceId += 1;
        continue;
      }
      const paperId = paperIdOf(sourceId);

      familyHistogram.set(family, (familyHistogram.get(family) ?? 0) + 1);
      mediaHistogram.set(mediaType, (mediaHistogram.get(mediaType) ?? 0) + 1);
      totalBytes += obj.size;
      if (paperId) linkedToPaper += 1;

      const row: ObjectRow = {
        _id: `${target.bucket}/${obj.key}`,
        bucket: target.bucket,
        key: obj.key,
        source: family,
        source_id: sourceId,
        media_type: mediaType,
        size: obj.size,
        // The listing exposes the ETag (the MD5 of the raw bytes for
        // single-part uploads). It is the integrity handle available without
        // downloading the object, so it is what the manifest records.
        etag: obj.etag,
        paper_id: paperId,
        dataset_version: DATASET_VERSION,
        schema_version: 1,
      };
      ops.push({
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: row,
            // The field was renamed from `sha256` to `etag`: the value was
            // always an ETag, never a SHA-256. The old name is removed so
            // the collection has exactly one integrity field.
            $unset: { sha256: '' },
          },
          upsert: true,
        },
      });
    }

    if (!dryRun && ops.length > 0) {
      const res = await sourceObjects.bulkWrite(ops, { ordered: false });
      written += res.upsertedCount + res.modifiedCount;
    }
    log('BRONZE_PREFIX_DONE', { prefix, written: ops.length });
  }

  log('BRONZE_DONE', {
    scanned,
    written,
    total_bytes: totalBytes,
    linked_to_paper: linkedToPaper,
    skipped_no_family: skippedNoFamily,
    skipped_no_media_type: skippedNoMediaType,
    skipped_no_source_id: skippedNoSourceId,
    family_histogram: Object.fromEntries(familyHistogram),
    media_histogram: Object.fromEntries(mediaHistogram),
  });

  await client.close();
}

main().catch((e) => {
  log('BRONZE_FAILED', { err: String(e), stack: (e as Error).stack });
  process.exit(1);
});
