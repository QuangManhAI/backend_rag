import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { logFields } from '../common/request-context';
import {
  EMBEDDING_PORT,
  type EmbeddingPort,
} from '../embedding/embedding.service';
import { JUDGE_PORT, type JudgePort } from '../judge/judge.service';
import { LLM_PORT, type LlmPort } from '../llm/llm.service';
import { MiningService, round4 } from '../mining/mining.service';
import {
  SESSION_STORE,
  type SessionStorePort,
} from '../chat-sessions/session-store.port';
import { AppConfigService } from '../config/app-config.service';
import { TreeRouterService } from '../tree-router/tree-router.service';
import type { AuthUser } from '../types/auth-user';
import type {
  CompareCandidate,
  GroundedChunk,
  Quality,
  RagStreamEvent,
  ScoredChunk,
  Timings,
} from '../types/scientific-rag';
import {
  VECTOR_STORE_PORT,
  type VectorStorePort,
} from '../vector-store/vector-store.service';
import { extractCitations } from './citations';
import type { ChatRequestDto } from './dto/chat-request.dto';
import {
  buildUserPrompt,
  cleanRewrite,
  NO_CONTEXT_ANSWER,
  REWRITE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
} from './prompt-builder';

/** Events the pipeline yields (errors are thrown, the controller turns them into `error`). */
export type PipelineEvent = Exclude<RagStreamEvent, { type: 'error' }>;

/** Summary of a finished run, for the non-streaming response and the request log. */
export interface PipelineResult {
  answer: string;
  citations: string[];
  grounded_chunks: GroundedChunk[];
  expanded_terms: string[];
  timings: Timings;
  quality?: Quality;
  session_id: string | null;
  message_id: string | null;
  /** The answer comes from an earlier run with the same `Idempotency-Key`. */
  replayed?: boolean;
}

/** Best score per paper, highest first, at most `limit` papers. */
export function topPapers(
  hits: ScoredChunk[],
  limit: number,
): CompareCandidate[] {
  const best = new Map<string, number>();
  for (const h of hits) {
    if (h.score > (best.get(h.paper_id) ?? -Infinity))
      best.set(h.paper_id, h.score);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([paper_id, score]) => ({ paper_id, score: round4(score) }));
}

/** Identifies the request body behind an `Idempotency-Key`. */
export function requestFingerprint(req: ChatRequestDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        req.query,
        req.session_id ?? null,
        req.top_k,
        req.nprobe,
        req.category ?? null,
        req.use_authority_boost,
        req.expand_query,
      ]),
    )
    .digest('hex');
}

const since = (t: number) => Math.round(performance.now() - t);

/** Candidates the judge reads: enough to reorder, few enough to keep the wait in seconds. */
export const judgedPoolSize = (topK: number) =>
  Math.min(20, Math.max(10, topK * 2));
/** Evidence passages for the groundedness check. */
export const GROUNDED_PASSAGES = 3;
/** The usual constant of reciprocal rank fusion. */
export const RRF_K = 60;

/**
 * Fuses the existing order with Laya's order (reciprocal rank fusion): on our evaluation either
 * order alone ranked worse than the two together (`benchmark/eval-laya-variants.mjs`). `pool` is
 * best first and `scores` follow it by index. `final_score` is the fused score scaled to 0–1.
 */
export function fuseRanks(
  pool: GroundedChunk[],
  scores: number[],
): GroundedChunk[] {
  const byRelevance = pool
    .map((_, i) => i)
    .sort((a, b) => scores[b] - scores[a] || a - b);
  const relevanceRank = new Map(
    byRelevance.map((poolIndex, rank) => [poolIndex, rank]),
  );
  const best = 2 / (RRF_K + 1);
  return pool
    .map((c, i) => ({
      c,
      i,
      fused:
        1 / (RRF_K + i + 1) + 1 / (RRF_K + (relevanceRank.get(i) ?? i) + 1),
    }))
    .sort((a, b) => b.fused - a.fused || a.i - b.i)
    .map(({ c, i, fused }) => ({
      ...c,
      relevance_score: round4(scores[i]),
      final_score: round4(fused / best),
    }));
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
    const twigIds = steps.find((s) => s.depth === 2)?.chosen;
    const hits = await this.vectors.search(q, {
      limit: Math.max(40, req.top_k * 8),
      category: req.category,
      twigIds: twigIds?.length ? twigIds : undefined,
    });
    timings.search_ms = since(t);
    yield { type: 'compare', candidates: topPapers(hits, req.top_k) };

    yield { type: 'phase', phase: 'found' };
    t = performance.now();
    const judged = await this.rank(question, hits, req);
    timings.rerank_ms = since(t);
    let grounded = judged.chunks;
    let evidence = judged.evidence;
    let refinedQuery: string | null = null;
    let abstained = false;

    // Evidence gate: not enough ➔ refine the query once ➔ still not enough ➔ abstain.
    if (evidence !== null && evidence < this.threshold('EVIDENCE')) {
      t = performance.now();
      const refined = await this.refine(question, req, signal);
      timings.refine_ms = since(t);
      if (refined && (refined.evidence ?? 0) > evidence) {
        grounded = refined.chunks;
        evidence = refined.evidence;
        refinedQuery = refined.query;
      }
      if ((evidence ?? 0) < this.threshold('EVIDENCE')) {
        abstained = true;
        grounded = [];
      }
    }
    yield {
      type: 'retrieval',
      grounded_chunks: grounded,
      expanded_terms: expanded,
    };

    yield { type: 'phase', phase: 'generating' };
    t = performance.now();
    let answer = '';
    if (!grounded.length) {
      answer = NO_CONTEXT_ANSWER;
      yield { type: 'token', text: answer };
    } else {
      for await (const token of this.llm.generate(
        SYSTEM_PROMPT,
        buildUserPrompt(grounded, question),
        signal,
      )) {
        answer += token;
        yield { type: 'token', text: token };
      }
    }
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

  /** `mining.rerank`, then the judge over the best candidates. `evidence` null = no verdict. */
  private async rank(
    question: string,
    hits: ScoredChunk[],
    req: ChatRequestDto,
  ): Promise<{ chunks: GroundedChunk[]; evidence: number | null }> {
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
  ): Promise<{
    query: string;
    chunks: GroundedChunk[];
    evidence: number | null;
  } | null> {
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
    const twigIds = steps.find((s) => s.depth === 2)?.chosen;
    const hits = await this.vectors.search(vector, {
      limit: Math.max(40, req.top_k * 8),
      category: req.category,
      twigIds: twigIds?.length ? twigIds : undefined,
    });
    // Judged against the user's question: the rewrite only widens what can be found.
    const { chunks, evidence } = await this.rank(question, hits, req);
    return { query, chunks, evidence };
  }

  private threshold(kind: 'EVIDENCE' | 'GROUNDED'): number {
    return this.config?.get(`LAYA_${kind}_THRESHOLD`) ?? 0.5;
  }
}
