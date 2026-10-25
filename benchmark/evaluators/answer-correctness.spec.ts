import {
  computeTokenF1,
  computeRougeL,
  evaluateAnswerCorrectness,
} from './answer-correctness.evaluator';

describe('Answer Correctness Evaluator Unit Tests', () => {
  describe('computeTokenF1', () => {
    it('returns 1.0 for identical text regardless of case/punctuation', () => {
      const pred = 'LoRA freezes weights and injects low-rank matrices!';
      const ref = 'lora freezes weights, and injects low-rank matrices.';
      const res = computeTokenF1(pred, ref);
      expect(res.precision).toBe(1.0);
      expect(res.recall).toBe(1.0);
      expect(res.f1).toBe(1.0);
    });

    it('returns 0 for completely disjoint text', () => {
      const res = computeTokenF1('deep neural network', 'apple banana orange');
      expect(res.f1).toBe(0);
    });

    it('computes exact hand-calculated Token F1 on partial match', () => {
      // Pred: ["alpha", "beta", "gamma", "delta"] (4 words)
      // Ref: ["beta", "delta", "epsilon"] (3 words)
      // Common: ["beta", "delta"] (2 words)
      // Precision = 2/4 = 0.5
      // Recall = 2/3 ≈ 0.6667
      // F1 = 2 * (0.5 * 0.6667) / (0.5 + 0.6667) = 0.6667 / 1.1667 ≈ 0.5714
      const res = computeTokenF1('alpha beta gamma delta', 'beta delta epsilon');
      expect(res.precision).toBe(0.5);
      expect(res.recall).toBeCloseTo(2 / 3, 4);
      expect(res.f1).toBeCloseTo(0.5714, 4);
    });
  });

  describe('computeRougeL', () => {
    it('computes exact LCS (Longest Common Subsequence) score', () => {
      // Pred: "the cat sat on mat" (5 words)
      // Ref: "the cat on mat" (4 words)
      // LCS: "the cat on mat" (4 words)
      // Precision = 4/5 = 0.8
      // Recall = 4/4 = 1.0
      // F1 = 2 * (0.8 * 1.0) / (0.8 + 1.0) = 1.6 / 1.8 ≈ 0.8889
      const res = computeRougeL('the cat sat on mat', 'the cat on mat');
      expect(res.precision).toBe(0.8);
      expect(res.recall).toBe(1.0);
      expect(res.f1).toBeCloseTo(0.8889, 4);
    });
  });

  describe('evaluateAnswerCorrectness', () => {
    it('handles missing reference answer gracefully', () => {
      const res = evaluateAnswerCorrectness('Some answer', undefined);
      expect(res.has_reference).toBe(false);
      expect(res.exact_match).toBe(false);
      expect(res.token_f1.f1).toBe(0);
    });
  });
});
