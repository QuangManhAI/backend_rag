/**
 * Pure mathematical functions for IR (Information Retrieval) evaluation metrics.
 * Implemented 100% in TypeScript with zero external dependencies.
 */

/**
 * Recall@K: Proportion of relevant items that are successfully retrieved in the top K.
 * Formula: |Retrieved@K ∩ Relevant| / |Relevant|
 *
 * Edge cases:
 * - If relevant set is empty (|Relevant| == 0): Returns NaN (caller should exclude from average).
 * - If retrieved list is empty: Returns 0.
 * - Value range: [0.0, 1.0].
 */
export function recallAtK(
  relevant: Set<string>,
  retrieved: readonly string[],
  k: number,
): number {
  if (relevant.size === 0) return NaN;
  if (k <= 0) return 0;
  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const item of topK) {
    if (relevant.has(item)) hits++;
  }
  return hits / relevant.size;
}

/**
 * Precision@K: Proportion of the top K retrieved items that are relevant.
 * Formula: |Retrieved@K ∩ Relevant| / K
 *
 * Edge cases:
 * - If k <= 0: Returns 0.
 * - If retrieved has fewer than K items: Denominator remains K (standard IR definition).
 * - Value range: [0.0, 1.0].
 */
export function precisionAtK(
  relevant: Set<string>,
  retrieved: readonly string[],
  k: number,
): number {
  if (k <= 0) return 0;
  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const item of topK) {
    if (relevant.has(item)) hits++;
  }
  return hits / k;
}

/**
 * MRR@K (Mean Reciprocal Rank @ K):
 * Reciprocal of the 1-based rank position of the FIRST relevant item in top K.
 * Formula: 1 / rank_1 (if rank_1 <= K), else 0.
 *
 * Edge cases:
 * - If relevant set is empty: Returns NaN.
 * - If no relevant item in top K: Returns 0.
 * - If first relevant item is at rank 1: Returns 1.0.
 * - Value range: [0.0, 1.0].
 */
