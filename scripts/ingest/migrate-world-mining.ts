/**
 * Phase 3 — migrate the world tree and the mining artefacts into MongoDB.
 *
 * Sources (in MinIO, `gold/mining/`):
 *   `graph_coauthorship.json`  ➔ `authors`
 *   `association_rules.json`   ➔ `association_rules`
 *
 * Sources (local JSON exported by the pipeline):
 *   `WORLD_DATA_DIR/tree.json`, `centroids_l1.json`, `centroids_l2.json`,
 *   `categories.json`           ➔ `world_nodes`, `categories`
 *
 * The world tree and the mining artefacts are loaded into memory once at
 * startup by `TreeRouterService` and `MiningService`; this job only changes
 * where that data comes from.
 *
 * Usage:
 *   ts-node scripts/ingest/migrate-world-mining.ts [--dry-run]
 */
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  corpusCollection,
  corpusDb,
  getBytes,
  log,
  s3Client,
} from './lib/ingest-lib';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null;

interface TreeNodeJson {
  id: number;
  parent_id: number | null;
  depth: 0 | 1 | 2;
  label: string;
}

/**
 * Normalises an author name the same way the runtime does.
 *
 * Mirrors `backend_rag/src/mining/name-normalizer.ts` so the `_id` written
 * here is exactly the key `MiningService` will look up.
 */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bet\s+al\b\.?/g, ' ')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Packs a vector into little-endian float32 bytes and hashes them. */
function packVector(vector: number[]): {
  bytes: Buffer;
  sha256: string;
} {
  const bytes = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i += 1) {
    bytes.writeFloatLE(vector[i], i * 4);
  }
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Reads `{ items: [{ node_id, vector }] }` into a node-id ➔ vector map. */
function centroidMap(raw: unknown): Map<number, number[]> {
  const items = isObj(raw) && Array.isArray(raw.items) ? raw.items : raw;
  const out = new Map<number, number[]>();
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    if (
      isObj(it) &&
      typeof it.node_id === 'number' &&
      Array.isArray(it.vector)
    ) {
      out.set(it.node_id, it.vector as number[]);
    }
  }
  return out;
}

/**
 * Reads the world tree and the category list from `WORLD_DATA_DIR`.
 *
 * These files are produced by the pipeline on the machine that ran it; they
 * are not mirrored into MinIO, so the migration reads them from disk.
 */
