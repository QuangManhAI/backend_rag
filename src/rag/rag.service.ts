import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { logFields } from '../common/request-context';
import {
  EMBEDDING_PORT,
  type EmbeddingPort,
} from '../embedding/embedding.service';
import { LLM_PORT, type LlmPort } from '../llm/llm.service';
import { MiningService, round4 } from '../mining/mining.service';
import {
  SESSION_STORE,
  type SessionStorePort,
} from '../chat-sessions/session-store.port';
import { TreeRouterService } from '../tree-router/tree-router.service';
import type { AuthUser } from '../types/auth-user';
import type {
  CompareCandidate,
  GroundedChunk,
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
  NO_CONTEXT_ANSWER,
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
    const grounded = this.mining
      .rerank(hits, req.use_authority_boost)
      .slice(0, req.top_k);
    timings.rerank_ms = since(t);
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
      session_id: saved?.session_id ?? null,
      message_id: saved?.assistant_message_id ?? null,
    } satisfies PipelineResult);

    yield {
      type: 'done',
      citations,
      timings,
      session_id: saved?.session_id ?? null,
      message_id: saved?.assistant_message_id ?? null,
    };
  }
}
