import type { AppConfigService } from '../config/app-config.service';
import type { JudgePort } from '../judge/judge.service';
import type { MiningService } from '../mining/mining.service';
import type { TreeRouterService } from '../tree-router/tree-router.service';
import type {
  GroundedChunk,
  RagStreamEvent,
  ScoredChunk,
} from '../types/scientific-rag';
import type { ChatRequestDto } from './dto/chat-request.dto';
import { NO_CONTEXT_ANSWER } from './prompt-builder';
import { fuseRanks, RagService, type PipelineResult } from './rag.service';

const chunk = (id: string, authority = 0): GroundedChunk => ({
  chunk_id: id,
  paper_id: id,
  title: `T ${id}`,
  section_title: 'S',
  section_type: 'other',
  text: `text ${id}`,
  similarity_score: 0.5,
  authority_score: authority,
  final_score: 0.5,
  citation_tag: `[Paper: ${id}]`,
});

const req = {
  query: 'q',
  top_k: 2,
  nprobe: 2,
  use_authority_boost: false,
  expand_query: false,
} as ChatRequestDto;

function setup(opts: {
  relevance: Array<number[] | null> | null;
  grounded?: number | null;
  rewrite?: string;
  rerank?: boolean;
  pool?: string[];
  llmThrowsOnRewrite?: boolean;
}) {
  const relevance = jest.fn(() =>
    Promise.resolve(opts.relevance ? (opts.relevance.shift() ?? null) : null),
  );
  const groundedness = jest.fn(() => Promise.resolve(opts.grounded ?? 0.9));
  const judge: JudgePort = { enabled: true, relevance, groundedness };
  const generate = jest.fn((system: string) =>
    (async function* () {
      if (system.includes('search query')) {
        if (opts.llmThrowsOnRewrite) throw new Error('queue full');
        yield opts.rewrite ?? 'better query';
      } else {
        yield 'answer [Paper: a]';
      }
    })(),
  );
  const search = jest.fn(() => Promise.resolve([] as ScoredChunk[]));
  const service = new RagService(
    {
      embedQuery: () => Promise.resolve([1]),
      isReady: () => true,
    },
    {
      search,
      scrollByPaper: () => Promise.resolve([]),
      hasPayloadField: () => Promise.resolve(false),
      ping: () => Promise.resolve(true),
    },
    {
      generate,
      status: () => ({
        ready: true,
        model_id: 'm',
        gpu: 'cpu',
        queue_length: 0,
        running: 0,
      }),
    },
    {} as never,
    {
      expandQueryTerms: () => [],
      rerank: () => (opts.pool ?? ['a', 'b', 'c']).map((id) => chunk(id)),
    } as unknown as MiningService,
    {
      route: () => ({ steps: [], route_ms: 0 }),
    } as unknown as TreeRouterService,
    judge,
    {
      get: (k: string) => (k === 'LAYA_RERANK' ? (opts.rerank ?? true) : 0.5),
    } as unknown as AppConfigService,
  );
  return { service, relevance, groundedness, generate, search };
}

async function run(service: RagService) {
  const result: Partial<PipelineResult> = {};
  const events: RagStreamEvent[] = [];
  for await (const e of service.run(
    req,
    undefined,
    new AbortController().signal,
    result,
  )) {
    events.push(e);
  }
  return { result, events };
}

describe('fuseRanks', () => {
  it('combines both orders by reciprocal rank', () => {
    const pool = ['a', 'b', 'c', 'd'].map((id) => chunk(id));
    const out = fuseRanks(pool, [0.1, 0.8, 0.9, 0.2]);
    // Existing + Laya rank. c: 3 + 1, b: 2 + 2, a: 1 + 4, d: 4 + 3.
    expect(out.map((c) => c.chunk_id)).toEqual(['c', 'b', 'a', 'd']);
    expect(out[0].relevance_score).toBe(0.9);
  });

  it('a chunk first in both orders scores 1; ties keep the existing order', () => {
    const out = fuseRanks([chunk('a'), chunk('b')], [0.5, 0.5]);
    expect(out.map((c) => c.chunk_id)).toEqual(['a', 'b']);
    expect(out[0].final_score).toBe(1);
  });
});

