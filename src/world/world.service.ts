import { Injectable, OnModuleInit, Logger } from '@nestjs/common';

export type Vec3 = readonly [number, number, number];

export interface Category {
  index: number;
  code: string;
  name: string;
  paper_count: number;
}

export interface Crate {
  id: number;
  category_index: number;
  cell: readonly [number, number];
  paper_count: number;
}

export interface Root {
  crate_id: number;
  path: Vec3[];
}

export interface GroundLayout {
  tile_size: number;
  grid_size: readonly [number, number];
  crates: Crate[];
  roots: Root[];
}

export interface TreeNode {
  id: number;
  parent_id: number | null;
  depth: 0 | 1 | 2;
  label: string;
  leaf_count: number;
  dominant_category: number;
  position: Vec3;
  path: Vec3[];
  radius: number;
}

export interface VectorTable {
  count: number;
  positions: Float32Array;
  twigIds: Uint32Array;
  crateIds: Uint32Array;
  categories: Uint16Array;
  years: Uint16Array;
  authority: Float32Array;
  flags: Uint8Array;
}

export interface Chunk {
  chunk_id: string;
  section_title: string;
  section_type: string;
  text: string;
}

export interface PaperDetail {
  paper_id: string;
  title: string;
  authors: string[];
  category_index: number;
  year: number;
  abstract: string;
  has_fulltext: boolean;
  chunks: Chunk[];
}

const VECTOR_MAGIC = 'VTRE';
const VECTOR_VERSION = 2;
const VECTOR_STRIDE = 32;
const VECTOR_HEADER = 16;

function encodeVectors(table: VectorTable): ArrayBuffer {
  const buffer = new ArrayBuffer(VECTOR_HEADER + table.count * VECTOR_STRIDE);
  const dv = new DataView(buffer);
  for (let i = 0; i < 4; i++) dv.setUint8(i, VECTOR_MAGIC.charCodeAt(i));
  dv.setUint32(4, VECTOR_VERSION, true);
  dv.setUint32(8, table.count, true);
  dv.setUint32(12, VECTOR_STRIDE, true);
  for (let i = 0; i < table.count; i++) {
    const o = VECTOR_HEADER + i * VECTOR_STRIDE;
    dv.setFloat32(o, table.positions[i * 3], true);
    dv.setFloat32(o + 4, table.positions[i * 3 + 1], true);
    dv.setFloat32(o + 8, table.positions[i * 3 + 2], true);
    dv.setUint32(o + 12, table.twigIds[i], true);
    dv.setUint32(o + 16, table.crateIds[i], true);
    dv.setUint16(o + 20, table.categories[i], true);
    dv.setUint16(o + 22, table.years[i], true);
    dv.setFloat32(o + 24, table.authority[i], true);
    dv.setUint8(o + 28, table.flags[i]);
  }
  return buffer;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rng: () => number, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function gauss(rng: () => number): number {
  return (rng() + rng() + rng() - 1.5) * 2;
}

function cellToWorld(cell: readonly [number, number], gridSize: readonly [number, number], tileSize: number): Vec3 {
  const [col, row] = cell;
  const [cols, rows] = gridSize;
  return [(col - (cols - 1) / 2) * tileSize, 0, (row - (rows - 1) / 2) * tileSize];
}

const CATEGORY_DEFS = [
  { code: 'cs.LG', name: 'Machine Learning', weight: 0.19, words: ['representation', 'optimization', 'generalization', 'gradient', 'federated', 'contrastive', 'diffusion', 'meta-learning'] },
  { code: 'cs.CL', name: 'Computation and Language', weight: 0.16, words: ['transformer', 'attention', 'llm', 'lora', 'instruction', 'tokenization', 'translation', 'alignment'] },
  { code: 'cs.CV', name: 'Computer Vision', weight: 0.14, words: ['segmentation', 'detection', 'vit', 'nerf', 'depth', 'tracking', 'diffusion', 'point cloud'] },
  { code: 'cs.AI', name: 'Artificial Intelligence', weight: 0.11, words: ['planning', 'agents', 'reasoning', 'knowledge graph', 'search', 'logic', 'multi-agent'] },
  { code: 'stat.ML', name: 'Statistical ML', weight: 0.09, words: ['bayesian', 'kernel', 'variational', 'causal', 'uncertainty', 'sampling', 'gaussian process'] },
  { code: 'cs.IR', name: 'Information Retrieval', weight: 0.08, words: ['ranking', 'dense retrieval', 'recommendation', 'rag', 'reranking', 'query expansion', 'bm25'] },
  { code: 'cs.RO', name: 'Robotics', weight: 0.07, words: ['manipulation', 'locomotion', 'slam', 'control', 'sim2real', 'grasping'] },
  { code: 'math.OC', name: 'Optimization and Control', weight: 0.06, words: ['convex', 'stochastic', 'minimax', 'adam', 'convergence', 'lagrangian'] },
  { code: 'q-bio.QM', name: 'Quantitative Methods', weight: 0.05, words: ['protein', 'genomics', 'single-cell', 'molecular', 'drug discovery'] },
  { code: 'physics.comp-ph', name: 'Computational Physics', weight: 0.05, words: ['pde', 'molecular dynamics', 'surrogate', 'turbulence', 'monte carlo'] },
] as const;

const TRUNK_TOP: Vec3 = [0, 35, 0];

function bezier(a: Vec3, c: Vec3, b: Vec3, n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]]);
  }
  return out;
}

