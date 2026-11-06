import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { logFields } from '../../common/logging/request-context';
import {
  EMBEDDING_PORT,
  type EmbeddingPort,
} from '../../engines/embedding/embedding.service';
import { JUDGE_PORT, type JudgePort } from '../../engines/judge/judge.service';
import { LLM_PORT, type LlmPort } from '../../engines/llm/llm.service';
import { MiningService, round4 } from '../../engines/mining/mining.service';
import {
  SESSION_STORE,
  type SessionStorePort,
} from '../chat-sessions/session-store.port';
import { AppConfigService } from '../../config/app-config.service';
import { TreeRouterService } from '../../engines/tree-router/tree-router.service';
import type { AuthUser } from '../../types/auth-user';
import type {
  GroundedChunk,
  Quality,
  RouteStep,
  ScoredChunk,
  Timings,
} from '../../types/scientific-rag';
import {
  VECTOR_STORE_PORT,
  type VectorStorePort,
} from '../../engines/vector-store/vector-store.service';
import { extractCitations } from './pipeline/citations';
import type { ChatRequestDto } from './dto/chat-request.dto';
import {
  buildUserPrompt,
  cleanRewrite,
  NO_CONTEXT_ANSWER,
  REWRITE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from './pipeline/prompt-builder';
import {
  fuseRanks,
  GROUNDED_PASSAGES,
  judgedPoolSize,
  topPapers,
} from './pipeline/ranking';
import { requestFingerprint } from './pipeline/request-fingerprint';
import type { PipelineEvent, PipelineResult } from './rag.types';

const since = (t: number) => Math.round(performance.now() - t);

interface RankedContext {
  chunks: GroundedChunk[];
  /** Null = the judge gave no verdict. */
  evidence: number | null;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    @Inject(VECTOR_STORE_PORT) private readonly vectors: VectorStorePort,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(SESSION_STORE) private readonly sessions: SessionStorePort,
    private readonly mining: MiningService,
    private readonly router: TreeRouterService,
    @Optional() @Inject(JUDGE_PORT) private readonly judge?: JudgePort,
    @Optional() private readonly config?: AppConfigService,
  ) {}

  /**
   * The full RAG run as an event stream (API_DESIGN §3.1). `result` is filled in before `done`.
   * Nothing is saved when the run fails or `signal` aborts.
   *
   * With an `idempotencyKey` (authenticated callers only: anonymous runs store nothing) a repeated
   * request replays the stored answer instead of running the LLM and saving a second exchange.
   */
  async *run(
    req: ChatRequestDto,
    user: AuthUser | undefined,
    signal: AbortSignal,
    result: Partial<PipelineResult> = {},
    t0 = performance.now(),
    idempotencyKey?: string,
  ): AsyncGenerator<PipelineEvent> {
    logFields({ query_len: req.query.length, top_k: req.top_k });
    const sessionId = user && req.session_id ? req.session_id : null;
    if (user && sessionId) await this.sessions.assertOwned(sessionId, user.id);

    const key = user ? idempotencyKey : undefined;
    if (!user || !key) {
      yield* this.execute(req, user, sessionId, signal, result, t0);
      return;
    }
    const begun = await this.sessions.beginRequest(
      user.id,
      key,
      requestFingerprint(req),
    );
    if (begun.state === 'completed') {
      yield* this.replay(req, user, begun, result);
      return;
    }
    try {
      yield* this.execute(req, user, sessionId, signal, result, t0, key);
    } finally {
      if (!result.message_id) {
        // Best effort: a key that stays locked is taken over once its lock expires.
        await this.sessions.releaseRequest(user.id, key).catch((e: unknown) => {
          this.logger.warn({ err: e }, 'CHAT_REQUEST_RELEASE_FAILED');
        });
      }
    }
  }

  private async *replay(
    req: ChatRequestDto,
    user: AuthUser,
    stored: { session_id: string; message_id: string },
    result: Partial<PipelineResult>,
  ): AsyncGenerator<PipelineEvent> {
    const m = await this.sessions.getExchange(
      user.id,
      stored.session_id,
      stored.message_id,
    );
    Object.assign(result, {
      answer: m.content,
      citations: m.citations,
      grounded_chunks: m.grounded_chunks,
      expanded_terms: [],
      timings: m.timings,
      session_id: m.session_id,
      message_id: m.message_id,
      replayed: true,
    } satisfies PipelineResult);
    logFields({ query_len: req.query.length, replayed: true });
    yield {
      type: 'retrieval',
      grounded_chunks: m.grounded_chunks,
      expanded_terms: [],
    };
    yield { type: 'phase', phase: 'generating' };
    yield { type: 'token', text: m.content };
    yield {
      type: 'done',
      citations: m.citations,
      timings: m.timings,
      session_id: m.session_id,
      message_id: m.message_id,
    };
  }

  private async *execute(
    req: ChatRequestDto,
    user: AuthUser | undefined,
    sessionId: string | null,
    signal: AbortSignal,
    result: Partial<PipelineResult>,
    t0: number,
    requestKey?: string,
  ): AsyncGenerator<PipelineEvent> {
    const timings: Timings = {
      embed_ms: 0,
      route_ms: 0,
      search_ms: 0,
      rerank_ms: 0,
      llm_ms: 0,
      total_ms: 0,
    };

    yield { type: 'phase', phase: 'embedding' };
    const question = req.query;
    const expanded = req.expand_query
      ? this.mining.expandQueryTerms(question)
      : [];
    let t = performance.now();
    const q = await this.embedding.embedQuery(
      expanded.length ? `${question} ${expanded.join(' ')}` : question,
    );
    timings.embed_ms = since(t);

    yield { type: 'phase', phase: 'flying' };
    const { steps, route_ms } = this.router.route(q, req.nprobe);
    timings.route_ms = route_ms;
    yield { type: 'route', steps };

    yield { type: 'phase', phase: 'comparing' };
    t = performance.now();
    const hits = await this.search(q, steps, req);
    timings.search_ms = since(t);
    yield { type: 'compare', candidates: topPapers(hits, req.top_k) };

    yield { type: 'phase', phase: 'found' };
    t = performance.now();
    const judged = await this.rank(question, hits, req);
    timings.rerank_ms = since(t);
    const gated = await this.applyEvidenceGate(
      judged,
      question,
      req,
      signal,
      timings,
    );
    const { evidence, refinedQuery } = gated;
    const grounded = gated.chunks;
    let abstained = gated.abstained;
    yield {
      type: 'retrieval',
      grounded_chunks: grounded,
      expanded_terms: expanded,
    };

    yield { type: 'phase', phase: 'generating' };
    t = performance.now();
    let answer = yield* this.streamAnswer(grounded, question, signal);
    timings.llm_ms = since(t);

    // Groundedness check: what the LLM wrote must be supported by the evidence it was given.
    let groundedScore: number | null = null;
    if (evidence !== null && grounded.length && !signal.aborted) {
      t = performance.now();
      groundedScore = await this.judge!.groundedness(
        question,
        answer,
        grounded.slice(0, GROUNDED_PASSAGES),
      );
      timings.grounded_ms = since(t);
      if (
        groundedScore !== null &&
        groundedScore < this.threshold('GROUNDED')
      ) {
        abstained = true;
        answer = NO_CONTEXT_ANSWER;
        yield { type: 'answer_replaced', answer };
      }
    }
    const quality: Quality | undefined =
      evidence === null
        ? undefined
        : {
            evidence_score: round4(evidence),
            refined_query: refinedQuery,
            grounded_score:
              groundedScore === null ? null : round4(groundedScore),
            abstained,
          };

    const citations = extractCitations(answer);
    const inContext = new Set(grounded.map((g) => g.paper_id));
    logFields({
      chunks: grounded.length,
      unverified_citations: citations.filter((c) => !inContext.has(c)).length,
    });

    let saved: { session_id: string; assistant_message_id: string } | null =
      null;
    if (user && !signal.aborted) {
      timings.total_ms = since(t0);
      saved = await this.sessions.saveExchange(
        user.id,
        sessionId,
        question,
        {
          content: answer,
          citations,
          grounded_chunks: grounded,
          timings,
        },
        requestKey,
      );
    }
    timings.total_ms = since(t0);
    logFields({ timings });

    Object.assign(result, {
      answer,
      citations,
      grounded_chunks: grounded,
      expanded_terms: expanded,
      timings,
      ...(quality ? { quality } : {}),
      session_id: saved?.session_id ?? null,
      message_id: saved?.assistant_message_id ?? null,
    } satisfies PipelineResult);

    yield {
      type: 'done',
      citations,
      timings,
      ...(quality ? { quality } : {}),
      session_id: saved?.session_id ?? null,
      message_id: saved?.assistant_message_id ?? null,
    };
  }

  /** Not enough evidence ➔ refine the query once ➔ still not enough ➔ abstain. */
  private async applyEvidenceGate(
    judged: RankedContext,
    question: string,
    req: ChatRequestDto,
    signal: AbortSignal,
    timings: Timings,
  ): Promise<
    RankedContext & { refinedQuery: string | null; abstained: boolean }
  > {
    const threshold = this.threshold('EVIDENCE');
    const passed = { ...judged, refinedQuery: null, abstained: false };
    if (judged.evidence === null || judged.evidence >= threshold) return passed;
    const t = performance.now();
    const refined = await this.refine(question, req, signal);
    timings.refine_ms = since(t);
    const better = refined && (refined.evidence ?? 0) > judged.evidence;
    const chunks = better ? refined.chunks : judged.chunks;
    const evidence = better ? refined.evidence : judged.evidence;
    const abstained = (evidence ?? 0) < threshold;
    return {
      chunks: abstained ? [] : chunks,
      evidence,
      refinedQuery: better ? refined.query : null,
      abstained,
    };
  }

  /** The answer tokens as they arrive; yields the fixed answer when there is no context. */
  private async *streamAnswer(
    grounded: GroundedChunk[],
    question: string,
    signal: AbortSignal,
  ): AsyncGenerator<PipelineEvent, string> {
    if (!grounded.length) {
      yield { type: 'token', text: NO_CONTEXT_ANSWER };
      return NO_CONTEXT_ANSWER;
    }
    let answer = '';
    for await (const token of this.llm.generate(
      SYSTEM_PROMPT,
      buildUserPrompt(grounded, question),
      signal,
    )) {
      answer += token;
      yield { type: 'token', text: token };
    }
    return answer;
  }

  private search(vector: number[], steps: RouteStep[], req: ChatRequestDto) {
    const twigIds = steps.find((s) => s.depth === 2)?.chosen;
    return this.vectors.search(vector, {
      limit: Math.max(40, req.top_k * 8),
      category: req.category,
      twigIds: twigIds?.length ? twigIds : undefined,
    });
  }

  /** `mining.rerank`, then the judge over the best candidates. `evidence` null = no verdict. */
  private async rank(
    question: string,
    hits: ScoredChunk[],
    req: ChatRequestDto,
  ): Promise<RankedContext> {
    const ranked = this.mining.rerank(hits, req.use_authority_boost);
    const fallback = {
      chunks: ranked.slice(0, req.top_k),
      evidence: null,
    };
    if (!this.judge?.enabled || !ranked.length) return fallback;
    if (!this.config?.get('LAYA_RERANK')) {
      // Judge only what the LLM will read: the evidence gate is about this exact context.
      const scores = await this.judge.relevance(question, fallback.chunks);
      if (!scores) return fallback;
      return {
        chunks: fallback.chunks.map((c, i) => ({
          ...c,
          relevance_score: round4(scores[i]),
        })),
        evidence: Math.max(...scores),
      };
    }
    const pool = ranked.slice(0, judgedPoolSize(req.top_k));
    const scores = await this.judge.relevance(question, pool);
    if (!scores) return fallback;
    const chunks = fuseRanks(pool, scores).slice(0, req.top_k);
    // The gate is about this exact context, not about the candidates left out of it.
    return {
      chunks,
      evidence: Math.max(...chunks.map((c) => c.relevance_score ?? 0)),
    };
  }

  /** One rewrite through the LLM, then a second search. Null when it could not be tried. */
  private async refine(
    question: string,
    req: ChatRequestDto,
    signal: AbortSignal,
  ): Promise<(RankedContext & { query: string }) | null> {
    let raw = '';
    try {
      for await (const token of this.llm.generate(
        REWRITE_SYSTEM_PROMPT,
        question,
        signal,
      )) {
        raw += token;
      }
    } catch (e) {
      if (signal.aborted) throw e;
      this.logger.warn({ err: e }, 'QUERY_REWRITE_FAILED');
      return null;
    }
    const query = cleanRewrite(raw);
    if (!query || query.toLowerCase() === question.trim().toLowerCase())
      return null;
    const vector = await this.embedding.embedQuery(query);
    const { steps } = this.router.route(vector, req.nprobe);
    const hits = await this.search(vector, steps, req);
    // Judged against the user's question: the rewrite only widens what can be found.
    const { chunks, evidence } = await this.rank(question, hits, req);
    return { query, chunks, evidence };
  }

  private threshold(kind: 'EVIDENCE' | 'GROUNDED'): number {
    return this.config?.get(`LAYA_${kind}_THRESHOLD`) ?? 0.5;
  }
}
