import { AppConfigService } from '../config/app-config.service';
import { parseEnv } from '../config/env.schema';
import { TEST_ENV } from '../testing/test-app';
import {
  buildIndex,
  clampNprobe,
  parseCategories,
  parseCentroids,
  parseTree,
  route,
  TreeRouterService,
} from './tree-router.service';

const DIM = 4;
const vec = (...xs: number[]) => xs;

// Branches 1, 2, 3 point along axes x, y, z. Twigs 11, 12 under 1; 21, 22 under 2; 31 under 3.
const tree = parseTree({
  world_version: 'w-test',
  nodes: [
    { id: 0, parent_id: null, depth: 0, label: 'trunk' },
    { id: 1, parent_id: 0, depth: 1, label: 'x' },
    { id: 2, parent_id: 0, depth: 1, label: 'y' },
    { id: 3, parent_id: 0, depth: 1, label: 'z' },
    { id: 11, parent_id: 1, depth: 2, label: 'x+w' },
    { id: 12, parent_id: 1, depth: 2, label: 'x-w' },
    { id: 21, parent_id: 2, depth: 2, label: 'y+w' },
    { id: 22, parent_id: 2, depth: 2, label: 'y-w' },
    { id: 31, parent_id: 3, depth: 2, label: 'z' },
  ],
});
const l1 = parseCentroids(
  {
    items: [
      { node_id: 1, vector: vec(1, 0, 0, 0) },
      { node_id: 2, vector: vec(0, 2, 0, 0) }, // not unit: normalised on load
      { node_id: 3, vector: vec(0, 0, 1, 0) },
    ],
  },
  DIM,
);
const l2 = parseCentroids(
  {
    items: [
      { node_id: 11, vector: vec(1, 0, 0, 1) },
      { node_id: 12, vector: vec(1, 0, 0, -1) },
      { node_id: 21, vector: vec(0, 1, 0, 1) },
      { node_id: 22, vector: vec(0, 1, 0, -1) },
      { node_id: 31, vector: vec(0, 0, 1, 0) },
    ],
  },
  DIM,
);
const index = buildIndex(tree, l1, l2);

describe('route', () => {
  it('nprobe 1: best branch, then best twig under it', () => {
    const [d1, d2] = route(vec(0.9, 0.1, 0, 0.4), index, 1);
    expect(d1.depth).toBe(1);
    expect(d1.candidates.map((c) => c.node_id)).toEqual([1, 2, 3]); // every branch
    expect(d1.chosen).toEqual([1]);
    expect(d2.candidates.map((c) => c.node_id)).toEqual([11, 12]); // only children of chosen
    expect(d2.chosen).toEqual([11]);
  });

  it('nprobe 2 at both levels', () => {
    const [d1, d2] = route(vec(0.7, 0.6, 0.1, -0.3), index, 2);
    expect(d1.chosen).toEqual([1, 2]);
    expect(d2.candidates).toHaveLength(4);
    expect(d2.chosen).toEqual([12, 22]);
  });

  it('scores are cosine rounded to 4 digits', () => {
    const [d1] = route(vec(3, 4, 0, 0), index, 1);
    expect(d1.candidates.find((c) => c.node_id === 2)?.score).toBe(0.8);
    expect(d1.candidates.find((c) => c.node_id === 1)?.score).toBe(0.6);
  });

  it('clamps nprobe to 1..6', () => {
    expect(clampNprobe(0)).toBe(1);
    expect(clampNprobe(9)).toBe(6);
    expect(clampNprobe(Number.NaN)).toBe(2);
    expect(route(vec(1, 1, 1, 0), index, 99)[0].chosen).toHaveLength(3);
  });
});

describe('parsers', () => {
  it('rejects centroids of the wrong dimension', () => {
    expect(() =>
      parseCentroids({ items: [{ node_id: 1, vector: [1, 2] }] }, DIM),
    ).toThrow(/2 dims/);
  });

  it('reads categories', () => {
    expect(
      parseCategories([{ index: 0, code: 'cs.LG', name: 'ML' }, { bad: 1 }]),
    ).toHaveLength(1);
  });
});

describe('TreeRouterService', () => {
  const config = new AppConfigService(
    parseEnv({
      ...TEST_ENV,
      MONGO_URI: 'mongodb://x',
      WORLD_DATA_DIR: '/nonexistent',
    }),
  );

  it('missing world files ➔ route returns [] and does not throw', async () => {
    const s = new TreeRouterService(config);
    await s.onModuleInit();
    expect(s.isLoaded()).toBe(false);
    expect(s.route(vec(1, 0, 0, 0), 2).steps).toEqual([]);
  });

  it('routes once loaded and reports the world version', () => {
    const s = new TreeRouterService(config);
    s.load(tree, l1, l2);
    expect(s.worldVersion()).toBe('w-test');
    expect(s.route(vec(0, 0, 1, 0), 1).steps[1].chosen).toEqual([31]);
  });

  it('categoryIndex falls back to "other"', () => {
    const s = new TreeRouterService(config);
    s.setCategories([
      { index: 0, code: 'cs.LG', name: 'ML' },
      { index: 9, code: 'other', name: 'Other' },
    ]);
    expect(s.categoryIndex('cs.LG')).toBe(0);
    expect(s.categoryIndex('q-bio.NC')).toBe(9);
  });
});
