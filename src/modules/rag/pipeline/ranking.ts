import { round4 } from '../../../engines/mining/mining.service';
import type {
  CompareCandidate,
  GroundedChunk,
  ScoredChunk,
} from '../../../types/scientific-rag';

/** Candidates the judge reads: enough to reorder, few enough to keep the wait in seconds. */
export const judgedPoolSize = (topK: number) =>
  Math.min(20, Math.max(10, topK * 2));
/** Evidence passages for the groundedness check. */
export const GROUNDED_PASSAGES = 3;
/** The usual constant of reciprocal rank fusion. */
export const RRF_K = 60;

/** Best score per paper, highest first, at most `limit` papers. */
export function topPapers(
  hits: ScoredChunk[],
  limit: number,
): CompareCandidate[] {
  const best = new Map<string, number>();
  for (const h of hits) {
    if (h.score > (best.get(h.paper_id) ?? -Infinity))
      best.set(h.paper_id, h.score);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([paper_id, score]) => ({ paper_id, score: round4(score) }));
}

/**
 * Fuses the existing order with Laya's order (reciprocal rank fusion): on our evaluation either
 * order alone ranked worse than the two together (`benchmark/eval-laya-variants.mjs`). `pool` is
 * best first and `scores` follow it by index. `final_score` is the fused score scaled to 0–1.
 */
export function fuseRanks(
  pool: GroundedChunk[],
  scores: number[],
): GroundedChunk[] {
  const byRelevance = pool
    .map((_, i) => i)
    .sort((a, b) => scores[b] - scores[a] || a - b);
  const relevanceRank = new Map(
    byRelevance.map((poolIndex, rank) => [poolIndex, rank]),
  );
  const best = 2 / (RRF_K + 1);
  return pool
    .map((c, i) => ({
      c,
      i,
      fused:
        1 / (RRF_K + i + 1) + 1 / (RRF_K + (relevanceRank.get(i) ?? i) + 1),
    }))
    .sort((a, b) => b.fused - a.fused || a.i - b.i)
    .map(({ c, i, fused }) => ({
      ...c,
      relevance_score: round4(scores[i]),
      final_score: round4(fused / best),
    }));
}
