import { analyzeTradeoffs } from './tradeoff.analyzer';
import { actionPriorityItemSchema } from '../schemas/integrated.schema';

describe('TradeoffAnalyzer', () => {
  it('handles missing or failed suites gracefully without throwing', () => {
    const res = analyzeTradeoffs(undefined, undefined, undefined);

    expect(res.tradeoffs.retrieval_generation_link.summary).toContain('Chưa đủ dữ liệu');
    expect(res.tradeoffs.concurrency_scaling.summary).toContain('Chưa đủ dữ liệu');
    expect(res.tradeoffs.rerank_impact.summary).toContain('Chưa đủ dữ liệu');
    expect(res.tradeoffs.citation_reliability.summary).toContain('Chưa đủ dữ liệu');

    // Action priorities should still be defined
    expect(res.actionPriorities.length).toBeGreaterThan(0);
    for (const item of res.actionPriorities) {
      expect(() => actionPriorityItemSchema.parse(item)).not.toThrow();
    }
  });

  it('performs cross-phase analysis when suites are completed', () => {
    const mockRetrievalInfo: any = {
      status: 'completed',
      duration_ms: 50,
      data: {
        config: { k_values: [1, 3, 5, 10] },
        results: [{ query_id: 'q1' }],
        pre_rerank_aggregated: {
          paper_recall: { 5: { mean: 0.5 } },
          paper_mrr: { 5: { mean: 0.6 } },
        },
        post_rerank_aggregated: {
          paper_recall: { 3: { mean: 0.4 }, 5: { mean: 0.55 } },
          paper_mrr: { 5: { mean: 0.65 } },
        },
      },
    };

    const mockGenerationInfo: any = {
      status: 'completed',
      duration_ms: 80,
      data: {
        config: { rubric_version: '1.0.0' },
        aggregated_metrics: {
          mean_faithfulness_score: 0.65,
          total_supported_claims: 13,
          total_claims_evaluated: 20,
          mean_citation_id_precision: 1.0,
          total_hallucinated_citations: 0,
          abstention: {
            abstention_precision: 1.0,
          },
        },
      },
    };

    const mockRuntimeInfo: any = {
      status: 'completed',
      duration_ms: 120,
      data: {
        title: 'Mock Runtime',
        base_url: 'http://localhost:3000',
        scenarios: [
          {
            config: { name: 'c1', concurrency: 1, total_requests: 5 },
            aggregated_metrics: {
              scenario: 'c1',
              concurrency_level: 1,
              total_latency: { p50: 100, p95: 120, p99: 130 },
              success_rate: 100,
              throughput: { completed_rps: 10 },
            },
          },
          {
            config: { name: 'c2', concurrency: 2, total_requests: 10 },
            aggregated_metrics: {
              scenario: 'c2',
              concurrency_level: 2,
              total_latency: { p50: 190, p95: 230, p99: 250 },
              success_rate: 100,
              throughput: { completed_rps: 9 },
            },
          },
        ],
      },
    };

    const { tradeoffs, actionPriorities } = analyzeTradeoffs(
      mockRetrievalInfo,
      mockRuntimeInfo,
      mockGenerationInfo,
    );

    // Cross-phase correlation
    expect(tradeoffs.retrieval_generation_link.correlation_observed).toBe(true);
    expect(tradeoffs.retrieval_generation_link.summary).toContain('55.0%');
    expect(tradeoffs.retrieval_generation_link.summary).toContain('65.0%');

    // Concurrency scaling
    expect(tradeoffs.concurrency_scaling.saturation_point).toContain('Concurrency = 1');
    expect(tradeoffs.concurrency_scaling.p95_degradation).toContain('120ms');
    expect(tradeoffs.concurrency_scaling.p95_degradation).toContain('230ms');

    // Rerank impact (Gain: 0.55 - 0.50 = +5.00%)
    expect(tradeoffs.rerank_impact.recall_gain_pct).toBe(5);

    // Citation reliability
    expect(tradeoffs.citation_reliability.in_context_precision_pct).toBe(100);
    expect(tradeoffs.citation_reliability.hallucination_count).toBe(0);

    // Action priorities
    expect(actionPriorities.length).toBeGreaterThanOrEqual(3);
    const p0 = actionPriorities.find((a) => a.priority === 'P0');
    expect(p0).toBeDefined();
    expect(p0?.classification).toBe('confirmed_bug');
  });
});
