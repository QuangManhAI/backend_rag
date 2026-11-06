import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AppConfigService } from '../config/app-config.service';
import { EMBEDDING_DIM } from '../embedding/embedding.service';
import { round4 } from '../mining/mining.service';
import type { RouteCandidate, RouteStep } from '../types/scientific-rag';

export const NPROBE_MIN = 1;
export const NPROBE_MAX = 6;

/** Node of `tree.json` (same file the frontend World 3D draws). */
export interface TreeNode {
  id: number;
  parent_id: number | null;
  depth: 0 | 1 | 2;
  label: string;
}

export interface Category {
  index: number;
  code: string;
  name: string;
}

/** Row-major, L2-normalised centroids: row i belongs to `ids[i]`. */
export interface CentroidMatrix {
  ids: number[];
  data: Float32Array;
}

export interface WorldIndex {
  version: string | null;
  l1: CentroidMatrix;
  l2: CentroidMatrix;
  /** depth-1 node id ➔ ids of its depth-2 children that have a centroid. */
  children: Map<number, number[]>;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null;

export function clampNprobe(n: number): number {
  if (!Number.isFinite(n)) return 2;
  return Math.min(NPROBE_MAX, Math.max(NPROBE_MIN, Math.round(n)));
}

/** `{ items: [{ node_id, vector }] }` (or a bare array) ➔ normalised contiguous matrix. */
export function parseCentroids(
  raw: unknown,
  dim = EMBEDDING_DIM,
): CentroidMatrix {
  const items = isObj(raw) && Array.isArray(raw.items) ? raw.items : raw;
  if (!Array.isArray(items))
    throw new Error('centroids: expected { items: [...] }');
  const ids: number[] = [];
  const data = new Float32Array(items.length * dim);
  items.forEach((it, row) => {
    if (
      !isObj(it) ||
      typeof it.node_id !== 'number' ||
      !Array.isArray(it.vector)
    ) {
      throw new Error(`centroids: item ${row} must be { node_id, vector }`);
    }
    if (it.vector.length !== dim) {
      throw new Error(
        `centroids: node ${it.node_id} has ${it.vector.length} dims, expected ${dim}`,
      );
    }
    let norm = 0;
    for (const x of it.vector as number[]) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    (it.vector as number[]).forEach((x, j) => (data[row * dim + j] = x / norm));
    ids.push(it.node_id);
  });
  return { ids, data };
}

export function parseTree(raw: unknown): {
  version: string | null;
  nodes: TreeNode[];
} {
  const nodes = isObj(raw) && Array.isArray(raw.nodes) ? raw.nodes : raw;
  if (!Array.isArray(nodes)) throw new Error('tree: expected { nodes: [...] }');
  const version =
    isObj(raw) && typeof raw.world_version === 'string'
      ? raw.world_version
      : null;
  return {
    version,
    nodes: nodes.filter(
      (n): n is TreeNode =>
        isObj(n) &&
        typeof n.id === 'number' &&
        (n.depth === 0 || n.depth === 1 || n.depth === 2),
    ),
  };
}

export function buildIndex(
  tree: { version: string | null; nodes: TreeNode[] },
  l1: CentroidMatrix,
  l2: CentroidMatrix,
): WorldIndex {
  const withCentroid = new Set(l2.ids);
  const children = new Map<number, number[]>();
  for (const n of tree.nodes) {
    if (n.depth !== 2 || n.parent_id === null || !withCentroid.has(n.id))
      continue;
    const list = children.get(n.parent_id) ?? [];
    list.push(n.id);
    children.set(n.parent_id, list);
  }
  return { version: tree.version, l1, l2, children };
}

function scoreRows(
  q: Float32Array,
  m: CentroidMatrix,
  rows: number[],
): RouteCandidate[] {
  const dim = q.length;
  return rows.map((row) => {
    let dot = 0;
    const off = row * dim;
    for (let j = 0; j < dim; j++) dot += q[j] * m.data[off + j];
    return { node_id: m.ids[row], score: round4(dot) };
  });
}

const topIds = (c: RouteCandidate[], n: number): number[] =>
  [...c]
    .sort((a, b) => b.score - a.score || a.node_id - b.node_id)
    .slice(0, n)
    .map((x) => x.node_id);

/**
 * Two-level routing: cosine with every branch centroid, keep the `nprobe` best; then cosine with
 * the twigs under those branches, keep the `nprobe` best. Depth-1 candidates list EVERY branch.
 */
export function route(
  query: number[],
  index: WorldIndex,
  nprobe: number,
): RouteStep[] {
  const n = clampNprobe(nprobe);
  const q = Float32Array.from(query);
  let norm = 0;
  for (const x of q) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < q.length; i++) q[i] /= norm;

