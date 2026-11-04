# CORPUS_SCHEMA_DESIGN.md — Corpus Collections in MongoDB (Source of Truth)

- **Motivation/Background**: The scientific corpus is currently split across three stores: Qdrant (`scientific_papers_gold`, 1 042 767 points, **no `text` in the payload**), MinIO (Silver Parquet + Bronze raw objects), and the local JSON files the pipeline exports. This document records the implemented MongoDB corpus schema and the verified ingest results, so the corpus has one authoritative store and every drift between the stores is detectable rather than silent.
- **Purpose**: Specify the corpus collections, the integrity model, the derivation rules for `chunk_index`, and the measured outcome of running the ingest pipeline against the live MinIO lakehouse.
- **Overview Pipeline**: The design in [`backend_rag/docs/MONGODB_SCHEMA_DESIGN.md`](MONGODB_SCHEMA_DESIGN.md) Part II was reviewed against the `mongodb-schema-design` agent skill, then implemented in [`backend_rag/src/corpus/`](../src/corpus/). The live lakehouse in MinIO was probed to confirm the Silver and Bronze layouts, the chunk identifier grammar, and the size of each family before the schemas were frozen.
- **Detailed Plan**: §1 What changed and why; §2 The corpus database; §3 Collection specifications; §4 The `chunk_index` derivation; §5 The integrity model; §6 The ingest pipeline; §7 Measured results; §8 Runtime read paths; §9 Open items; §10 Self-review checklist.
- **References**: [`agents/rules/MD_CONVENTION.md`](../../agents/rules/MD_CONVENTION.md), [`backend_rag/docs/MONGODB_SCHEMA_DESIGN.md`](MONGODB_SCHEMA_DESIGN.md), [`backend_rag/src/corpus/checksum.ts`](../src/corpus/checksum.ts), [`backend_rag/src/corpus/chunk-order.ts`](../src/corpus/chunk-order.ts), [`backend_rag/src/corpus/corpus.module.ts`](../src/corpus/corpus.module.ts), [`backend_rag/src/corpus/corpus-reader.service.ts`](../src/corpus/corpus-reader.service.ts), [`backend_rag/scripts/ingest/enrich-from-silver.ts`](../scripts/ingest/enrich-from-silver.ts), [`backend_rag/scripts/ingest/backfill-qdrant-to-mongo.ts`](../scripts/ingest/backfill-qdrant-to-mongo.ts), [`backend_rag/scripts/ingest/ingest-source-objects.ts`](../scripts/ingest/ingest-source-objects.ts), [`backend_rag/scripts/ingest/migrate-world-mining.ts`](../scripts/ingest/migrate-world-mining.ts), [`backend_rag/scripts/ingest/reconcile-qdrant.ts`](../scripts/ingest/reconcile-qdrant.ts), [`backend_rag/src/app.module.ts`](../src/app.module.ts), [`backend_rag/src/config/env.schema.ts`](../src/config/env.schema.ts), [`backend_rag/src/health/health.service.ts`](../src/health/health.service.ts), [`backend_rag/src/papers/papers.service.ts`](../src/papers/papers.service.ts), [`backend_rag/src/tree-router/tree-router.service.ts`](../src/tree-router/tree-router.service.ts), [`backend_rag/src/mining/mining.service.ts`](../src/mining/mining.service.ts).
- **Created**: 2026-11-03T15:54:00+07:00
- **Last Updated**: 2026-11-04T22:20:00+07:00

---

[STATUS: ACTIVE]

## Table of Contents

