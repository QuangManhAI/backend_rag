import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { MiningService } from '../mining/mining.service';
import { LlmService } from '../llm/llm.service';
import {
  GroundedChunkResult,
  RAGSearchRequest,
  RAGSynthesisResponse,
} from '../types/scientific-rag';

const STRICT_ACADEMIC_GROUNDING_PROMPT = `You are a strictly grounded scientific research assistant specializing in AI and Machine Learning.
Your mission is to provide rigorous, truthful, and accurate technical answers based EXCLUSIVELY on the retrieved scientific literature excerpts below.

CRITICAL OPERATIONAL RULES:
1. STRICT FACTUAL GROUNDING: Rely SOLELY on facts explicitly stated in the provided excerpts. Never extrapolate or utilize parametric memory for experimental numbers, hyperparameters, or author claims.
2. MISSING INFORMATION PROTOCOL: If the provided excerpts do not contain the answer, state: "The provided literature does not contain sufficient details regarding [aspect]."
3. MANDATORY CITATIONS: Cite each technique using \`[Paper: {paper_id}]\` matching the exact Paper ID in the excerpt header (e.g. [Paper: 2301.02419] or [Paper: openreview_TTMyoOdB9hZ]). Never cite internal bibliography numbers like [98] or [101] from inside the excerpt text.
4. PRESERVE LATEX: Keep mathematical formulas intact using $...$ or $$...$$.
5. DIRECT & CONCISE: Answer directly without conversational pleasantries.`;

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly miningService: MiningService,
    private readonly llmService: LlmService,
  ) {}

  /**
   * Execute the end-to-end RAG pipeline from retrieval to grounded answer synthesis.
   */
  async executeRagPipeline(request: RAGSearchRequest): Promise<RAGSynthesisResponse> {
    const startTime = Date.now();
    const { query, top_k = 5, category, use_authority_boost = true, expand_query = false } = request;

    this.logger.log(`Executing RAG pipeline for query: "${query}" (topK: ${top_k}, category: ${category || 'any'})`);

    // 1. Query Expansion (if enabled)
    let searchInput = query;
    if (expand_query) {
      const expandedTerms = this.miningService.expandQueryTerms(query);
      if (expandedTerms.length > 0) {
        searchInput = `${query} ${expandedTerms.join(' ')}`;
        this.logger.log(`Query expanded to: "${searchInput}"`);
      }
    }

    // 2. Generate 768-D Query Vector Embedding
    const queryVector = await this.embeddingService.generateEmbedding(searchInput);

    // 3. Dense Vector ANN Search in LanceDB
    const candidateChunks = await this.vectorStoreService.search(queryVector, top_k, category);

    // 4. Hybrid Reranking with PageRank Authority Boost
    const rerankedChunks = this.miningService.rerankChunks(candidateChunks, use_authority_boost);
    const topChunks: GroundedChunkResult[] = rerankedChunks.slice(0, top_k);

    // 5. Build Academic Grounding Context & Prompt
    const contextBlocks = topChunks
      .map(
        (c) =>
          `--- [Paper ID: ${c.paper_id} | Title: "${c.title}" | Section: ${c.section_title}] ---\n${c.text.trim()}`,
      )
      .join('\n\n');

    const userPrompt = `Retrieved Scientific Context:\n${contextBlocks}\n\nUser Question: ${query}`;

    // 6. Local LLM Synthesis via node-llama-cpp
    const answer = await this.llmService.generateGroundedAnswer(
      STRICT_ACADEMIC_GROUNDING_PROMPT,
      userPrompt,
    );

    // 7. Extract Unique Citations ([Paper: {paper_id}])
    const citations = this.extractCitations(answer, topChunks);

    const latency_ms = Date.now() - startTime;
    this.logger.log(`RAG pipeline completed in ${latency_ms}ms with ${citations.length} citations.`);

    return {
      query,
      answer,
      citations,
      grounded_chunks: topChunks,
      latency_ms,
    };
  }

  /**
   * Extract citations supporting [Paper: {id}], [Paper ID: {id}], arXiv IDs, and candidate chunk IDs.
   * Filters out pure integer bibliography numbers (e.g. [98], [101]).
   */
  public extractCitations(text: string, candidateChunks?: GroundedChunkResult[]): string[] {
    const unique = new Set<string>();
    const knownIds = new Set(candidateChunks?.map((c) => c.paper_id.trim()) || []);

    // 1. Explicit tags: [Paper: {id}], [Paper ID: {id}], [arXiv: {id}]
    const explicitRegex = /`?\[(?:Paper(?:\s*ID)?|arXiv)\s*:\s*([^\]]+)\]`?/gi;
    for (const match of text.matchAll(explicitRegex)) {
      if (match[1]) {
        const id = match[1].trim();
        if (id && !/^\d{1,4}$/.test(id) && !/^(?:citation|http|figure|table)/i.test(id)) {
          unique.add(id);
        }
      }
    }

    // 2. Direct IDs: [2301.02419], [openreview_*], [cvf_*], or known chunk IDs
    const directRegex = /`?\[([a-zA-Z0-9._\/-]+)\]`?/gi;
    for (const match of text.matchAll(directRegex)) {
      if (match[1]) {
        const id = match[1].trim();
        // Ignore bare bibliography numbers like [98], [101], [1]
        if (/^\d{1,4}$/.test(id)) continue;

        if (
          /^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(id) ||
          /^openreview_/i.test(id) ||
          /^cvf_/i.test(id) ||
          knownIds.has(id)
        ) {
          unique.add(id);
        }
      }
    }

    return Array.from(unique);
  }
}