  const c1 = scoreRows(
    q,
    index.l1,
    index.l1.ids.map((_, i) => i),
  );
  const chosen1 = topIds(c1, n);
  const rowOf = new Map(index.l2.ids.map((id, i) => [id, i]));
  const twigRows = chosen1
    .flatMap((b) => index.children.get(b) ?? [])
    .map((id) => rowOf.get(id))
    .filter((r): r is number => r !== undefined);
  const c2 = scoreRows(q, index.l2, twigRows);
  return [
    { depth: 1, candidates: c1, chosen: chosen1 },
    { depth: 2, candidates: c2, chosen: topIds(c2, n) },
  ];
}

/** Routes a query vector through the World 3D tree exported by the pipeline (WORLD_DATA_DIR). */
@Injectable()
export class TreeRouterService implements OnModuleInit {
  private readonly logger = new Logger(TreeRouterService.name);
  private index: WorldIndex | null = null;
  private categories: Category[] = [];

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const dir = this.config.get('WORLD_DATA_DIR');
    const read = async (f: string): Promise<unknown> =>
      JSON.parse(await readFile(join(dir, f), 'utf8')) as unknown;
    try {
      this.categories = parseCategories(await read('categories.json'));
    } catch (e) {
      this.logger.warn({ dir, err: e }, 'WORLD_CATEGORIES_MISSING');
    }
    try {
      const [tree, l1, l2] = await Promise.all([
        read('tree.json'),
        read('centroids_l1.json'),
        read('centroids_l2.json'),
      ]);
      this.load(parseTree(tree), parseCentroids(l1), parseCentroids(l2));
    } catch (e) {
      this.logger.warn(
        { dir, err: e },
        'WORLD_FILES_MISSING: route events will have no steps',
      );
    }
  }

  load(
    tree: { version: string | null; nodes: TreeNode[] },
    l1: CentroidMatrix,
    l2: CentroidMatrix,
  ): void {
    this.index = buildIndex(tree, l1, l2);
    this.logger.log(
      {
        world_version: tree.version,
        branches: l1.ids.length,
        twigs: l2.ids.length,
      },
      'WORLD_LOADED',
    );
  }

  setCategories(categories: Category[]): void {
    this.categories = categories;
  }

  isLoaded(): boolean {
    return this.index !== null;
  }

  worldVersion(): string | null {
    return this.index?.version ?? null;
  }

  route(
    vector: number[],
    nprobe: number,
  ): { steps: RouteStep[]; route_ms: number } {
    const t0 = performance.now();
    const steps = this.index ? route(vector, this.index, nprobe) : [];
    return { steps, route_ms: Math.round(performance.now() - t0) };
  }

  /** Index of a category code in categories.json; unknown ➔ the "other" bucket. */
  categoryIndex(code: string): number {
    const hit = this.categories.find((c) => c.code === code);
    if (hit) return hit.index;
    return (
      this.categories.find((c) => c.code === 'other')?.index ??
      OTHER_CATEGORY_INDEX
    );
  }
}

/** Used when categories.json is missing or has no "other" entry. */
export const OTHER_CATEGORY_INDEX = -1;

export function parseCategories(raw: unknown): Category[] {
  const list =
    isObj(raw) && Array.isArray(raw.categories) ? raw.categories : raw;
  if (!Array.isArray(list)) throw new Error('categories: expected an array');
  return list.filter(
    (c): c is Category =>
      isObj(c) && typeof c.index === 'number' && typeof c.code === 'string',
  );
}
