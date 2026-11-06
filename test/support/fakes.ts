import { createHash } from 'crypto';
import type { EmbeddingPort } from '../../src/engines/embedding/embedding.service';
import type {
  GenerateOptions,
  LlmEngine,
} from '../../src/engines/llm/llm-engine';
import type { QdrantReader } from '../../src/engines/vector-store/vector-store.service';
import { DIM, SeedPoint, seedPoints } from '../../scripts/seed-qdrant';

/** Deterministic unit vector from the text (stands in for Nomic in e2e runs). */
export const fakeEmbedding: EmbeddingPort & { onModuleInit(): void } = {
  onModuleInit: () => undefined,
  isReady: () => true,
  embedQuery: (q: string) => {
    const v: number[] = [];
    let block = Buffer.alloc(0);
    for (let i = 0; v.length < DIM; i++) {
      if (block.length === 0)
        block = createHash('sha256').update(`${q}#${i}`).digest();
      v.push(block[0] / 127.5 - 1);
      block = block.subarray(1);
    }
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return Promise.resolve(v.map((x) => x / n));
  },
};

/** Answers by citing the first paper of the context it was given. */
export class FakeLlmEngine implements LlmEngine {
  load() {
    return Promise.resolve({ gpu: 'cpu' });
  }

  async generate(
    _system: string,
    user: string,
    o: GenerateOptions,
  ): Promise<void> {
    const id = /\[Paper: ([^\]]+)\]/.exec(user)?.[1] ?? 'none';
    for (const t of ['Grounded ', 'answer ', `[Paper: ${id}].`]) {
      if (o.signal.aborted) return;
      await new Promise((r) => setImmediate(r));
      o.onToken(t);
    }
  }
}

const dot = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + x * b[i], 0);

type Must = Array<{ key: string; match: { value?: string; any?: number[] } }>;

function matches(p: SeedPoint, must: Must | undefined): boolean {
  return (must ?? []).every((m) => {
    const v = p.payload[m.key];
    if (m.match.value !== undefined) return v === m.match.value;
    return m.match.any?.includes(v as number) ?? true;
  });
}

/** Read-only Qdrant over the same points `scripts/seed-qdrant.ts` writes. */
export function inMemoryQdrant(
  points: SeedPoint[] = seedPoints(),
): QdrantReader {
  const reader = {
    getCollection: () =>
      Promise.resolve({
        config: { params: { vectors: { size: DIM, distance: 'Cosine' } } },
        payload_schema: { paper_id: {}, primary_category: {}, year: {} },
      }),
    query: (
      _c: string,
      req: { query: number[]; limit: number; filter?: { must?: Must } },
    ) =>
      Promise.resolve({
        points: points
          .filter((p) => matches(p, req.filter?.must))
          .map((p) => ({
            id: p.id,
            score: dot(p.vector, req.query),
            payload: p.payload,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, req.limit),
      }),
    scroll: (_c: string, req: { filter?: { must?: Must }; limit: number }) =>
      Promise.resolve({
        points: points
          .filter((p) => matches(p, req.filter?.must))
          .slice(0, req.limit)
          .map((p) => ({ id: p.id, payload: p.payload })),
        next_page_offset: null,
      }),
  };
  return reader as unknown as QdrantReader;
}
