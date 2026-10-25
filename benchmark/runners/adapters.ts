import { RetrievalAdapter } from './retrieval.runner';
import type { EmbeddingPort } from '../../src/embedding/embedding.service';
import type { VectorStorePort } from '../../src/vector-store/vector-store.service';
import { MiningService } from '../../src/mining/mining.service';
import { TreeRouterService } from '../../src/tree-router/tree-router.service';
import { ScoredChunk, GroundedChunk } from '../../src/types/scientific-rag';

const since = (t: number) => Math.round(performance.now() - t);

/**
 * DirectServiceRetrievalAdapter:
 * Executes retrieval directly through the TypeScript service ports without running the HTTP server
 * or invoking the LLM generation phase.
 */
export class DirectServiceRetrievalAdapter implements RetrievalAdapter {
  constructor(
    private readonly embedding: EmbeddingPort,
    private readonly vectors: VectorStorePort,
    private readonly mining: MiningService,
    private readonly router: TreeRouterService,
  ) {}

  async execute(
    query: string,
    options: {
      top_k: number;
      category?: string;
      nprobe: number;
      use_authority_boost: boolean;
      expand_query: boolean;
    },
  ): Promise<{
    pre_rerank_chunks: ScoredChunk[];
    post_rerank_chunks: GroundedChunk[];
    timings: {
      embed_ms: number;
      route_ms: number;
      search_ms: number;
      rerank_ms: number;
      total_ms: number;
    };
  }> {
    const t0 = performance.now();
    const timings = {
      embed_ms: 0,
      route_ms: 0,
      search_ms: 0,
      rerank_ms: 0,
      total_ms: 0,
    };

    const expanded = options.expand_query
      ? this.mining.expandQueryTerms(query)
      : [];

    let t = performance.now();
    const qVec = await this.embedding.embedQuery(
      expanded.length ? `${query} ${expanded.join(' ')}` : query,
    );
    timings.embed_ms = since(t);

    const { steps, route_ms } = this.router.route(qVec, options.nprobe);
    timings.route_ms = route_ms;

    t = performance.now();
    const twigIds = steps.find((s) => s.depth === 2)?.chosen;
    const hits = await this.vectors.search(qVec, {
      limit: Math.max(40, options.top_k * 8),
      category: options.category,
      twigIds: twigIds?.length ? twigIds : undefined,
    });
    timings.search_ms = since(t);

    t = performance.now();
    const grounded = this.mining
      .rerank(hits, options.use_authority_boost)
      .slice(0, options.top_k);
    timings.rerank_ms = since(t);

    timings.total_ms = since(t0);

    return {
      pre_rerank_chunks: hits,
      post_rerank_chunks: grounded,
      timings,
    };
  }
}

/**
 * MockRetrievalAdapter:
 * Used for fast, zero-dependency unit and integration testing.
 * Uses deterministic fake embedding and in-memory points.
 */
export class MockRetrievalAdapter implements RetrievalAdapter {
  constructor(
    private readonly customHitsProvider?: (
      query: string,
    ) => ScoredChunk[] | Promise<ScoredChunk[]>,
  ) {}

