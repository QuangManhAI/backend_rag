/**
 * Standard Types & Interfaces for UTH Scientific Literature RAG System
 * Conforms to docs/RAG.md and docs/prompt.md (Feature F1)
 */

export type SectionType =
  | 'abstract'
  | 'introduction'
  | 'method'
  | 'experiment'
  | 'discussion'
  | 'other';

/**
 * 1. ScientificChunk: Represents a single record row in LanceDB table `scientific_papers_gold`.
 */
export interface ScientificChunk {
  chunk_id: string;
  paper_id: string;
  title: string;
  authors: string[];
  primary_category: string;
  section_title: string;
  section_type: SectionType | string;
  text: string;
  context_text: string;
  word_count: number;
  vector?: number[];
  _distance?: number;
}

/**
 * 2. PaperSection: Structure of a parsed section within full-text paper metadata.
 */
export interface PaperSection {
  section_id: string;
  section_title: string;
  section_type: SectionType | string;
  content: string;
  paragraphs: string[];
}

/**
 * 3. ScientificPaperSilver: Full paper metadata from Silver parquet lakehouse tier.
 */
export interface ScientificPaperSilver {
  paper_id: string;
  abstract_hash: string;
  doi: string | null;
  journal_ref: string | null;
  title: string;
  abstract: string;
  authors: string[];
  categories: string[];
  primary_category: string;
  published_date: string;
  crawled_at: string;
  pdf_url: string;
  html_url: string;
  total_sections: number;
  total_math_count: number;
  total_words: number;
  sections_json: string | PaperSection[];
  clean_full_text: string;
  transformed_at: string;
  cite_count: number;
  year: number;
}

/**
 * 4. GraphInfluencer: Influencer node structure from graph_coauthorship.json PageRank.
 */
export interface GraphInfluencer {
  author: string;
  pagerank: number;
  degree?: number;
}

/**
 * 5. AssociationRule: FP-Growth frequent itemset rule structure from association_rules.json.
 */
export interface AssociationRule {
  antecedents: string[];
  consequents: string[];
  support: number;
  confidence: number;
  lift: number;
}

/**
 * 6. RAGSearchRequest: Search query input parameters for retrieval & generation.
 */
export interface RAGSearchRequest {
  query: string;
  top_k?: number;
  category?: string;
  use_authority_boost?: boolean;
  expand_query?: boolean;
}

/**
 * 7. GroundedChunkResult: Candidate chunk scored by vector similarity and graph authority boost.
 */
export interface GroundedChunkResult {
  chunk_id: string;
  paper_id: string;
  title: string;
  authors: string[];
  section_title: string;
  text: string;
  similarity_score: number;
  authority_score?: number;
  final_score: number;
  citation_tag: `[Paper: ${string}]` | string;
}

/**
 * 8. RAGSynthesisResponse: Complete response returned by RAG pipeline.
 */
export interface RAGSynthesisResponse {
  query: string;
  answer: string;
  citations: string[];
  grounded_chunks: GroundedChunkResult[];
  latency_ms: number;
}