function threeWords(rng: () => number, words: readonly string[]): string {
  const pool = [...words];
  const out: string[] = [];
  while (out.length < 3 && pool.length > 0) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out.join(' · ');
}

@Injectable()
export class WorldService implements OnModuleInit {
  private readonly logger = new Logger(WorldService.name);
  private categories: Category[] = [];
  private ground: GroundLayout | null = null;
  private tree: TreeNode[] = [];
  private vectorsBuffer: ArrayBuffer | null = null;
  private vectorIds: string[] = [];
  private paperDetailCache = new Map<string, PaperDetail>();

  onModuleInit(): void {
    this.initWorld();
  }

  private initWorld(): void {
    this.logger.log('Generating 3D Knowledge Tree world model...');
    const seed = 7;
    const rng = mulberry32(seed);
    const vectorCount = 30000;
    const branchCount = 14;
    const twigsPerBranch = 14;
    const gridN = 24;
    const tileSize = 3;
    const weights = CATEGORY_DEFS.map((c) => c.weight);

    // Tree nodes
    const tree: TreeNode[] = [
      { id: 0, parent_id: null, depth: 0, label: 'root', leaf_count: vectorCount, dominant_category: 0, position: TRUNK_TOP, path: [[0, 0, 0], [0, 17.5, 0], TRUNK_TOP], radius: 2.1 },
    ];
    let nextId = 1;
    const branches: TreeNode[] = [];
    for (let b = 0; b < branchCount; b++) {
      const angle = (b / branchCount) * Math.PI * 2 + (rng() - 0.5) * 0.25;
      const y = 55 + rng() * 25;
      const reach = 26 + rng() * 14;
      const dir: Vec3 = [Math.cos(angle), 0, Math.sin(angle)];
      const pos: Vec3 = [dir[0] * reach, y, dir[2] * reach];
      const ctrl: Vec3 = [dir[0] * reach * 0.12, y - 4, dir[2] * reach * 0.12];
      const dominant = pickWeighted(rng, weights);
      const node: TreeNode = {
        id: nextId++,
        parent_id: 0,
        depth: 1,
        label: threeWords(rng, CATEGORY_DEFS[dominant].words),
        leaf_count: 0,
        dominant_category: dominant,
        position: pos,
        path: bezier(TRUNK_TOP, ctrl, pos, 10),
        radius: 0.95 + rng() * 0.35,
      };
      branches.push(node);
      tree.push(node);
    }

    const twigs: TreeNode[] = [];
    for (const br of branches) {
      const baseAngle = Math.atan2(br.position[2], br.position[0]);
      for (let k = 0; k < twigsPerBranch; k++) {
        const a = baseAngle + (rng() - 0.5) * 1.5;
        const reach = 9 + rng() * 15;
        const y = Math.min(105, Math.max(75, br.position[1] + 8 + rng() * 26));
        const pos: Vec3 = [br.position[0] + Math.cos(a) * reach, y, br.position[2] + Math.sin(a) * reach];
        const ctrl: Vec3 = [br.position[0] + Math.cos(a) * reach * 0.25, br.position[1] + (y - br.position[1]) * 0.85, br.position[2] + Math.sin(a) * reach * 0.25];
        const dominant = rng() < 0.6 ? br.dominant_category : pickWeighted(rng, weights);
        const node: TreeNode = {
          id: nextId++,
          parent_id: br.id,
          depth: 2,
          label: threeWords(rng, CATEGORY_DEFS[dominant].words),
          leaf_count: 0,
          dominant_category: dominant,
          position: pos,
          path: bezier(br.position, ctrl, pos, 8),
          radius: 0.32 + rng() * 0.14,
        };
        twigs.push(node);
        tree.push(node);
      }
    }

    // Vectors
    const twigWeights = twigs.map(() => 0.4 + rng() * 1.2);
    const wSum = twigWeights.reduce((a, b) => a + b, 0);
    const perTwig = twigWeights.map((w) => Math.floor((w / wSum) * vectorCount));
    let assigned = perTwig.reduce((a, b) => a + b, 0);
    for (let i = 0; assigned < vectorCount; i = (i + 1) % perTwig.length, assigned++) perTwig[i]++;

    const table: VectorTable = {
      count: vectorCount,
      positions: new Float32Array(vectorCount * 3),
      twigIds: new Uint32Array(vectorCount),
      crateIds: new Uint32Array(vectorCount),
      categories: new Uint16Array(vectorCount),
      years: new Uint16Array(vectorCount),
      authority: new Float32Array(vectorCount),
      flags: new Uint8Array(vectorCount),
    };
    let vi = 0;
    twigs.forEach((tw, ti) => {
      const n = perTwig[ti];
      tw.leaf_count = n;
      const R = 2.6 + Math.cbrt(n) * 0.75;
      for (let k = 0; k < n; k++, vi++) {
        const x = tw.position[0] + gauss(rng) * R * 0.5;
        const y = Math.min(112, Math.max(40, tw.position[1] + gauss(rng) * R * 0.32 + 1.5));
        const z = tw.position[2] + gauss(rng) * R * 0.5;
        table.positions[vi * 3] = x;
        table.positions[vi * 3 + 1] = y;
        table.positions[vi * 3 + 2] = z;
        table.twigIds[vi] = tw.id;
        table.categories[vi] = rng() < 0.7 ? tw.dominant_category : pickWeighted(rng, weights);
        table.years[vi] = 2026 - Math.floor(Math.pow(rng(), 1.8) * 20);
        table.authority[vi] = Math.pow(rng(), 3.5);
        table.flags[vi] = rng() < 0.15 ? 1 : 0;
      }
    });

    for (const br of branches) br.leaf_count = twigs.filter((t) => t.parent_id === br.id).reduce((a, t) => a + t.leaf_count, 0);

    // Ground layout
    const perCategory = CATEGORY_DEFS.map(() => 0);
    for (let i = 0; i < vectorCount; i++) perCategory[table.categories[i]]++;
    const cells = gridN * gridN;
    const papersPerCrate = Math.max(190, Math.ceil(vectorCount / (cells * 0.45)));
    const occupied = new Int32Array(cells).fill(-1);
    const crates: Crate[] = [];
    const cratesByCategory: number[][] = CATEGORY_DEFS.map(() => []);
    const order = perCategory.map((n, i) => ({ n, i })).sort((a, b) => b.n - a.n);
    const center = (gridN - 1) / 2;

    order.forEach(({ n, i: cat }, rank) => {
      const want = Math.max(1, Math.round(n / papersPerCrate));
      const angle = rank * 2.39996 + seed;
      const rad = rank === 0 ? 0 : 2.5 + Math.sqrt(rank) * 3.6;
      const tx = center + Math.cos(angle) * rad;
      const ty = center + Math.sin(angle) * rad;
      let seedCell = -1;
      let best = Infinity;
      for (let c = 0; c < cells; c++) {
        if (occupied[c] !== -1) continue;
        const d = (c % gridN - tx) ** 2 + (Math.floor(c / gridN) - ty) ** 2;
        if (d < best) {
          best = d;
          seedCell = c;
        }
      }
      if (seedCell < 0) return;
      const sx = seedCell % gridN;
      const sy = Math.floor(seedCell / gridN);
      const frontier = [seedCell];
      const inFrontier = new Set(frontier);
      let taken = 0;
      while (taken < want && frontier.length > 0) {
        let bi = 0;
        let bd = Infinity;
        frontier.forEach((c, idx) => {
          const d = (c % gridN - sx) ** 2 + (Math.floor(c / gridN) - sy) ** 2 + rng() * 0.8;
          if (d < bd) {
            bd = d;
            bi = idx;
          }
        });
        const c = frontier.splice(bi, 1)[0];
        if (occupied[c] !== -1) continue;
        occupied[c] = cat;
        const col = c % gridN;
        const row = Math.floor(c / gridN);
        const crate: Crate = { id: crates.length, category_index: cat, cell: [col, row], paper_count: 0 };
        crates.push(crate);
        cratesByCategory[cat].push(crate.id);
        taken++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = col + dx;
          const ny = row + dy;
          if (nx < 0 || ny < 0 || nx >= gridN || ny >= gridN) continue;
          const nc = ny * gridN + nx;
          if (occupied[nc] === -1 && !inFrontier.has(nc)) {
            frontier.push(nc);
            inFrontier.add(nc);
          }
        }
      }
    });

