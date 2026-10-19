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
3. MANDATORY CITATIONS: Cite every substantive technical claim using [Paper: {paper_id}] or [1], [2] matching the Source number or Paper ID in the excerpt headers (e.g. [Paper: 2301.02419], [Paper: openalex:W4409626943], or [1]). Do NOT repeat identical citation tags consecutively in the same sentence. Never cite internal bibliography numbers like [98] or [101] from inside the excerpt text.
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

    // 5. Build Academic Grounding Context & Prompt with Source Indices and IDs
    const contextBlocks = topChunks
      .map(
        (c, idx) =>
          `--- [Source ${idx + 1} | Paper ID: ${c.paper_id} | Title: "${c.title}" | Section: ${c.section_title}] ---\n${c.text.trim()}`,
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
   * Universal citation extractor supporting:
   * - Square brackets: [Paper ID: {id}], [Paper: {id}], [openalex:{id}], [arXiv:{id}], [{arxiv_decimal}], [{index}]
   * - Parentheses: (Paper ID: {id}), (Paper: {id}), (openalex:{id}), (arXiv:{id}), ({arxiv_decimal})
   * - Numeric indices: [1], [2], Source 1 mapped to candidateChunks[index - 1].paper_id
   * - Deduplicates comma-separated lists like (Paper ID: A, Paper ID: A)
   */
  public extractCitations(text: string, candidateChunks?: GroundedChunkResult[]): string[] {
    const unique = new Set<string>();
    const chunks = candidateChunks || [];
    const knownIds = new Set(chunks.map((c) => c.paper_id.trim().toLowerCase()));

    // Map 1-based index to paper_id
    const indexMap = new Map<number, string>();
    chunks.forEach((c, i) => {
      indexMap.set(i + 1, c.paper_id.trim());
    });

    // Match both [...] and (...) containing citations
    const universalRegex = /`?([\[\(])\s*(?:(?:Paper(?:\s*ID)?|arXiv|Source)\s*:?\s*)?([^\]\)\n]+)\s*([\]\)])`?/gi;
    for (const match of text.matchAll(universalRegex)) {
      const openChar = match[1];
      const rawContent = match[2]?.trim();
      const closeChar = match[3];

      // Ensure matching delimiter pair ([ with ] or ( with ))
      if ((openChar === '[' && closeChar !== ']') || (openChar === '(' && closeChar !== ')')) {
        continue;
      }
      if (!rawContent) continue;

      // Split comma/semicolon/and separated values: e.g. "Paper ID: 2111.07624, Paper ID: 2111.07624"
      const items = rawContent
        .split(/[,;&]|\band\b/gi)
        .map((s) => s.replace(/^(?:Paper(?:\s*ID)?|arXiv|Source)\s*:?/gi, '').trim())
        .filter((s) => s.length > 0 && !/^(?:citation|http|figure|table)/i.test(s));

      for (const item of items) {
        // 1. Check if it's a valid 1-based source index (e.g. 1..chunks.length)
        const num = parseInt(item, 10);
        if (!isNaN(num) && String(num) === item) {
          if (indexMap.has(num)) {
            unique.add(indexMap.get(num)!);
          }
          continue; // ignore bare numbers not in indexMap (e.g. 98, 101)
        }

        // 2. OpenAlex identifier: openalex:W...
        if (/^openalex:W\d+$/i.test(item)) {
          unique.add(item);
          continue;
        }

        // 3. arXiv decimal identifier: \d{4}\.\d{4,5}(v\d+)?
        if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(item)) {
          unique.add(item);
          continue;
        }

        // 4. OpenReview or CVF or known chunk IDs
        if (/^openreview_/i.test(item) || /^cvf_/i.test(item) || knownIds.has(item.toLowerCase())) {
          const orig = chunks.find((c) => c.paper_id.trim().toLowerCase() === item.toLowerCase());
          unique.add(orig ? orig.paper_id.trim() : item);
          continue;
        }

        // 5. If it contains a known chunk paper_id as a substring
        for (const chunk of chunks) {
          const cId = chunk.paper_id.trim();
          if (item.toLowerCase().includes(cId.toLowerCase())) {
            unique.add(cId);
            break;
          }
        }
      }
    }

    return Array.from(unique);
  }
}
