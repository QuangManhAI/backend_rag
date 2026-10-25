import {
  DatasetItem,
  DatasetItemInput,
  datasetItemSchema,
} from '../datasets/schema';
import {
  AggregatedRetrievalMetrics,
  aggregateMetrics,
  evaluateSingleQuery,
  SingleQueryMetrics,
} from '../metrics/retrieval.metrics';
import type {
  ChunkPayload,
  GroundedChunk,
  ScoredChunk,
} from '../../src/types/scientific-rag';

export interface RetrievalResult {
  query_id: string;
  query: string;
  category?: string;
  answerable: boolean;

  /** Chunks returned by pure vector search before reranking */
  pre_rerank_chunks: Array<{ chunk_id: string; paper_id: string; score: number }>;

  /** Chunks after PageRank authority reranking */
  post_rerank_chunks: Array<{
    chunk_id: string;
    paper_id: string;
    final_score: number;
    similarity_score: number;
    authority_score: number;
  }>;

  timings: {
    embed_ms: number;
    route_ms: number;
    search_ms: number;
    rerank_ms: number;
    total_ms: number;
  };

  /** Pre-rerank evaluation metrics */
  pre_rerank_metrics: SingleQueryMetrics;

  /** Post-rerank evaluation metrics */
  post_rerank_metrics: SingleQueryMetrics;

  error?: string;
}

export interface RetrievalSuiteResult {
  config: {
    dataset_path?: string;
    k_values: number[];
    top_k: number;
    nprobe: number;
    use_authority_boost: boolean;
    expand_query: boolean;
    adapter_type: string;
  };
  duration_ms: number;
  results: RetrievalResult[];
  pre_rerank_aggregated: AggregatedRetrievalMetrics;
  post_rerank_aggregated: AggregatedRetrievalMetrics;
  failed_queries: Array<{ query_id: string; query: string; error: string }>;
}

/** Interface for pluggable retrieval backend */
export interface RetrievalAdapter {
  execute(
    query: string,
    options: {
      top_k: number;
      category?: string;
      nprobe: number;
      use_authority_boost: boolean;
      expand_query: boolean;
    },
  ): Promise<{
    pre_rerank_chunks: ScoredChunk[];
    post_rerank_chunks: GroundedChunk[];
    timings: {
      embed_ms: number;
      route_ms: number;
      search_ms: number;
      rerank_ms: number;
      total_ms: number;
    };
  }>;
}

export interface RetrievalRunnerOptions {
  k_values?: number[];
  top_k?: number;
  nprobe?: number;
  use_authority_boost?: boolean;
  expand_query?: boolean;
}

/**
 * Runs retrieval benchmark across all dataset items, calculating both
 * pre-rerank and post-rerank metrics for ablation analysis.
 */
export class RetrievalRunner {
  constructor(
    private readonly adapter: RetrievalAdapter,
    private readonly options: RetrievalRunnerOptions = {},
  ) {}

  async run(
    items: DatasetItemInput[],
    datasetPath?: string,
  ): Promise<RetrievalSuiteResult> {
    const validatedItems = items.map((it) => datasetItemSchema.parse(it));
    const k_values = this.options.k_values ?? [1, 3, 5, 10];
    const top_k = this.options.top_k ?? Math.max(...k_values, 5);
    const nprobe = this.options.nprobe ?? 2;
    const use_authority_boost = this.options.use_authority_boost ?? true;
    const expand_query = this.options.expand_query ?? false;

    const results: RetrievalResult[] = [];
    const failedQueries: Array<{ query_id: string; query: string; error: string }> =
      [];

    const suiteStartTime = performance.now();

    for (const item of validatedItems) {
      try {
        const res = await this.adapter.execute(item.query, {
          top_k,
          category: item.category,
          nprobe,
          use_authority_boost,
          expand_query,
        });

        const preMetrics = evaluateSingleQuery({
          query_id: item.query_id,
          category: item.category,
          answerable: item.answerable,
          ground_truth: item,
          retrieved_chunks: res.pre_rerank_chunks,
          k_values,
        });

        const postMetrics = evaluateSingleQuery({
          query_id: item.query_id,
          category: item.category,
          answerable: item.answerable,
          ground_truth: item,
          retrieved_chunks: res.post_rerank_chunks,
          k_values,
        });

        results.push({
          query_id: item.query_id,
          query: item.query,
          category: item.category,
          answerable: item.answerable,
          pre_rerank_chunks: res.pre_rerank_chunks.map((c) => ({
            chunk_id: c.chunk_id,
            paper_id: c.paper_id,
            score: c.score,
          })),
          post_rerank_chunks: res.post_rerank_chunks.map((c) => ({
            chunk_id: c.chunk_id,
            paper_id: c.paper_id,
            final_score: c.final_score,
            similarity_score: c.similarity_score,
            authority_score: c.authority_score,
          })),
          timings: res.timings,
          pre_rerank_metrics: preMetrics,
          post_rerank_metrics: postMetrics,
        });
      } catch (err) {
        const errorMsg = (err as Error).message;
        failedQueries.push({
          query_id: item.query_id,
          query: item.query,
          error: errorMsg,
        });
        results.push({
          query_id: item.query_id,
          query: item.query,
          category: item.category,
          answerable: item.answerable,
          pre_rerank_chunks: [],
          post_rerank_chunks: [],
          timings: { embed_ms: 0, route_ms: 0, search_ms: 0, rerank_ms: 0, total_ms: 0 },
          pre_rerank_metrics: {
            query_id: item.query_id,
            category: item.category,
            answerable: item.answerable,
            skipped: true,
            skip_reason: `Execution error: ${errorMsg}`,
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
            retrieved_paper_count: 0,
            retrieved_chunk_count: 0,
            is_empty_retrieval: true,
          },
          post_rerank_metrics: {
            query_id: item.query_id,
            category: item.category,
            answerable: item.answerable,
            skipped: true,
            skip_reason: `Execution error: ${errorMsg}`,
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
            retrieved_paper_count: 0,
            retrieved_chunk_count: 0,
            is_empty_retrieval: true,
          },
          error: errorMsg,
        });
      }
    }

    const duration_ms = Math.round(performance.now() - suiteStartTime);

    const preAggregated = aggregateMetrics(
      results.map((r) => r.pre_rerank_metrics),
      k_values,
    );

    const postAggregated = aggregateMetrics(
      results.map((r) => r.post_rerank_metrics),
      k_values,
    );

    return {
      config: {
        dataset_path: datasetPath,
        k_values,
        top_k,
        nprobe,
        use_authority_boost,
        expand_query,
        adapter_type: this.adapter.constructor.name,
      },
      duration_ms,
      results,
      pre_rerank_aggregated: preAggregated,
      post_rerank_aggregated: postAggregated,
      failed_queries: failedQueries,
    };
  }
}