async function readWorldFiles(worldDir: string): Promise<{
  tree: TreeNodeJson[];
  version: string | null;
  l1: Map<number, number[]>;
  l2: Map<number, number[]>;
  categories: Array<{ index: number; code: string; name: string }>;
}> {
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(join(worldDir, file), 'utf8')) as unknown;

  const treeRaw = await read('tree.json');
  const treeNodes = Array.isArray(treeRaw)
    ? treeRaw
    : isObj(treeRaw) && Array.isArray(treeRaw.nodes)
      ? treeRaw.nodes
      : [];
  const version =
    isObj(treeRaw) && typeof treeRaw.world_version === 'string'
      ? treeRaw.world_version
      : null;

  const tree = treeNodes.filter(
    (n): n is TreeNodeJson =>
      isObj(n) &&
      typeof n.id === 'number' &&
      (n.depth === 0 || n.depth === 1 || n.depth === 2),
  );

  const l1 = centroidMap(await read('centroids_l1.json'));
  const l2 = centroidMap(await read('centroids_l2.json'));

  let categories: Array<{ index: number; code: string; name: string }> = [];
  try {
    const catRaw = await read('categories.json');
    const list = Array.isArray(catRaw)
      ? catRaw
      : isObj(catRaw) && Array.isArray(catRaw.categories)
        ? catRaw.categories
        : [];
    categories = list
      .filter(isObj)
      .map((c) => ({
        index: Number(c.index ?? c.id ?? 0),
        code: typeof c.code === 'string' ? c.code : '',
        name: typeof c.name === 'string' ? c.name : '',
      }))
      .filter((c) => c.code !== '');
  } catch {
    log('WORLD_CATEGORIES_MISSING', { worldDir });
  }

  return { tree, version, l1, l2, categories };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const target = s3Client();
  const { client, db } = await corpusDb();

  const worldNodes = corpusCollection(db, 'world_nodes');
  const categories = corpusCollection(db, 'categories');
  const authors = corpusCollection(db, 'authors');
  const rules = corpusCollection(db, 'association_rules');

  // ---- world tree ------------------------------------------------------
  const worldDir = process.env.WORLD_DATA_DIR ?? '../data/world';
  let world: Awaited<ReturnType<typeof readWorldFiles>> | null = null;
  try {
    world = await readWorldFiles(worldDir);
  } catch (e) {
    log('WORLD_FILES_MISSING', { worldDir, err: String(e) });
  }

  if (world) {
    const ops = [];
    for (const node of world.tree) {
      const vector = world.l1.get(node.id) ?? world.l2.get(node.id);
      const packed = vector ? packVector(vector) : null;
      ops.push({
        updateOne: {
          filter: { _id: String(node.id) },
          update: {
            $set: {
              parent_id:
                node.parent_id === null ? null : String(node.parent_id),
              depth: node.depth,
              label: node.label,
              vector: packed ? packed.bytes : null,
              vector_sha256: packed ? packed.sha256 : null,
              schema_version: 1,
            },
          },
          upsert: true,
        },
      });
    }
    if (!dryRun && ops.length > 0) {
      await worldNodes.bulkWrite(ops, { ordered: false });
    }
    log('WORLD_DONE', {
      nodes: world.tree.length,
      version: world.version,
      with_centroid: world.tree.filter(
        (n) => world.l1.has(n.id) || world.l2.has(n.id),
      ).length,
    });

    const catOps = world.categories.map((c) => ({
      updateOne: {
        filter: { _id: String(c.index) },
        update: {
          $set: { code: c.code, name: c.name, schema_version: 1 },
        },
        upsert: true,
      },
    }));
    if (!dryRun && catOps.length > 0) {
      await categories.bulkWrite(catOps, { ordered: false });
    }
    log('CATEGORIES_DONE', { categories: catOps.length });
  }

  // ---- mining: authority table -----------------------------------------
  const graphRaw = JSON.parse(
    (await getBytes(target, 'gold/mining/graph_coauthorship.json')).toString(
      'utf8',
    ),
  ) as unknown;

  const authority = new Map<
    string,
    {
      display: string;
      pagerank: number;
      degree: number | null;
      paperCount: number;
    }
  >();
  const lists: unknown[] = [];
  if (isObj(graphRaw)) {
    lists.push(graphRaw.top_influencers, graphRaw.influencers);
    if (isObj(graphRaw.graph_export)) {
      lists.push(graphRaw.graph_export.nodes);
    }
  }
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isObj(item)) continue;
      const name = item.author ?? item.label ?? item.name ?? item.id;
      const pr = Number(item.pagerank ?? item.score);
      if (typeof name !== 'string' || !(pr > 0)) continue;
      const key = normalizeName(name);
      if (!key) continue;
      const current = authority.get(key);
      if (!current || pr > current.pagerank) {
        authority.set(key, {
          display: name,
          pagerank: pr,
          degree: typeof item.degree === 'number' ? item.degree : null,
          paperCount:
            typeof item.paper_count === 'number' ? item.paper_count : 0,
        });
      }
    }
  }

  const authorOps = [...authority.entries()].map(([id, a]) => ({
    updateOne: {
      filter: { _id: id },
      update: {
        $set: {
          display_name: a.display,
          pagerank: a.pagerank,
          degree: a.degree,
          paper_count: a.paperCount,
          schema_version: 1,
        },
      },
      upsert: true,
    },
  }));
  if (!dryRun && authorOps.length > 0) {
    await authors.bulkWrite(authorOps, { ordered: false });
  }
  log('AUTHORS_DONE', { authors: authorOps.length });

  // ---- mining: association rules ---------------------------------------
  const rulesRaw = JSON.parse(
    (await getBytes(target, 'gold/mining/association_rules.json')).toString(
      'utf8',
    ),
  ) as unknown;

  const ruleList = isObj(rulesRaw)
    ? (rulesRaw.rules ?? rulesRaw.association_rules)
    : rulesRaw;
  const parsedRules: Array<Record<string, unknown> & { _id: string }> = [];
  if (Array.isArray(ruleList)) {
    for (const r of ruleList) {
      if (
        !isObj(r) ||
        !Array.isArray(r.antecedents) ||
        !Array.isArray(r.consequents)
      ) {
        continue;
      }
      const antecedents = r.antecedents.map((a) => String(a));
      const consequents = r.consequents.map((c) => String(c));
      if (!antecedents.length || !consequents.length) continue;
      const confidence = Number(r.confidence ?? 0);
      const lift = Number(r.lift ?? 1);
      const prefix = antecedents[0].includes(':')
        ? antecedents[0].split(':')[0]
        : null;
      parsedRules.push({
        _id: `${antecedents.join('|')}->${consequents.join('|')}`,
        antecedents,
        consequents,
        support: Number(r.support ?? 0),
        confidence,
        lift,
        score: confidence * lift,
        item_prefix: prefix,
      });
    }
  }
  const ruleOps = parsedRules.map((r) => {
    // `_id` is immutable, so it is only used as the filter — never in the
    // `$set` payload.
    const { _id: ruleId, ...rest } = r;
    return {
      updateOne: {
        filter: { _id: ruleId },
        update: {
          $set: { ...rest, schema_version: 1 },
        },
        upsert: true,
      },
    };
  });
  if (!dryRun && ruleOps.length > 0) {
    await rules.bulkWrite(ruleOps, { ordered: false });
  }
  log('RULES_DONE', { rules: ruleOps.length });

  await client.close();
}

main().catch((e) => {
  log('WORLD_MINING_FAILED', { err: String(e), stack: (e as Error).stack });
  process.exit(1);
});
