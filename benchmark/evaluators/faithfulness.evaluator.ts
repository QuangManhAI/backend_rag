import { tokenizeWords } from './answer-correctness.evaluator';

export interface ClaimEvaluation {
  claim: string;
  is_supported: boolean;
  overlap_ratio: number;
}

export interface FaithfulnessResult {
  total_claims: number;
  supported_claims: number;
  unsupported_claims: number;
  faithfulness_score: number;
  claim_details: ClaimEvaluation[];
}

const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'to', 'of',
  'for', 'with', 'as', 'by', 'that', 'this', 'it', 'from', 'be', 'are',
  'was', 'were', 'or', 'can', 'has', 'have', 'had', 'we', 'our', 'you',
]);

/**
 * Strips citation markers such as `[Paper: 2106.09685]` from text.
 */
export function stripCitations(text: string): string {
  return text.replace(/\[Paper(?:\s+ID)?:\s*[^\]]*\]/gi, '').trim();
}

/**
 * Splits answer into verifiable claims (sentences).
 */
export function extractClaims(answer: string): string[] {
  const clean = stripCitations(answer);
  return clean
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15 && /[a-zA-Z0-9]/.test(s));
}

/**
 * Checks if a claim's key terms and bi-grams are grounded in the retrieved context.
 */
export function isClaimGrounded(
  claim: string,
  contextTokensSet: Set<string>,
): { isGrounded: boolean; overlap_ratio: number } {
  const words = tokenizeWords(claim).filter((w) => !STOPWORDS.has(w));
  if (words.length === 0) {
    return { isGrounded: true, overlap_ratio: 1.0 };
  }

  let groundedWords = 0;
  for (const w of words) {
    if (contextTokensSet.has(w)) {
      groundedWords++;
    }
  }

  const ratio = groundedWords / words.length;
  // A claim is considered grounded if at least 60% of its content words are in context
  const isGrounded = ratio >= 0.6;

  return {
    isGrounded,
    overlap_ratio: Math.round(ratio * 100) / 100,
  };
}

/**
 * Evaluates faithfulness of generated answer against the actual retrieved context chunks.
 */
export function evaluateFaithfulness(
  answer: string,
  contextChunks: Array<{ text: string }>,
): FaithfulnessResult {
  const claims = extractClaims(answer);
  if (claims.length === 0) {
    return {
      total_claims: 0,
      supported_claims: 0,
      unsupported_claims: 0,
      faithfulness_score: 1.0,
      claim_details: [],
    };
  }

  // Build unified token set from all context chunks
  const contextTokensSet = new Set<string>();
  for (const chunk of contextChunks) {
    const tokens = tokenizeWords(chunk.text);
    for (const t of tokens) {
      contextTokensSet.add(t);
    }
  }

  let supported = 0;
  const details: ClaimEvaluation[] = [];

  for (const claim of claims) {
    const { isGrounded, overlap_ratio } = isClaimGrounded(
      claim,
      contextTokensSet,
    );
    if (isGrounded) supported++;
    details.push({
      claim,
      is_supported: isGrounded,
      overlap_ratio,
    });
  }

  const total = claims.length;
  const score = total > 0 ? Math.round((supported / total) * 1e4) / 1e4 : 1.0;

  return {
    total_claims: total,
    supported_claims: supported,
    unsupported_claims: total - supported,
    faithfulness_score: score,
    claim_details: details,
  };
}
