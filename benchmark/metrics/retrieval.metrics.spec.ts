import {
  recallAtK,
  precisionAtK,
  mrrAtK,
  ndcgAtK,
  hitRateAtK,
  deduplicatePapersPreservingRank,
  evaluateSingleQuery,
  aggregateMetrics,
} from './retrieval.metrics';

describe('Retrieval Metrics Unit Tests', () => {
  describe('recallAtK', () => {
    const relevant = new Set(['doc1', 'doc2', 'doc3']);

    it('calculates recall correctly with partial matches', () => {
      // 1 hit out of 3 relevant
      expect(recallAtK(relevant, ['doc1', 'other1', 'other2'], 1)).toBeCloseTo(
        1 / 3,
        5,
      );
      expect(recallAtK(relevant, ['doc1', 'other1', 'other2'], 3)).toBeCloseTo(
        1 / 3,
        5,
      );

      // 2 hits out of 3 relevant
      expect(
        recallAtK(relevant, ['doc1', 'other1', 'doc2', 'doc3'], 3),
      ).toBeCloseTo(2 / 3, 5);

      // 3 hits (perfect recall)
      expect(
        recallAtK(relevant, ['doc1', 'doc2', 'doc3', 'other'], 3),
      ).toBe(1.0);
    });

    it('returns 0 when no relevant items are retrieved', () => {
      expect(recallAtK(relevant, ['x1', 'x2', 'x3'], 3)).toBe(0);
    });

    it('returns NaN when relevant set is empty (edge case)', () => {
      expect(Number.isNaN(recallAtK(new Set(), ['doc1'], 1))).toBe(true);
    });

    it('returns 0 when retrieved list is empty or k=0', () => {
      expect(recallAtK(relevant, [], 5)).toBe(0);
      expect(recallAtK(relevant, ['doc1'], 0)).toBe(0);
    });
  });

  describe('precisionAtK', () => {
    const relevant = new Set(['doc1', 'doc2']);

    it('calculates precision correctly', () => {
      // 1 hit in top 2 => 1/2 = 0.5
      expect(precisionAtK(relevant, ['doc1', 'irr1'], 2)).toBe(0.5);

      // 2 hits in top 2 => 2/2 = 1.0
      expect(precisionAtK(relevant, ['doc1', 'doc2'], 2)).toBe(1.0);

      // 1 hit in top 4 => 1/4 = 0.25
      expect(precisionAtK(relevant, ['doc1', 'irr1', 'irr2', 'irr3'], 4)).toBe(
        0.25,
      );
    });

    it('returns 0 when no relevant items or k <= 0', () => {
      expect(precisionAtK(relevant, ['irr1', 'irr2'], 2)).toBe(0);
      expect(precisionAtK(relevant, ['doc1'], 0)).toBe(0);
    });
  });

  describe('mrrAtK', () => {
    const relevant = new Set(['target1', 'target2']);

    it('returns 1.0 when first result is relevant', () => {
      expect(mrrAtK(relevant, ['target1', 'other'], 5)).toBe(1.0);
    });

    it('returns reciprocal of 1-based rank', () => {
      // First relevant at index 1 (rank 2) => 1/2 = 0.5
      expect(mrrAtK(relevant, ['irr1', 'target1'], 5)).toBe(0.5);

      // First relevant at index 2 (rank 3) => 1/3 ≈ 0.3333
      expect(mrrAtK(relevant, ['irr1', 'irr2', 'target2'], 5)).toBeCloseTo(
        1 / 3,
        4,
      );
    });

    it('returns 0 when relevant item is beyond K', () => {
      // First relevant is at rank 3, but K=2
      expect(mrrAtK(relevant, ['irr1', 'irr2', 'target1'], 2)).toBe(0);
    });

    it('returns NaN when relevant set is empty', () => {
      expect(Number.isNaN(mrrAtK(new Set(), ['doc1'], 3))).toBe(true);
    });
  });

  describe('hitRateAtK', () => {
    const relevant = new Set(['docA']);

    it('returns 1 when hit exists within K and 0 when not', () => {
      expect(hitRateAtK(relevant, ['irr', 'docA'], 2)).toBe(1);
      expect(hitRateAtK(relevant, ['irr', 'docA'], 1)).toBe(0);
      expect(hitRateAtK(relevant, ['irr1', 'irr2'], 2)).toBe(0);
    });
  });

  describe('ndcgAtK', () => {
    it('returns 1.0 for perfect ranking', () => {
      const grades = new Map([
        ['d1', 3],
        ['d2', 2],
        ['d3', 1],
      ]);
      expect(ndcgAtK(grades, ['d1', 'd2', 'd3'], 3)).toBeCloseTo(1.0, 5);
    });

    it('calculates correct hand-computed nDCG for sub-optimal ranking', () => {
      // Grades: A=3, B=2, C=1
      // Ideal order: [A, B, C]
      // IDCG@3 = (2^3-1)/log2(2) + (2^2-1)/log2(3) + (2^1-1)/log2(4)
      //        = 7/1 + 3/1.5849625 + 1/2 = 7 + 1.892789 + 0.5 = 9.392789
      // Actual retrieved: [A, C, B]
      // DCG@3 = (2^3-1)/1 + (2^1-1)/log2(3) + (2^2-1)/2
      //       = 7 + 1/1.5849625 + 3/2 = 7 + 0.63092975 + 1.5 = 9.13092975
      // nDCG@3 = 9.13092975 / 9.392789 ≈ 0.972121
      const grades = new Map([
        ['A', 3],
        ['B', 2],
        ['C', 1],
      ]);
      const score = ndcgAtK(grades, ['A', 'C', 'B'], 3);
      expect(score).toBeCloseTo(0.9721, 3);
    });

    it('returns 0 when all retrieved documents have 0 relevance', () => {
      const grades = new Map([['A', 2]]);
      expect(ndcgAtK(grades, ['X', 'Y'], 2)).toBe(0);
    });

    it('returns NaN when there are no positive relevance grades in ground truth', () => {
      const grades = new Map([['A', 0]]);
      expect(Number.isNaN(ndcgAtK(grades, ['A'], 1))).toBe(true);
    });
  });

  describe('deduplicatePapersPreservingRank', () => {
    it('deduplicates consecutive and non-consecutive chunks from the same paper preserving first rank', () => {
      const chunks = [
        { paper_id: 'p1' },
        { paper_id: 'p2' },
        { paper_id: 'p1' },
        { paper_id: 'p3' },
        { paper_id: 'p2' },
      ];
      expect(deduplicatePapersPreservingRank(chunks)).toEqual([
        'p1',
        'p2',
        'p3',
      ]);
    });
  });

  describe('evaluateSingleQuery and aggregateMetrics', () => {
    it('correctly skips unanswerable query with no relevant documents', () => {
      const result = evaluateSingleQuery({
        query_id: 'unans_1',
        category: 'general',
        answerable: false,
        ground_truth: {},
        retrieved_chunks: [{ chunk_id: 'c1', paper_id: 'p1' }],
        k_values: [1, 3, 5],
      });
      expect(result.skipped).toBe(true);
      expect(result.is_empty_retrieval).toBe(false);
    });

    it('correctly aggregates across valid and skipped queries', () => {
      const q1 = evaluateSingleQuery({
        query_id: 'q1',
        category: 'cs.AI',
        answerable: true,
        ground_truth: { relevant_paper_ids: ['p1'] },
        retrieved_chunks: [
          { chunk_id: 'c1', paper_id: 'p1' },
          { chunk_id: 'c2', paper_id: 'p2' },
        ],
        k_values: [1, 5],
      });

      const q2 = evaluateSingleQuery({
        query_id: 'q2',
        category: 'cs.AI',
        answerable: true,
        ground_truth: { relevant_paper_ids: ['p99'] },
        retrieved_chunks: [
          { chunk_id: 'c1', paper_id: 'p1' },
          { chunk_id: 'c2', paper_id: 'p2' },
        ],
        k_values: [1, 5],
      });

      const q3 = evaluateSingleQuery({
        query_id: 'q3',
        category: 'other',
        answerable: false,
        ground_truth: {},
        retrieved_chunks: [],
        k_values: [1, 5],
      });

      const agg = aggregateMetrics([q1, q2, q3], [1, 5]);

      expect(agg.total_queries).toBe(3);
      expect(agg.evaluated_queries).toBe(2);
      expect(agg.skipped_queries).toBe(1);
      expect(agg.empty_retrieval_count).toBe(1);

      // q1 Recall@1 = 1.0, q2 Recall@1 = 0.0 => Average Recall@1 = 0.5
      expect(agg.paper_recall[1].mean).toBe(0.5);
      expect(agg.paper_recall[1].evaluated_count).toBe(2);

      // By category cs.AI has 2 evaluated queries
      expect(agg.by_category['cs.AI'].query_count).toBe(2);
      expect(agg.by_category['cs.AI'].paper_recall[1]).toBe(0.5);
    });
  });
});
