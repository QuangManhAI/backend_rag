import { extractCitations } from '../../src/rag/citations';
import { extractClaims } from './faithfulness.evaluator';
import { tokenizeWords } from './answer-correctness.evaluator';

export interface CitationEvaluationResult {
  total_citations_found: number;
  extracted_citation_ids: string[];

  // Level A: Format Validity
  format_valid: boolean;
  malformed_citations: string[];

  // Level B: ID Validity (Existence in Context)
  in_context_citations: string[];
  hallucinated_citations: string[];
  id_precision: number;

  // Level C: Context Support
  supported_citations: string[];
  unsupported_citations: string[];
  citation_support_ratio: number;

  // Level D: Citation Completeness
  total_claims: number;
  claims_with_citations: number;
  citation_completeness_ratio: number;

  // Reference citation alignment (if ground truth provides reference_citations)
  reference_citation_precision?: number;
  reference_citation_recall?: number;
}

/** Regex to detect potentially malformed or broken citation brackets */
const MALFORMED_BRACKETS_RE = /\[(?:Paper|paper|arXiv|arxiv|ID)?[^\]]*$/gm;

export function evaluateCitations(
  answer: string,
  contextChunks: Array<{ paper_id: string; text: string }>,
  referenceCitations?: string[],
): CitationEvaluationResult {
  const extractedIds = extractCitations(answer);
  const contextPaperIds = new Set(contextChunks.map((c) => c.paper_id));

  // Level A: Check for broken or unclosed brackets
  const malformed: string[] = [];
  const lines = answer.split('\n');
  for (const l of lines) {
    if (/\[Paper\s*$/i.test(l) || /\[\s*Paper\s*[^:\s\]]/i.test(l)) {
      malformed.push(l.trim());
    }
  }

  // Level B: Check ID validity against context
  const inContext: string[] = [];
  const hallucinated: string[] = [];

  for (const id of extractedIds) {
    if (contextPaperIds.has(id)) {
      inContext.push(id);
    } else {
      hallucinated.push(id);
    }
  }

  const idPrecision =
    extractedIds.length > 0 ? inContext.length / extractedIds.length : 1.0;

  // Level C: Check if cited paper text supports the sentence containing the citation
  // Map paper_id -> combined text of its chunks
  const paperTextMap = new Map<string, string>();
  for (const c of contextChunks) {
    const existing = paperTextMap.get(c.paper_id) || '';
    paperTextMap.set(c.paper_id, `${existing} ${c.text}`);
  }

  const supported: string[] = [];
  const unsupported: string[] = [];

  for (const id of inContext) {
    const paperText = paperTextMap.get(id) || '';
    const paperTokens = new Set(tokenizeWords(paperText));

    // Find sentences containing [Paper: id]
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`([^.!?\\n]*\\[Paper(?:\\s+ID)?:\\s*${escapedId}[^\\]]*\\][^.!?\\n]*)`, 'gi');
    const matches = answer.match(regex);

    if (matches && matches.length > 0) {
      let isPaperSupported = false;
      for (const m of matches) {
        const sentenceWords = tokenizeWords(m.replace(/\[Paper[^\]]*\]/gi, ''));
        const matchedWords = sentenceWords.filter((w) => paperTokens.has(w));
        if (sentenceWords.length > 0 && matchedWords.length / sentenceWords.length >= 0.4) {
          isPaperSupported = true;
          break;
        }
      }
      if (isPaperSupported) supported.push(id);
      else unsupported.push(id);
    } else {
      supported.push(id);
    }
  }

  const supportRatio =
    extractedIds.length > 0 ? supported.length / extractedIds.length : 1.0;

  // Level D: Completeness
  const claims = extractClaims(answer);
  let claimsWithCit = 0;
  for (const c of claims) {
    if (/\[Paper(?:\s+ID)?:\s*[^\]]*\]/i.test(c)) {
      claimsWithCit++;
    }
  }
  const completeness =
    claims.length > 0 ? claimsWithCit / claims.length : 1.0;

  // Optional Reference Citation alignment
  let refPrecision: number | undefined;
  let refRecall: number | undefined;

  if (referenceCitations && referenceCitations.length > 0) {
    const refSet = new Set(referenceCitations);
    const hits = extractedIds.filter((id) => refSet.has(id)).length;
    refPrecision = extractedIds.length > 0 ? hits / extractedIds.length : 0;
    refRecall = hits / refSet.size;
  }

  const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

  return {
    total_citations_found: extractedIds.length,
    extracted_citation_ids: extractedIds,
    format_valid: malformed.length === 0,
    malformed_citations: malformed,
    in_context_citations: inContext,
    hallucinated_citations: hallucinated,
    id_precision: round4(idPrecision),
    supported_citations: supported,
    unsupported_citations: unsupported,
    citation_support_ratio: round4(supportRatio),
    total_claims: claims.length,
    claims_with_citations: claimsWithCit,
    citation_completeness_ratio: round4(completeness),
    reference_citation_precision:
      refPrecision !== undefined ? round4(refPrecision) : undefined,
    reference_citation_recall:
      refRecall !== undefined ? round4(refRecall) : undefined,
  };
}