describe('RAG gates', () => {
  it('enough evidence: reranks, answers and reports the scores', async () => {
    const f = setup({ relevance: [[0.2, 0.9, 0.1]] });
    const { result, events } = await run(f.service);
    // a: 1st + 2nd, b: 2nd + 1st (tie, existing order wins), c: 3rd + 3rd.
    expect(result.grounded_chunks?.map((c) => c.chunk_id)).toEqual(['a', 'b']);
    expect(result.answer).toBe('answer [Paper: a]');
    expect(result.quality).toEqual({
      evidence_score: 0.9,
      refined_query: null,
      grounded_score: 0.9,
      abstained: false,
    });
    expect(f.search).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'answer_replaced')).toBe(false);
  });

  it('with LAYA_RERANK off: keeps the order and judges only the context', async () => {
    const f = setup({ relevance: [[0.2, 0.9]], rerank: false });
    const { result } = await run(f.service);
    expect(result.grounded_chunks?.map((c) => c.chunk_id)).toEqual(['a', 'b']);
    expect(result.grounded_chunks?.map((c) => c.relevance_score)).toEqual([
      0.2, 0.9,
    ]);
    expect(f.relevance.mock.calls[0]).toHaveLength(2);
    expect(result.quality?.evidence_score).toBe(0.9);
  });

  it('the gate reads only the chunks that reach the LLM', async () => {
    // The last candidate scores highest but is too far down to reach the top 2.
    const ids = 'abcdefghij'.split('');
    const f = setup({
      pool: ids,
      relevance: [
        [0.4, 0.3, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.95],
        [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      ],
    });
    const { result } = await run(f.service);
    expect(result.quality?.evidence_score).toBe(0.4);
    expect(result.quality?.abstained).toBe(true);
  });

  it('not enough evidence: refines once, then answers from the better context', async () => {
    const f = setup({
      relevance: [
        [0.1, 0.1, 0.1],
        [0.8, 0.1, 0.1],
      ],
    });
    const { result } = await run(f.service);
    expect(f.search).toHaveBeenCalledTimes(2);
    expect(result.quality?.refined_query).toBe('better query');
    expect(result.quality?.abstained).toBe(false);
    expect(result.answer).toBe('answer [Paper: a]');
  });

  it('still not enough after the refine: abstains without the answer LLM', async () => {
    const f = setup({
      relevance: [
        [0.1, 0.1, 0.1],
        [0.2, 0.1, 0.1],
      ],
    });
    const { result } = await run(f.service);
    expect(result.answer).toBe(NO_CONTEXT_ANSWER);
    expect(result.grounded_chunks).toEqual([]);
    expect(result.quality?.abstained).toBe(true);
    expect(f.generate).toHaveBeenCalledTimes(1); // the rewrite only
    expect(f.groundedness).not.toHaveBeenCalled();
  });

  it('a failing rewrite counts as no better context, not as a failed chat', async () => {
    const f = setup({ relevance: [[0.1, 0.1, 0.1]], llmThrowsOnRewrite: true });
    const { result } = await run(f.service);
    expect(result.answer).toBe(NO_CONTEXT_ANSWER);
  });

  it('an ungrounded answer is replaced and no citation survives', async () => {
    const f = setup({ relevance: [[0.9, 0.1, 0.1]], grounded: 0.1 });
    const { result, events } = await run(f.service);
    expect(events).toContainEqual({
      type: 'answer_replaced',
      answer: NO_CONTEXT_ANSWER,
    });
    expect(result.answer).toBe(NO_CONTEXT_ANSWER);
    expect(result.citations).toEqual([]);
    expect(result.quality?.abstained).toBe(true);
  });

  it('no verdict from the judge: keeps the plain ranking and answers', async () => {
    const f = setup({ relevance: null });
    const { result } = await run(f.service);
    expect(result.grounded_chunks?.map((c) => c.chunk_id)).toEqual(['a', 'b']);
    expect(result.answer).toBe('answer [Paper: a]');
    expect(result.quality).toBeUndefined();
    expect(f.groundedness).not.toHaveBeenCalled();
  });
});
