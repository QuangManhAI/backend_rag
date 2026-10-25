import { NO_CONTEXT_ANSWER } from '../../src/rag/prompt-builder';

export interface SingleAbstentionEvaluation {
  is_abstention: boolean;
  expected_abstention: boolean;
  is_true_abstention: boolean;   // expected=true, is_abstention=true
  is_false_abstention: boolean;  // expected=false, is_abstention=true (unwarranted refusal)
  is_unsupported_answer: boolean;// expected=true, is_abstention=false (hallucinated response)
  matched_abstention_phrase?: string;
}

export interface AggregatedAbstentionMetrics {
  total_samples: number;
  expected_abstention_count: number;
  actual_abstention_count: number;

  true_abstention_count: number;
  false_abstention_count: number;
  unsupported_answer_count: number;

  abstention_precision: number;
  abstention_recall: number;
  false_abstention_rate: number;
  unsupported_answer_rate: number;
}

const ABSTENTION_PATTERNS = [
  /does not contain sufficient details/i,
  /not contain sufficient details regarding/i,
  /no relevant (?:information|literature|excerpts|documents)/i,
  /insufficient information/i,
  /cannot be answered (?:based on|from) the provided/i,
  /không tìm thấy tài liệu/i,
  /không có thông tin/i,
];

/**
 * Checks if the answer is an explicit abstention / refusal to answer due to lack of evidence.
 */
export function isAbstentionAnswer(answer: string): {
  isAbstention: boolean;
  matchedPhrase?: string;
} {
  const trimmed = answer.trim();
  if (trimmed === NO_CONTEXT_ANSWER) {
    return { isAbstention: true, matchedPhrase: 'NO_CONTEXT_ANSWER' };
  }

  for (const pattern of ABSTENTION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { isAbstention: true, matchedPhrase: match[0] };
    }
  }

  return { isAbstention: false };
}

/**
 * Evaluates abstention behavior for a single query.
 */
export function evaluateSingleAbstention(
  answer: string,
  expectedAbstention: boolean,
): SingleAbstentionEvaluation {
  const { isAbstention, matchedPhrase } = isAbstentionAnswer(answer);

  const isTrueAbstention = expectedAbstention && isAbstention;
  const isFalseAbstention = !expectedAbstention && isAbstention;
  const isUnsupportedAnswer = expectedAbstention && !isAbstention;

  return {
    is_abstention: isAbstention,
    expected_abstention: expectedAbstention,
    is_true_abstention: isTrueAbstention,
    is_false_abstention: isFalseAbstention,
    is_unsupported_answer: isUnsupportedAnswer,
    matched_abstention_phrase: matchedPhrase,
  };
}

/**
 * Aggregates abstention metrics across an entire evaluation suite.
 */
export function aggregateAbstentionMetrics(
  evaluations: SingleAbstentionEvaluation[],
): AggregatedAbstentionMetrics {
  const total = evaluations.length;
  let expectedAbstention = 0;
  let actualAbstention = 0;
  let trueAbstentions = 0;
  let falseAbstentions = 0;
  let unsupportedAnswers = 0;

  for (const ev of evaluations) {
    if (ev.expected_abstention) expectedAbstention++;
    if (ev.is_abstention) actualAbstention++;
    if (ev.is_true_abstention) trueAbstentions++;
    if (ev.is_false_abstention) falseAbstentions++;
    if (ev.is_unsupported_answer) unsupportedAnswers++;
  }

  const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

  const precision =
    actualAbstention > 0 ? trueAbstentions / actualAbstention : 1.0;
  const recall =
    expectedAbstention > 0 ? trueAbstentions / expectedAbstention : 1.0;

  const totalAnswerable = total - expectedAbstention;
  const falseAbstentionRate =
    totalAnswerable > 0 ? falseAbstentions / totalAnswerable : 0.0;
  const unsupportedAnswerRate =
    expectedAbstention > 0 ? unsupportedAnswers / expectedAbstention : 0.0;

  return {
    total_samples: total,
    expected_abstention_count: expectedAbstention,
    actual_abstention_count: actualAbstention,
    true_abstention_count: trueAbstentions,
    false_abstention_count: falseAbstentions,
    unsupported_answer_count: unsupportedAnswers,
    abstention_precision: round4(precision),
    abstention_recall: round4(recall),
    false_abstention_rate: round4(falseAbstentionRate),
    unsupported_answer_rate: round4(unsupportedAnswerRate),
  };
}