    for (let i = 0; i < vectorCount; i++) {
      const list = cratesByCategory[table.categories[i]];
      const k = rng() < 0.6 ? (table.twigIds[i] * 7) % list.length : Math.floor(rng() * list.length);
      table.crateIds[i] = list[k];
      crates[list[k]].paper_count++;
    }

    const grid: readonly [number, number] = [gridN, gridN];
    const roots: Root[] = crates.map((cr) => {
      const siblings = cratesByCategory[cr.category_index].map((id) => cellToWorld(crates[id].cell, grid, tileSize));
      const hx = (siblings.reduce((a, p) => a + p[0], 0) / siblings.length) * 0.5;
      const hz = (siblings.reduce((a, p) => a + p[2], 0) / siblings.length) * 0.5;
      const w = cellToWorld(cr.cell, grid, tileSize);
      const mid: Vec3 = [w[0] + (hx - w[0]) * 0.45, -4.2 - rng() * 1.2, w[2] + (hz - w[2]) * 0.45];
      return {
        crate_id: cr.id,
        path: [[w[0], -2, w[2]], mid, [hx, -5.2, hz], [hx * 0.32, -3.2, hz * 0.32], [0, 0, 0]],
      };
    });

    const categories: Category[] = CATEGORY_DEFS.map((c, index) => ({ index, code: c.code, name: c.name, paper_count: perCategory[index] }));