export function mrrAtK(
  relevant: Set<string>,
  retrieved: readonly string[],
  k: number,
): number {
  if (relevant.size === 0) return NaN;
  if (k <= 0) return 0;
  const limit = Math.min(k, retrieved.length);
  for (let i = 0; i < limit; i++) {
    if (relevant.has(retrieved[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * HitRate@K: Binary indicator whether at least one relevant item appears in top K.
 * Returns 1 if hit, 0 if no hit. Returns NaN if relevant set is empty.
 */
export function hitRateAtK(
  relevant: Set<string>,
  retrieved: readonly string[],
  k: number,
): number {
  if (relevant.size === 0) return NaN;
  if (k <= 0) return 0;
  const topK = retrieved.slice(0, k);
  for (const item of topK) {
    if (relevant.has(item)) return 1;
  }
  return 0;
}

/**
 * nDCG@K (Normalized Discounted Cumulative Gain @ K):
 * Evaluates ranking quality considering graded or binary relevance with logarithmic position discounting.
 *
 * Formula:
 * DCG@K = Σ_{i=0}^{K-1} (2^{rel_i} - 1) / log_2(i + 2)
 * IDCG@K = Ideal DCG@K (ranking all relevant items sorted descending by relevance grade)
 * nDCG@K = DCG@K / IDCG@K
 *
 * Edge cases:
 * - If IDCG is 0 (no items have relevance > 0): Returns NaN.
 * - If retrieved list is empty: Returns 0.
 * - Value range: [0.0, 1.0].
 */
export function ndcgAtK(
  relevanceGrades: ReadonlyMap<string, number>,
  retrieved: readonly string[],
  k: number,
): number {
  if (k <= 0) return 0;

  // Extract all positive ideal grades sorted descending
  const idealGrades = Array.from(relevanceGrades.values())
    .filter((g) => g > 0)
    .sort((a, b) => b - a);

  if (idealGrades.length === 0) return NaN;

  // Calculate IDCG@K
  let idcg = 0;
  const idealLimit = Math.min(k, idealGrades.length);
  for (let i = 0; i < idealLimit; i++) {
    const gain = Math.pow(2, idealGrades[i]) - 1;
    const discount = Math.log2(i + 2); // i=0 => log2(2) = 1
    idcg += gain / discount;
  }

  if (idcg === 0) return 0;

  // Calculate DCG@K
  let dcg = 0;
  const limit = Math.min(k, retrieved.length);
  for (let i = 0; i < limit; i++) {
    const grade = relevanceGrades.get(retrieved[i]) ?? 0;
    if (grade > 0) {
      const gain = Math.pow(2, grade) - 1;
      const discount = Math.log2(i + 2);
      dcg += gain / discount;
    }
  }

  return dcg / idcg;
}

/**
 * Deduplicates retrieved chunks by their paper_id, preserving the rank of the first occurrence.
 * E.g. [paper1_chunk1, paper1_chunk2, paper2_chunk1] => [paper1, paper2]
 */
export function deduplicatePapersPreservingRank(
  chunkList: Array<{ paper_id: string }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of chunkList) {
    if (!seen.has(c.paper_id)) {
      seen.add(c.paper_id);
      out.push(c.paper_id);
    }
  }
  return out;
}

/** Evaluation metrics for a single query across multiple K values */
export interface SingleQueryMetrics {
  query_id: string;
  category?: string;
  answerable: boolean;
  skipped: boolean;
  skip_reason?: string;

  // Paper-level metrics
  paper_recall: Record<number, number>;
  paper_precision: Record<number, number>;
  paper_mrr: Record<number, number>;
  paper_ndcg: Record<number, number>;
  paper_hit_rate: Record<number, number>;

  // Chunk-level metrics
  chunk_recall: Record<number, number>;
  chunk_precision: Record<number, number>;
  chunk_mrr: Record<number, number>;
  chunk_ndcg: Record<number, number>;
  chunk_hit_rate: Record<number, number>;

  retrieved_paper_count: number;
  retrieved_chunk_count: number;
  is_empty_retrieval: boolean;
}

export interface MetricSummary {
  mean: number;
  evaluated_count: number;
}

/** Aggregated metrics across an entire evaluation suite */
export interface AggregatedRetrievalMetrics {
  total_queries: number;
  evaluated_queries: number;
  skipped_queries: number;
  empty_retrieval_count: number;
  empty_retrieval_rate: number;

  k_values: number[];

  // Paper-level aggregates
  paper_recall: Record<number, MetricSummary>;
  paper_precision: Record<number, MetricSummary>;
  paper_mrr: Record<number, MetricSummary>;
  paper_ndcg: Record<number, MetricSummary>;
  paper_hit_rate: Record<number, MetricSummary>;

  // Chunk-level aggregates
  chunk_recall: Record<number, MetricSummary>;
  chunk_precision: Record<number, MetricSummary>;
  chunk_mrr: Record<number, MetricSummary>;
  chunk_ndcg: Record<number, MetricSummary>;
  chunk_hit_rate: Record<number, MetricSummary>;

  // Per-category breakdown
  by_category: Record<
    string,
    {
      query_count: number;
      paper_recall: Record<number, number>;
      paper_mrr: Record<number, number>;
      paper_ndcg: Record<number, number>;
    }
  >;
}

export interface EvaluateQueryInput {
  query_id: string;
  category?: string;
  answerable: boolean;
  ground_truth: {
    relevant_paper_ids?: string[];
    paper_relevance_grades?: Record<string, number>;
    relevant_chunk_ids?: string[];
    chunk_relevance_grades?: Record<string, number>;
  };
  retrieved_chunks: Array<{ chunk_id: string; paper_id: string }>;
  k_values: number[];
}

/**
 * Evaluates a single query's retrieved items against ground truth.
 */
export function evaluateSingleQuery(
  input: EvaluateQueryInput,
): SingleQueryMetrics {
  const { query_id, category, answerable, ground_truth, retrieved_chunks, k_values } =
    input;

  const retrievedPaperIds = deduplicatePapersPreservingRank(retrieved_chunks);
  const retrievedChunkIds = retrieved_chunks.map((c) => c.chunk_id);

  // Build Paper relevance sets and maps
  const paperRelevantSet = new Set<string>(ground_truth.relevant_paper_ids ?? []);
  const paperGradesMap = new Map<string, number>();

  if (ground_truth.paper_relevance_grades) {
    for (const [id, grade] of Object.entries(ground_truth.paper_relevance_grades)) {
      paperGradesMap.set(id, grade);
      if (grade > 0) paperRelevantSet.add(id);
    }
  }
  // If no graded relevance provided, default binary relevance to grade 1
  for (const id of paperRelevantSet) {
    if (!paperGradesMap.has(id)) paperGradesMap.set(id, 1);
  }

  // Build Chunk relevance sets and maps
  const chunkRelevantSet = new Set<string>(ground_truth.relevant_chunk_ids ?? []);
  const chunkGradesMap = new Map<string, number>();

  if (ground_truth.chunk_relevance_grades) {
    for (const [id, grade] of Object.entries(ground_truth.chunk_relevance_grades)) {
      chunkGradesMap.set(id, grade);
      if (grade > 0) chunkRelevantSet.add(id);
    }
  }
  for (const id of chunkRelevantSet) {
    if (!chunkGradesMap.has(id)) chunkGradesMap.set(id, 1);
  }

  // Check if this query should be skipped from recall/ranking evaluation
  // (e.g. unanswerable query with no relevant documents)
  if (!answerable && paperRelevantSet.size === 0 && chunkRelevantSet.size === 0) {
    return {
      query_id,
      category,
      answerable,
      skipped: true,
      skip_reason: 'Unanswerable query (no relevant documents expected)',
      paper_recall: {},
      paper_precision: {},
      paper_mrr: {},
      paper_ndcg: {},
      paper_hit_rate: {},
      chunk_recall: {},
      chunk_precision: {},
      chunk_mrr: {},
      chunk_ndcg: {},
      chunk_hit_rate: {},
      retrieved_paper_count: retrievedPaperIds.length,
      retrieved_chunk_count: retrievedChunkIds.length,
      is_empty_retrieval: retrieved_chunks.length === 0,
    };
  }

  const paper_recall: Record<number, number> = {};
  const paper_precision: Record<number, number> = {};
  const paper_mrr: Record<number, number> = {};
  const paper_ndcg: Record<number, number> = {};
  const paper_hit_rate: Record<number, number> = {};

  const chunk_recall: Record<number, number> = {};
  const chunk_precision: Record<number, number> = {};
  const chunk_mrr: Record<number, number> = {};
  const chunk_ndcg: Record<number, number> = {};
  const chunk_hit_rate: Record<number, number> = {};

  for (const k of k_values) {
    // Paper-level
    if (paperRelevantSet.size > 0) {
      paper_recall[k] = recallAtK(paperRelevantSet, retrievedPaperIds, k);
      paper_precision[k] = precisionAtK(paperRelevantSet, retrievedPaperIds, k);
      paper_mrr[k] = mrrAtK(paperRelevantSet, retrievedPaperIds, k);
      paper_ndcg[k] = ndcgAtK(paperGradesMap, retrievedPaperIds, k);
      paper_hit_rate[k] = hitRateAtK(paperRelevantSet, retrievedPaperIds, k);
    }

    // Chunk-level
    if (chunkRelevantSet.size > 0) {
      chunk_recall[k] = recallAtK(chunkRelevantSet, retrievedChunkIds, k);
      chunk_precision[k] = precisionAtK(chunkRelevantSet, retrievedChunkIds, k);
      chunk_mrr[k] = mrrAtK(chunkRelevantSet, retrievedChunkIds, k);
      chunk_ndcg[k] = ndcgAtK(chunkGradesMap, retrievedChunkIds, k);
      chunk_hit_rate[k] = hitRateAtK(chunkRelevantSet, retrievedChunkIds, k);
    }
  }

  return {
    query_id,
    category,
    answerable,
    skipped: false,
    paper_recall,
    paper_precision,
    paper_mrr,
    paper_ndcg,
    paper_hit_rate,
    chunk_recall,
    chunk_precision,
    chunk_mrr,
    chunk_ndcg,
    chunk_hit_rate,
    retrieved_paper_count: retrievedPaperIds.length,
    retrieved_chunk_count: retrievedChunkIds.length,
    is_empty_retrieval: retrieved_chunks.length === 0,
  };
}

/** Computes the mean of non-NaN values */
function averageMetric(
  results: SingleQueryMetrics[],
  getter: (m: SingleQueryMetrics) => number | undefined,
): MetricSummary {
  let sum = 0;
  let count = 0;
  for (const r of results) {
    if (r.skipped) continue;
    const val = getter(r);
    if (val !== undefined && !Number.isNaN(val)) {
      sum += val;
      count++;
    }
  }
  return {
    mean: count > 0 ? Math.round((sum / count) * 1e4) / 1e4 : 0,
    evaluated_count: count,
  };
}

/**
 * Aggregates single query evaluation metrics across an entire dataset.
 */
export function aggregateMetrics(
  results: SingleQueryMetrics[],
  k_values: number[],
): AggregatedRetrievalMetrics {
  const total = results.length;
  const skipped = results.filter((r) => r.skipped).length;
  const evaluated = total - skipped;
  const emptyCount = results.filter((r) => r.is_empty_retrieval).length;
  const emptyRate =
    total > 0 ? Math.round((emptyCount / total) * 1e4) / 1e4 : 0;

  const agg: AggregatedRetrievalMetrics = {
    total_queries: total,
    evaluated_queries: evaluated,
    skipped_queries: skipped,
    empty_retrieval_count: emptyCount,
    empty_retrieval_rate: emptyRate,
    k_values,
    paper_recall: {},
    paper_precision: {},
    paper_mrr: {},
    paper_ndcg: {},
    paper_hit_rate: {},
    chunk_recall: {},
    chunk_precision: {},
    chunk_mrr: {},
    chunk_ndcg: {},
    chunk_hit_rate: {},
    by_category: {},
  };

  for (const k of k_values) {
    agg.paper_recall[k] = averageMetric(results, (m) => m.paper_recall[k]);
    agg.paper_precision[k] = averageMetric(
      results,
      (m) => m.paper_precision[k],
    );
    agg.paper_mrr[k] = averageMetric(results, (m) => m.paper_mrr[k]);
    agg.paper_ndcg[k] = averageMetric(results, (m) => m.paper_ndcg[k]);
    agg.paper_hit_rate[k] = averageMetric(
      results,
      (m) => m.paper_hit_rate[k],
    );

    agg.chunk_recall[k] = averageMetric(results, (m) => m.chunk_recall[k]);
    agg.chunk_precision[k] = averageMetric(
      results,
      (m) => m.chunk_precision[k],
    );
    agg.chunk_mrr[k] = averageMetric(results, (m) => m.chunk_mrr[k]);
    agg.chunk_ndcg[k] = averageMetric(results, (m) => m.chunk_ndcg[k]);
    agg.chunk_hit_rate[k] = averageMetric(
      results,
      (m) => m.chunk_hit_rate[k],
    );
  }

  // Group by category
  const categories = Array.from(
    new Set(results.map((r) => r.category || 'uncategorized')),
  );
  for (const cat of categories) {
    const catResults = results.filter(
      (r) => (r.category || 'uncategorized') === cat,
    );
    const catPaperRecall: Record<number, number> = {};
    const catPaperMrr: Record<number, number> = {};
    const catPaperNdcg: Record<number, number> = {};

    for (const k of k_values) {
      catPaperRecall[k] = averageMetric(
        catResults,
        (m) => m.paper_recall[k],
      ).mean;
      catPaperMrr[k] = averageMetric(catResults, (m) => m.paper_mrr[k]).mean;
      catPaperNdcg[k] = averageMetric(catResults, (m) => m.paper_ndcg[k]).mean;
    }

    agg.by_category[cat] = {
      query_count: catResults.length,
      paper_recall: catPaperRecall,
      paper_mrr: catPaperMrr,
      paper_ndcg: catPaperNdcg,
    };
  }

  return agg;
}
