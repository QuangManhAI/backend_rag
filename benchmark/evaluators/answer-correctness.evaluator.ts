/**
 * Answer Correctness Evaluator:
 * Compares model-generated answers against verified reference answers
 * using Token Overlap F1 and ROUGE-L (Longest Common Subsequence).
 * Pure TypeScript implementation with zero external dependencies.
 */

export interface TextOverlapResult {
  precision: number;
  recall: number;
  f1: number;
}

export interface AnswerCorrectnessResult {
  has_reference: boolean;
  token_f1: TextOverlapResult;
  rouge_l: TextOverlapResult;
  exact_match: boolean;
}

/** Tokenizes text into lowercase alphanumeric words */
export function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Computes Token Overlap (Bag-of-Words) Precision, Recall, and F1.
 */
export function computeTokenF1(
  prediction: string,
  reference: string,
): TextOverlapResult {
  const predTokens = tokenizeWords(prediction);
  const refTokens = tokenizeWords(reference);

  if (predTokens.length === 0 || refTokens.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  // Count frequencies
  const refCounts = new Map<string, number>();
  for (const t of refTokens) {
    refCounts.set(t, (refCounts.get(t) || 0) + 1);
  }

  let common = 0;
  for (const t of predTokens) {
    const count = refCounts.get(t) || 0;
    if (count > 0) {
      common++;
      refCounts.set(t, count - 1);
    }
  }

  const precision = common / predTokens.length;
  const recall = common / refTokens.length;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
  return {
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(f1),
  };
}

/**
 * Computes ROUGE-L (Longest Common Subsequence) Precision, Recall, and F1.
 */
export function computeRougeL(
  prediction: string,
  reference: string,
): TextOverlapResult {
  const predTokens = tokenizeWords(prediction);
  const refTokens = tokenizeWords(reference);

  const m = predTokens.length;
  const n = refTokens.length;

  if (m === 0 || n === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  // Dynamic programming for Longest Common Subsequence length
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (predTokens[i - 1] === refTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const lcsLength = dp[m][n];
  const precision = lcsLength / m;
  const recall = lcsLength / n;
  const f1 =
    precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
  return {
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(f1),
  };
}

/**
 * Evaluates answer correctness against reference answer.
 * If no reference answer is provided, returns zeroed stats with has_reference: false.
 */
export function evaluateAnswerCorrectness(
  prediction: string,
  reference?: string,
): AnswerCorrectnessResult {
  if (!reference || reference.trim().length === 0) {
    return {
      has_reference: false,
      token_f1: { precision: 0, recall: 0, f1: 0 },
      rouge_l: { precision: 0, recall: 0, f1: 0 },
      exact_match: false,
    };
  }

  const cleanPred = prediction.trim().toLowerCase();
  const cleanRef = reference.trim().toLowerCase();

  return {
    has_reference: true,
    token_f1: computeTokenF1(prediction, reference),
    rouge_l: computeRougeL(prediction, reference),
    exact_match: cleanPred === cleanRef,
  };
}
