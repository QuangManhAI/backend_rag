import {
  isAbstentionAnswer,
  evaluateSingleAbstention,
  aggregateAbstentionMetrics,
  SingleAbstentionEvaluation,
} from './abstention.evaluator';
import { NO_CONTEXT_ANSWER } from '../../src/rag/prompt-builder';

describe('AbstentionEvaluator', () => {
  describe('isAbstentionAnswer', () => {
    it('detects standard NO_CONTEXT_ANSWER', () => {
      const res = isAbstentionAnswer(NO_CONTEXT_ANSWER);
      expect(res.isAbstention).toBe(true);
      expect(res.matchedPhrase).toBe('NO_CONTEXT_ANSWER');
    });

    it('detects english abstention variants', () => {
      const answers = [
        'The provided context does not contain sufficient details regarding hyperparameter tuning.',
        'There is no relevant information in the retrieved papers to answer this query.',
        'This cannot be answered from the provided literature.',
      ];
      for (const ans of answers) {
        const res = isAbstentionAnswer(ans);
        expect(res.isAbstention).toBe(true);
      }
    });

    it('detects vietnamese abstention variants', () => {
      const res = isAbstentionAnswer('Rất tiếc, không tìm thấy tài liệu liên quan trong kho dữ liệu.');
      expect(res.isAbstention).toBe(true);
    });

    it('returns false for informative answers', () => {
      const ans = 'Transformer models utilize self-attention mechanisms [paper_1] with quadratic complexity.';
      const res = isAbstentionAnswer(ans);
      expect(res.isAbstention).toBe(false);
    });
  });

  describe('evaluateSingleAbstention', () => {
    it('correctly classifies True Abstention (expected=true, actual=true)', () => {
      const res = evaluateSingleAbstention(NO_CONTEXT_ANSWER, true);
      expect(res.is_true_abstention).toBe(true);
      expect(res.is_false_abstention).toBe(false);
      expect(res.is_unsupported_answer).toBe(false);
    });

    it('correctly classifies False Abstention / Unwarranted Refusal (expected=false, actual=true)', () => {
      const res = evaluateSingleAbstention(NO_CONTEXT_ANSWER, false);
      expect(res.is_true_abstention).toBe(false);
      expect(res.is_false_abstention).toBe(true);
      expect(res.is_unsupported_answer).toBe(false);
    });

    it('correctly classifies Unsupported Answer / Hallucination (expected=true, actual=false)', () => {
      const res = evaluateSingleAbstention(
        'The answer is 42 and it works perfectly.',
        true,
      );
      expect(res.is_true_abstention).toBe(false);
      expect(res.is_false_abstention).toBe(false);
      expect(res.is_unsupported_answer).toBe(true);
    });

    it('correctly classifies Normal Answer (expected=false, actual=false)', () => {
      const res = evaluateSingleAbstention(
        'Transformer models utilize self-attention mechanisms.',
        false,
      );
      expect(res.is_true_abstention).toBe(false);
      expect(res.is_false_abstention).toBe(false);
      expect(res.is_unsupported_answer).toBe(false);
    });
  });

  describe('aggregateAbstentionMetrics', () => {
    it('calculates precision, recall, false abstention rate, unsupported answer rate accurately', () => {
      const evals: SingleAbstentionEvaluation[] = [
        // Expected abstention: 2 items
        {
          is_abstention: true,
          expected_abstention: true,
          is_true_abstention: true,
          is_false_abstention: false,
          is_unsupported_answer: false,
        },
        {
          is_abstention: false,
          expected_abstention: true,
          is_true_abstention: false,
          is_false_abstention: false,
          is_unsupported_answer: true,
        },
        // Answerable: 2 items
        {
          is_abstention: false,
          expected_abstention: false,
          is_true_abstention: false,
          is_false_abstention: false,
          is_unsupported_answer: false,
        },
        {
          is_abstention: true,
          expected_abstention: false,
          is_true_abstention: false,
          is_false_abstention: true,
          is_unsupported_answer: false,
        },
      ];

      const agg = aggregateAbstentionMetrics(evals);

      expect(agg.total_samples).toBe(4);
      expect(agg.expected_abstention_count).toBe(2);
      expect(agg.actual_abstention_count).toBe(2);
      expect(agg.true_abstention_count).toBe(1);
      expect(agg.false_abstention_count).toBe(1);
      expect(agg.unsupported_answer_count).toBe(1);

      // Precision = true_abstention / actual_abstention = 1 / 2 = 0.5
      expect(agg.abstention_precision).toBe(0.5);
      // Recall = true_abstention / expected_abstention = 1 / 2 = 0.5
      expect(agg.abstention_recall).toBe(0.5);
      // False abstention rate = false_abstention / total_answerable = 1 / 2 = 0.5
      expect(agg.false_abstention_rate).toBe(0.5);
      // Unsupported answer rate = unsupported_answers / expected_abstention = 1 / 2 = 0.5
      expect(agg.unsupported_answer_rate).toBe(0.5);
    });
  });
});
