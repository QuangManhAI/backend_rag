import { tokenizeWords } from './answer-correctness.evaluator';

export interface AnswerRelevanceResult {
  query_keyword_coverage: number;
  is_direct_and_concise: boolean;
  length_chars: number;
  relevance_score: number;
}

const QUERY_STOPWORDS = new Set([
  'what', 'how', 'why', 'when', 'where', 'which', 'who', 'is', 'are', 'was',
  'were', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
  'does', 'do', 'did', 'can', 'could', 'explain', 'describe', 'compare',
]);

/**
 * Evaluates Answer Relevance using query coverage and conciseness heuristics.
 */
export function evaluateAnswerRelevance(
  query: string,
  answer: string,
): AnswerRelevanceResult {
  const queryTokens = tokenizeWords(query).filter(
    (w) => !QUERY_STOPWORDS.has(w),
  );
  const answerTokensSet = new Set(tokenizeWords(answer));

  let covered = 0;
  for (const t of queryTokens) {
    if (answerTokensSet.has(t)) {
      covered++;
    }
  }

  const coverage =
    queryTokens.length > 0 ? covered / queryTokens.length : 1.0;

  const lengthChars = answer.trim().length;
  // A direct, non-rambling answer is typically between 30 and 2500 characters
  const isDirect = lengthChars >= 25 && lengthChars <= 3000;

  // Relevance score weighted: 75% keyword coverage + 25% directness
  let score = 0.75 * coverage + 0.25 * (isDirect ? 1.0 : 0.5);
  score = Math.round(score * 1e4) / 1e4;

  return {
    query_keyword_coverage: Math.round(coverage * 1e4) / 1e4,
    is_direct_and_concise: isDirect,
    length_chars: lengthChars,
    relevance_score: score,
  };
}