- [1. What changed and why](#1-what-changed-and-why)
- [2. The corpus database](#2-the-corpus-database)
- [3. Collection specifications](#3-collection-specifications)
- [4. The `chunk_index` derivation](#4-the-chunk_index-derivation)
- [5. The integrity model](#5-the-integrity-model)
- [6. The ingest pipeline](#6-the-ingest-pipeline)
- [7. Measured results](#7-measured-results)
- [8. Runtime read paths](#8-runtime-read-paths)
- [9. Open items](#9-open-items)
- [10. Self-review checklist](#10-self-review-checklist)

---

## 1. What changed and why

The corpus is now a **single MongoDB database** that owns the paper metadata, the chunk text, the raw-object manifests, the world tree and the mining artefacts. Two stores remain, each with a narrower role:

| Store | Role after the change | Why it stays |
| :--- | :--- | :--- |
| **MongoDB `rag_ts_corpus`** | Canonical store for everything textual and structural | Holds the chunk text that Qdrant lost; every other store is derived or referenced. |
| **Qdrant `scientific_papers_gold`** | ANN index + a materialised payload copy | MongoDB has no ANN index. The vectors are rebuilt from `paper_chunks.text` when needed. |
| **MinIO (Bronze)** | The raw bytes | Never copied into MongoDB. Only the manifest (bucket, key, size, media type) is recorded. |

Three facts drove the design, each verified against the live lakehouse rather than assumed:

1. **Qdrant's payload carries no `text`.** All 1 042 767 points were checked: the payload holds only `chunk_id`, `paper_id`, `year`, `section_type` and `primary_category`. The chunk bodies therefore have to come from the **Silver Parquet**, not from Qdrant.
2. **The Silver corpus has the text, and its `chunk_id` values are the same identifiers Qdrant uses.** A join across `silver/chunks/year=YYYY/chunks.parquet` and the Qdrant payload matches on `chunk_id` for the arXiv, CVF and Semantic Scholar families alike.
3. **The Parquet row order is lexicographic, not reading order.** `_sec10` sits before `_sec1_p1` in the file. The reading order therefore has to be *derived*, not inherited.

---

## 2. The corpus database

The corpus lives in its own database on its own Mongoose connection.

```1:29:backend_rag/src/app.module.ts
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.get('MONGO_CORPUS_URI') ?? config.get('MONGO_URI'),
        dbName: config.get('MONGO_CORPUS_DB'),
        serverSelectionTimeoutMS: 5000,
      }),
      connectionName: CORPUS_CONNECTION,
    }),
```

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `MONGO_CORPUS_URI` | falls back to `MONGO_URI` | Connection string for the corpus. |
| `MONGO_CORPUS_DB` | `rag_ts_corpus` | Database name. |

The split is deliberate: the corpus is written in bulk by the ingest jobs and read in large scans, while the application database holds users and chat sessions with a tiny working set. Sharing one database would let a 1 M-document ingest distort the collection statistics that the chat path depends on.

The MinIO settings (`MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET_NAME`, `MINIO_REGION`) are **optional** in the environment. Only the ingest scripts need the object store; the running application reads the corpus from MongoDB and never touches MinIO, so an unset value must not stop the server from booting.

---

## 3. Collection specifications

Every collection uses a **string `_id`** — a natural external key — and carries a `schema_version`.

| Collection | `_id` | Documents | Source |
| :--- | :--- | :--- | :--- |
| `papers` | `paper_id` (`2106.09685`, `s2_…`, `cvf_…`) | ~70 590 | Silver `papers.parquet` |
| `paper_chunks` | `chunk_id` (`2106.09685_sec3_p2`) | 1 042 767 | Silver `chunks.parquet` + Qdrant payload |
| `source_objects` | `${bucket}/${key}` | 136 823 | MinIO Bronze listing |
| `authors` | normalised name | 120 | `gold/mining/graph_coauthorship.json` |
| `categories` | numeric index | 0 | `categories.json` *(not yet available)* |
| `world_nodes` | `node_id` (string) | 0 | `tree.json` + centroids *(not yet available)* |
| `association_rules` | `antecedents->consequents` | 40 | `gold/mining/association_rules.json` |
| `datasets` | `dataset_version` | 0 | stamped by the reconciliation job *(not yet run)* |

The schemas live in [`backend_rag/src/corpus/schemas/`](../src/corpus/schemas/). Two choices are worth restating:

- **`source_objects._id` is `${bucket}/${key}`, not `sha256(bytes)`.** Content addressing would merge two papers that happen to share identical bytes and lose the link back to their own raw file. The hash stays in its own indexed field, where it serves integrity checking rather than identity.

- **`source_objects.etag` is an ETag, not a SHA-256.** The `ListObjectsV2` response carries the ETag, which for a single-part upload is the **MD5** of the raw bytes — 32 hex characters. The field is named `etag` so it says what it is; a real SHA-256 would need one `GetObject` per file (3.8 GB of traffic) and was explicitly out of scope. It is nullable: an object without an ETag (multipart upload) is still recorded, just without an integrity handle.
- **`source_objects` has a one-way `paper_id`, not a `paper_ids[]` back-reference.** The relationship is many-to-one; a back-reference array would make it two-way, and keeping a two-way relationship consistent needs a transaction — which the standalone MongoDB deployment does not have.

### 3.1 Indexes

| Collection | Index | Purpose |
| :--- | :--- | :--- |
| `papers` | `{ doi: 1 }` unique, sparse | DOI uniqueness and lookup. |
| `papers` | `{ primary_category: 1, year: -1 }` | Filter by category, newest first. |
| `papers` | `{ author_ids: 1 }` | The real join key to `authors`. |
| `papers` | `{ source: 1, year: -1 }` | Filter by source family. |
| `papers` | `{ dataset_version: 1 }` | Reconciliation scope. |
| `paper_chunks` | `{ paper_id: 1, chunk_index: 1 }` | Chunks of a paper, in reading order — filter and sort in one index. |
| `paper_chunks` | `{ dataset_version: 1 }` | Reconciliation scope. |
| `source_objects` | `{ paper_id: 1 }` | "The raw files of this paper". |
| `source_objects` | `{ source: 1, source_id: 1 }` | Lookup by original identifier. |
| `source_objects` | `{ etag: 1 }` | Integrity check and duplicate reporting. |
| `authors` | `{ pagerank: -1 }` | Serves the startup load, which reads only the ranked authors. |

---

## 4. The `chunk_index` derivation

`chunk_index` is **derived from `chunk_id`**, never copied from the source. The pipeline encodes the position in the identifier itself:

```
<paper_id>_abs        →  abstract, section 0, part 0
<paper_id>_abs_p2     →  abstract, section 0, part 2
<paper_id>_sec3       →  section 3, part 0
<paper_id>_sec3_p2    →  section 3, part 2
```

The grammar in [`backend_rag/src/corpus/chunk-order.ts`](../src/corpus/chunk-order.ts) parses **100 %** of the identifiers in the probed Silver partitions (462 471 chunks across 2000, 2024 and 2026) — the parser is regex-anchored at the end of the string, so it never matches a suffix in the middle of an identifier.

### 4.1 Why the order is derived rather than inherited

The Parquet row order is **lexicographic**. Sorting the identifiers as strings puts `_sec10` before `_sec1_p1`, and `_sec4_p10` before `_sec4_p2`. Measured over 31 309 papers:

- **91.21 %** of papers happen to already be in lexicographic order — which is precisely the problem, because it means the file order is *not* a reading order.
- Every one of the 2 752 papers that disagree is a genuine inversion, not a tie-break.

The derived order sorts **numerically** on the section and part numbers, with the abstract family first, and `chunk_id` as the final tiebreaker so the order is total and stable. The result is a dense, gap-free index per paper.

### 4.2 The assignment rule

`assignChunkIndexes` walks the paper's chunks in derived order and hands out `0, 1, 2, …`. An identifier that does not match the grammar keeps a `null` index: it stays in the collection, sorted by identifier, but never claims a slot that would shift the index of a later chunk. In the full ingest, **zero** chunks ended up unindexed.

---

## 5. The integrity model

Three levels of SHA-256, all computed by [`backend_rag/src/corpus/checksum.ts`](../src/corpus/checksum.ts) and all deterministic — the same inputs always produce the same digest, regardless of who computes it or in which order the rows were read.

| Level | Field | Rule |
| :--- | :--- | :--- |
| Chunk | `paper_chunks.text_sha256` | `sha256(text)` over the UTF-8 bytes. |
| Paper | `papers.content_sha256` | `sha256(join("\n", ["<chunk_id>:<text_sha256>", …]))` in `chunk_index` order. |
| Dataset | `datasets.content_sha256` | `sha256(join("\n", sorted("<paper_id>:<content_sha256>")) + "\|" + counts)`. |

The paper digest deliberately covers the **order**: reordering a paper's chunks changes the digest, which is what makes it a reading-order check rather than only a content check.

`abstract_hash` is a separate thing and is stored separately: it is a *dedup key* over the abstract text, not an integrity checksum.

---

## 6. The ingest pipeline

All scripts live in [`backend_rag/scripts/ingest/`](../scripts/ingest/). Every one of them is **idempotent** — it upserts by `_id` — so a partial failure can be recovered by simply re-running. They connect to MongoDB directly, never through the Cloudflare tunnel: loading a million documents through a proxied connection is not viable.

| Phase | Script | Source ➔ target | What it does |
| :--- | :--- | :--- | :--- |
| 0b | `apply-validators.ts` | — | Installs the `$jsonSchema` validator (`strict`/`error`) on every corpus collection. **Run it after the ingest**, never before: MongoDB does not re-validate existing documents, but it does reject every later write. |
| 0c | `apply-corpus-indexes.ts` | — | Creates the indexes of §3.1 on the live database. A Mongoose schema is not a migration — `autoIndex` is off in production, so this job is what actually creates them. |
| 1 | `backfill-qdrant-to-mongo.ts` | Qdrant ➔ `paper_chunks`, `papers` | Scrolls every point, verifies the point id is `uuidv5(chunk_id, DNS)`, records the corpus shape. |
| 2 | `enrich-from-silver.ts` | MinIO Silver ➔ `papers`, `paper_chunks` | The **authoritative** text source. Writes `text`, `text_sha256`, the derived `chunk_index`, `section_title`, `section_type`, and the paper-level `content_sha256`. |
| 3 | `migrate-world-mining.ts` | `gold/mining/*.json` ➔ `authors`, `association_rules` | Migrates the PageRank table and the FP-Growth rules. |
| 4 | `ingest-source-objects.ts` | MinIO Bronze ➔ `source_objects` | **Manifest only** — key, size, media type, ETag. The bytes are never downloaded. |
| 5 | `reconcile-qdrant.ts` | MongoDB ↔ Qdrant | Compares the two stores and stamps `datasets.qdrant_drift_count`. |

Three ordering notes:

- Phases 1 and 2 write to the same collections. Phase 2 is the one that carries the text, so it must run after Phase 1 for the `chunk_index` assignment to see the complete chunk set of each paper.
- Phase 4 reads **only the object listing**. The `ListObjectsV2` response already carries the size and the ETag, so the whole manifest pass costs zero `GetObject` requests.
- Phase 0b must run **after** the ingest phases. A validator installed first would reject the very writes that fill the corpus — and MongoDB would not notice that the already-stored documents violate it.

### 6.1 The Bronze manifest decision

Per the agreed scope, Phase 4 records the manifest and nothing else:

| Recorded | Not recorded |
| :--- | :--- |
| `bucket`, `key` | the object body |
| `size` (bytes) | a SHA-256 of the bytes |
| `media_type` (`text/html`, `application/pdf`, `application/json`) | |
| `etag` — the MD5 the object store reports for a single-part upload | |
| `source`, `source_id`, `paper_id` | |

The ETag is the integrity handle available **without** downloading the object, so it is what the manifest records. A true SHA-256 would require a `GetObject` per file — 3.8 GB of traffic — and was explicitly out of scope. The field is therefore named `etag`, not `sha256`: the value it holds is an MD5 for single-part uploads, and naming it after a different algorithm would make every later integrity check quietly wrong.

### 6.2 The point-id check

Qdrant derives its point id as `uuidv5(chunk_id, DNS)`. Phase 1 recomputes that for every point and reports any mismatch. Across all 1 042 767 points the mismatch count was **zero**, which independently confirms that the Silver `chunk_id` values and the Qdrant payload ids refer to the same chunks.

---

## 7. Measured results

Everything below was measured against the live MinIO lakehouse and the live MongoDB instance.

### 7.1 Lakehouse inventory

| Prefix | Objects | Size | Media type |
| :--- | --- | --- | :--- |
| `bronze/arxiv/` | 64 764 | 3.40 GB | `text/html` (`.html.gz`) |
| `bronze/papers/` | 71 927 | 0.15 GB | `application/json` |
| `bronze/semantic_scholar/` | 132 | 0.25 GB | `application/pdf` |
| `bronze/openalex/` | 0 | — | — |
| **Total** | **136 823** | **3.80 GB** | |

Note that `bronze/papers/` holds *arXiv* metadata despite its generic name, and `bronze/semantic_scholar/` holds PDFs — both are classified by the directory, which is the authoritative signal.

### 7.2 Ingest outcome

| Metric | Value |
| :--- | --- |
| Qdrant points scrolled | 1 042 767 |
| Point-id mismatches | **0** |
| Chunks in `paper_chunks` | 1 042 767 |
| Chunks with a derived `chunk_index` | 1 042 767 (100 %) |
| Chunks without text | 0 |
| Bronze manifests written | 136 823 |
| Bronze objects linked to a `paper_id` | 130 705 (95.6 %) |
| Authors migrated | 120 |
| Association rules migrated | 40 |

The 6 118 Bronze objects without a `paper_id` link are the Semantic Scholar PDFs whose identifier does not match the corpus `paper_id` shape, plus the old-style arXiv HTML files whose underscore form (`cs_0510001`) is converted back to the corpus form (`cs/0510001`).

### 7.3 Identifier families

The parser covers every identifier shape present in the corpus:

| Shape | Example | Family |
| :--- | :--- | :--- |
| New arXiv | `2106.09685` | arXiv |
| Old arXiv | `cs/0003055` | arXiv |
| Semantic Scholar | `s2_a96894b44b2ea91d234840ae42af5a883e44b09c` | arXiv |
| CVF | `cvf_Jang_FADES_Fair_Disentanglement_…_CVPR_2024` | CVF |

---

## 8. Runtime read paths

The corpus is **not** on the hot path. `POST /api/v1/rag/chat` still talks to Qdrant and still makes exactly one round trip to it.

| Component | Before | After |
| :--- | :--- | :--- |
| `src/papers/papers.service.ts` | Qdrant scroll by paper | Reads `papers` + `paper_chunks` from MongoDB (two indexed reads, no `$lookup`); falls back to Qdrant while the corpus is still filling. |
| `src/tree-router/tree-router.service.ts` | Reads `tree.json` + centroids from disk | Reads `world_nodes` + `categories` from MongoDB at startup; the JSON files remain the fallback. |
| `src/mining/mining.service.ts` | Reads `graph_coauthorship.json` + `association_rules.json` from disk | Reads `authors` + `association_rules` from MongoDB at startup; the JSON files remain the fallback. |
| `src/vector-store/vector-store.service.ts` | — | **Unchanged.** Still the hot path. |
| `src/rag/rag.service.ts` | — | **Unchanged.** No extra round trip. |
| `src/health/health.service.ts` | `mongo`, `qdrant`, `llm`, `world` | Adds a `corpus` flag: the corpus connection is reachable **and** holds an ingested corpus — a document whose `text` is actually present, not merely a non-zero document count. |

The startup loads keep the same shape as before — one query per collection, then everything lives in memory. The full influencer list is never loaded; only the authors that carry a PageRank are, which is what the `{ pagerank: -1 }` index serves.

---

## 9. Open items

| Item | Status | Notes |
| :--- | :--- | :--- |
| World tree (`tree.json`, `centroids_l1.json`, `centroids_l2.json`, `categories.json`) | **Blocked** | Not present in MinIO and not present on disk — `WORLD_DATA_DIR` (`../data/world`) does not exist. The health endpoint has reported `world: false` since before this work. Phase 3 migrates them as soon as the files are available; the code path is in place and the mining halves of Phase 3 have already run. |
| `gold/lancedb/` | **Absent** | The bucket has no `lancedb` prefix. The `clusters.json` artefact was not migrated because the schema has no collection for it. |
| `bronze/openalex/` | **Empty** | Zero objects. The OpenAlex family exists in the schema but has no data yet. |
| `paper_chunks.twig_id` | **Null** | The twig assignment is part of the world-tree join and cannot be computed until the tree is available. |
| `datasets` population | **Not done** | The reconciliation job stamps it; it has not been run over the full corpus yet, so the collection does not exist. |
| `categories` / `world_nodes` collections | **Not created** | Both are created by Phase 3, which is blocked on the world files. Until then the runtime reads them from disk — or, for `categories`, from the `TreeRouterService` fallback. |
| `source_objects.sha256` ➔ `etag` | **Renamed** | The value was always an ETag (an MD5 for single-part uploads), never a SHA-256. The field is now named `etag`, and the index follows it. |
| Corpus indexes and validators | **Applied** | `apply-corpus-indexes.ts` and `apply-validators.ts` install them on the live database. The validators must run *after* the ingest — MongoDB validates only later writes. |

---

## 10. Self-review checklist

- [x] Every corpus collection uses a string `_id` — a natural external key.
- [x] Every collection carries a `schema_version`.
- [x] No `$lookup` on the runtime read path — `PaperDetail` is built from two indexed reads.
- [x] The `source_objects` ↔ `papers` relationship is one-way, consistent with a standalone MongoDB deployment.
- [x] No raw Bronze bytes are copied into MongoDB or GridFS — only the manifest.
- [x] The Bronze integrity handle is named for what it is — `etag`, an MD5 for single-part uploads, not a SHA-256.
- [x] No 768-dimensional vector is written to MongoDB — Qdrant keeps the only copy, rebuildable from `paper_chunks.text`.
- [x] The `chunk_index` derivation is covered by unit tests, and the grammar was measured against the live corpus at 100 % coverage.
- [x] The checksum helpers are covered by unit tests.
- [x] The RAG hot path gains no round trip.
- [x] Every file path mentioned above is a working relative link.
