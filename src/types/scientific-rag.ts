/**
 * Types shared by the RAG pipeline and the API (snake_case, matching API_DESIGN.md §3, §5 and the
 * frontend `src/types/rag.ts` / `world.ts`).
 */

export type SectionType =
  | 'abstract'
  | 'introduction'
  | 'method'
  | 'experiment'
  | 'discussion'
  | 'other';

/** Chunk as stored in Qdrant `scientific_papers_gold` (written by the UTH pipeline). */
export interface ChunkPayload {
  chunk_id: string;
  paper_id: string;
  title: string;
  authors: string[];
  primary_category: string;
  year: number | null;
  section_title: string;
  /** Raw pipeline value (e.g. "abstract", "body", "abstract_problem"). */
  section_type: string;
  text: string;
  twig_id?: number;
  chunk_index?: number;
}

export interface ScoredChunk extends ChunkPayload {
  /** Cosine similarity returned by Qdrant. */
  score: number;
}

/** A chunk retrieved as context for the answer. */
export interface GroundedChunk {
  chunk_id: string;
  paper_id: string;
  title: string;
  section_title: string;
  section_type: SectionType;
  text: string;
  similarity_score: number;
  authority_score: number;
  final_score: number;
  /** Laya's P(the chunk directly answers the question); absent when the judge did not run. */
  relevance_score?: number;
  citation_tag: string;
}

export interface Timings {
  embed_ms: number;
  route_ms: number;
  search_ms: number;
  rerank_ms: number;
  llm_ms: number;
  /** Rewriting the query and searching again after the evidence gate said no. */
  refine_ms?: number;
  /** The groundedness check after the LLM. */
  grounded_ms?: number;
  total_ms: number;
}

/** What the gates around the LLM decided; absent when the judge did not run. */
export interface Quality {
  /** Best relevance among the chunks used, 0–1. */
  evidence_score: number | null;
  /** The search query after the rewrite, when one was needed. */
  refined_query: string | null;
  /** Best support for the answer, 0–1; null when the check did not run. */
  grounded_score: number | null;
  abstained: boolean;
}

export interface RouteCandidate {
  node_id: number;
  score: number;
}

export interface RouteStep {
  depth: 1 | 2;
  candidates: RouteCandidate[];
  chosen: number[];
}

export interface CompareCandidate {
  paper_id: string;
  score: number;
}

export type RagPhase =
  'embedding' | 'flying' | 'comparing' | 'found' | 'generating';

/** One SSE event of `POST /rag/chat/stream` (API_DESIGN §3.1). */
export type RagStreamEvent =
  | { type: 'phase'; phase: RagPhase }
  | { type: 'route'; steps: RouteStep[] }
  | { type: 'compare'; candidates: CompareCandidate[] }
  | {
      type: 'retrieval';
      grounded_chunks: GroundedChunk[];
      expanded_terms: string[];
    }
  | { type: 'token'; text: string }
  /** The groundedness check rejected what was streamed: `answer` replaces it. */
  | { type: 'answer_replaced'; answer: string }
  | {
      type: 'done';
      citations: string[];
      timings: Timings;
      quality?: Quality;
      session_id: string | null;
      message_id: string | null;
      /** Added by the controller on the stream (API_DESIGN §1.6). */
      _links?: Record<string, { href: string; method?: string }>;
    }
  | { type: 'error'; message: string; status: number };

export interface Chunk {
  chunk_id: string;
  section_title: string;
  section_type: SectionType;
  text: string;
}

/** `GET /papers/:paper_id` (API_DESIGN §5). */
export interface PaperDetail {
  paper_id: string;
  title: string;
  authors: string[];
  category_index: number;
  primary_category: string;
  year: number | null;
  abstract: string;
  has_fulltext: boolean;
  chunks: Chunk[];
}

const SECTION_TYPES: readonly SectionType[] = [
  'abstract',
  'introduction',
  'method',
  'experiment',
  'discussion',
  'other',
];

/** Maps a raw pipeline section type onto the six kinds the frontend colours. */
export function toSectionType(raw: string): SectionType {
  const s = raw.toLowerCase();
  if ((SECTION_TYPES as readonly string[]).includes(s)) return s as SectionType;
  if (s.startsWith('abstract')) return 'abstract';
  if (s.startsWith('intro')) return 'introduction';
  if (
    s.startsWith('method') ||
    s.includes('approach') ||
    s.includes('architecture')
  )
    return 'method';
  if (
    s.startsWith('experiment') ||
    s.startsWith('result') ||
    s.includes('evaluation')
  )
    return 'experiment';
  if (s.startsWith('discussion') || s.startsWith('conclusion'))
    return 'discussion';
  return 'other';
}