    const seq = new Map<string, number>();
    const vectorIds: string[] = [];
    for (let i = 0; i < vectorCount; i++) {
      const yymm = `${String(table.years[i] % 100).padStart(2, '0')}${String(1 + Math.floor(rng() * 12)).padStart(2, '0')}`;
      const n = (seq.get(yymm) ?? Math.floor(rng() * 900)) + 1 + Math.floor(rng() * 3);
      seq.set(yymm, n);
      vectorIds.push(`${yymm}.${String(n).padStart(5, '0')}`);
    }

    this.categories = categories;
    this.ground = { tile_size: tileSize, grid_size: grid, crates, roots };
    this.tree = tree;
    this.vectorsBuffer = encodeVectors(table);
    this.vectorIds = vectorIds;
    this.logger.log(`3D World model generated: ${categories.length} categories, ${crates.length} crates, ${tree.length} tree nodes, ${vectorCount} vectors.`);
  }

  getCategories(): Category[] {
    return this.categories;
  }

  getGround(): GroundLayout {
    return this.ground || { tile_size: 3, grid_size: [24, 24], crates: [], roots: [] };
  }

  getTree(): TreeNode[] {
    return this.tree;
  }

  getVectorsBuffer(): ArrayBuffer {
    return this.vectorsBuffer || new ArrayBuffer(0);
  }

  getVectorIds(): string[] {
    return this.vectorIds;
  }

  getPaperDetail(paperId: string): PaperDetail {
    const hit = this.paperDetailCache.get(paperId);
    if (hit) return hit;

    const parts = paperId.split('.');
    const year = parts[0] ? 2000 + Number(parts[0].slice(0, 2)) : 2024;
    const catIdx = Math.abs(paperId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % CATEGORY_DEFS.length;
    const cat = CATEGORY_DEFS[catIdx];

    const detail: PaperDetail = {
      paper_id: paperId,
      title: `Advances in ${cat.name}: Structured Representations and Scalable Optimization (arXiv:${paperId})`,
      authors: ['Vaswani, A.', 'Devlin, J.', 'He, K.', 'Bengio, Y.'],
      category_index: catIdx,
      year: isNaN(year) ? 2024 : year,
      abstract: `We investigate scalable methods in ${cat.name}, establishing theoretical bounds for parametric representations and empirically verifying convergence properties over multi-tier corpora.`,
      has_fulltext: true,
      chunks: [
        {
          chunk_id: `${paperId}_abstract`,
          section_title: 'Abstract',
          section_type: 'abstract',
          text: `We investigate scalable methods in ${cat.name}, establishing theoretical bounds for parametric representations and empirically verifying convergence properties over multi-tier corpora.`,
        },
        {
          chunk_id: `${paperId}_method`,
          section_title: 'Methodology & Architecture',
          section_type: 'method',
          text: `The proposed architecture optimizes loss trajectories using localized orthogonal projection and asymmetric similarity matching across $d=768$ dimensions.`,
        },
        {
          chunk_id: `${paperId}_experiments`,
          section_title: 'Empirical Verification',
          section_type: 'experiment',
          text: `Benchmarking on standard test sets shows a 14.2% relative throughput acceleration with zero accuracy degradation under quantized weights.`,
        },
      ],
    };

    this.paperDetailCache.set(paperId, detail);
    return detail;
  }
}