  async execute(
    query: string,
    options: {
      top_k: number;
      category?: string;
      nprobe: number;
      use_authority_boost: boolean;
      expand_query: boolean;
    },
  ): Promise<{
    pre_rerank_chunks: ScoredChunk[];
    post_rerank_chunks: GroundedChunk[];
    timings: {
      embed_ms: number;
      route_ms: number;
      search_ms: number;
      rerank_ms: number;
      total_ms: number;
    };
  }> {
    const t0 = performance.now();

    let hits: ScoredChunk[] = [];
    if (this.customHitsProvider) {
      hits = await this.customHitsProvider(query);
    } else {
      const makeMockChunk = (
        partial: Partial<ScoredChunk> & {
          chunk_id: string;
          paper_id: string;
          score: number;
        },
      ): ScoredChunk => ({
        title: 'Scientific Paper Title',
        authors: ['Author 0'],
        primary_category: 'cs.LG',
        year: 2023,
        section_title: 'Abstract',
        section_type: 'abstract',
        text: 'Abstract text excerpt.',
        ...partial,
      });

      if (/lora|low-rank/i.test(query)) {
        hits.push(
          makeMockChunk({
            chunk_id: '2106.09685_abs',
            paper_id: '2106.09685',
            title: 'LoRA: Low-Rank Adaptation of Large Language Models',
            section_title: 'Abstract',
            authors: ['Edward Hu', 'Author 0'],
            score: 0.88,
            text: 'We freeze pre-trained model weights and inject trainable rank decomposition matrices.',
          }),
          makeMockChunk({
            chunk_id: '2106.09685_sec4',
            paper_id: '2106.09685',
            title: 'LoRA: Low-Rank Adaptation of Large Language Models',
            section_title: 'Method',
            authors: ['Edward Hu', 'Author 0'],
            score: 0.82,
            text: 'Low-rank parameterization.',
          }),
        );
      }
      if (/attention|transformer/i.test(query)) {
        hits.push(
          makeMockChunk({
            chunk_id: '1706.03762_abs',
            paper_id: '1706.03762',
            title: 'Attention Is All You Need',
            section_title: 'Abstract',
            authors: ['Vaswani', 'Author 0'],
            score: 0.91,
            text: 'We propose the Transformer, based solely on attention mechanisms.',
          }),
        );
      }
      if (/residual|resnet/i.test(query)) {
        hits.push(
          makeMockChunk({
            chunk_id: '1512.03385_abs',
            paper_id: '1512.03385',
            title: 'Deep Residual Learning for Image Recognition',
            section_title: 'Abstract',
            authors: ['Kaiming He'],
            score: 0.89,
            text: 'Deep residual learning framework.',
          }),
        );
      }
      if (/bert/i.test(query)) {
        hits.push(
          makeMockChunk({
            chunk_id: '1810.04805_abs',
            paper_id: '1810.04805',
            title: 'BERT: Pre-training of Deep Bidirectional Transformers',
            section_title: 'Abstract',
            authors: ['Devlin'],
            score: 0.87,
            text: 'Bidirectional Encoder Representations from Transformers.',
          }),
        );
      }
      if (/gpt-3|few-shot/i.test(query)) {
        hits.push(
          makeMockChunk({
            chunk_id: '2005.14165_abs',
            paper_id: '2005.14165',
            title: 'Language Models are Few-Shot Learners',
            section_title: 'Abstract',
            authors: ['Brown'],
            score: 0.85,
            text: 'Few-shot task performance without fine-tuning.',
          }),
        );
      }
      if (/adam/i.test(query)) {
        hits.push(
          makeMockChunk({
            chunk_id: '1412.6980_abs',
            paper_id: '1412.6980',
            title: 'Adam: A Method for Stochastic Optimization',
            section_title: 'Abstract',
            authors: ['Kingma'],
            score: 0.86,
            text: 'Stochastic optimization with adaptive estimates of lower-order moments.',
          }),
        );
      }
      hits.push(
        makeMockChunk({
          chunk_id: 'distractor_1',
          paper_id: 'distractor_paper_1',
          title: 'Background literature',
          section_title: 'Intro',
          authors: ['Smith'],
          score: 0.45,
          text: 'General survey on artificial intelligence.',
        }),
        makeMockChunk({
          chunk_id: 'distractor_2',
          paper_id: 'distractor_paper_2',
          title: 'Secondary study',
          section_title: 'Discussion',
          authors: ['Johnson'],
          score: 0.35,
          text: 'Secondary experimental results.',
        }),
      );
    }

    // Sort by score desc
    hits.sort((a, b) => b.score - a.score);

    // Mock rerank: if use_authority_boost, boost papers with authors containing 'Author 0'
    const grounded: GroundedChunk[] = hits
      .slice(0, options.top_k)
      .map((c) => {
        const hasBoost =
          options.use_authority_boost &&
          c.authors.some((a) => a.includes('Author 0'));
        const authority = hasBoost ? 1.0 : 0.0;
        const final = options.use_authority_boost
          ? 0.85 * c.score + 0.15 * authority
          : c.score;
        return {
          chunk_id: c.chunk_id,
          paper_id: c.paper_id,
          title: c.title,
          section_title: c.section_title,
          section_type: 'abstract' as const,
          text: c.text,
          similarity_score: Math.round(c.score * 1e4) / 1e4,
          authority_score: Math.round(authority * 1e4) / 1e4,
          final_score: Math.round(final * 1e4) / 1e4,
          citation_tag: `[Paper: ${c.paper_id}]`,
        };
      })
      .sort((a, b) => b.final_score - a.final_score);

    const total_ms = since(t0);

    return {
      pre_rerank_chunks: hits,
      post_rerank_chunks: grounded,
      timings: {
        embed_ms: 1,
        route_ms: 1,
        search_ms: 2,
        rerank_ms: 1,
        total_ms,
      },
    };
  }
}
