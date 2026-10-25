import { RuntimeScenarioConfig } from '../runners/runtime.runner';

export const DEFAULT_BENCHMARK_QUERIES = [
  'How does low-rank adaptation LoRA optimize large models?',
  'What is the rank parameter r in LoRA decomposition?',
  'How does the self-attention mechanism work in Transformers?',
  'What is the scaled dot-product formula for attention?',
  'How do deep residual connections address degradation in deep networks?',
];

export function createSmokeScenario(baseUrl: string): RuntimeScenarioConfig {
  return {
    name: 'Scenario-A-Smoke',
    description: 'Quick smoke test verifying API connectivity and response format',
    url: `${baseUrl}/api/v1/rag/chat/stream`,
    queries: DEFAULT_BENCHMARK_QUERIES.slice(0, 2),
    concurrency: 1,
    total_requests: 3,
    warmup_requests: 0,
    timeout_ms: 10000,
    is_streaming: true,
  };
}

export function createBaselineScenario(baseUrl: string): RuntimeScenarioConfig {
  return {
    name: 'Scenario-B-Baseline',
    description: 'Low-concurrency baseline measurement with separate warm-up',
    url: `${baseUrl}/api/v1/rag/chat/stream`,
    queries: DEFAULT_BENCHMARK_QUERIES,
    concurrency: 1,
    total_requests: 10,
    warmup_requests: 2,
    timeout_ms: 30000,
    is_streaming: true,
  };
}

export function createConcurrencyScenario(
  baseUrl: string,
  concurrencyLevel: number,
): RuntimeScenarioConfig {
  return {
    name: `Scenario-C-Concurrency-${concurrencyLevel}`,
    description: `Concurrency test at concurrency level ${concurrencyLevel}`,
    url: `${baseUrl}/api/v1/rag/chat/stream`,
    queries: DEFAULT_BENCHMARK_QUERIES,
    concurrency: concurrencyLevel,
    total_requests: Math.max(concurrencyLevel * 3, 6),
    warmup_requests: 1,
    timeout_ms: 45000,
    is_streaming: true,
  };
}

export function createCacheComparisonScenario(
  baseUrl: string,
  repeated: boolean,
): RuntimeScenarioConfig {
  // If repeated is true, sends the EXACT same query to test LRU cache hit
  const query = 'How does low-rank adaptation LoRA optimize large models?';
  const queries = repeated
    ? Array.from({ length: 5 }, () => query)
    : [
        'Query variant 1 about LoRA math',
        'Query variant 2 about LoRA scaling',
        'Query variant 3 about LoRA ranks',
        'Query variant 4 about LoRA adapters',
        'Query variant 5 about LoRA weights',
      ];

  return {
    name: repeated ? 'Scenario-D-Cache-Hit' : 'Scenario-D-Cache-Miss',
    description: repeated
      ? 'Measures latency on repeated queries with identical text (LRU hit)'
      : 'Measures latency on distinct novel queries (LRU miss)',
    url: `${baseUrl}/api/v1/rag/chat/stream`,
    queries,
    concurrency: 1,
    total_requests: 5,
    warmup_requests: repeated ? 1 : 0,
    timeout_ms: 30000,
    is_streaming: true,
  };
}

export function createSustainedScenario(baseUrl: string): RuntimeScenarioConfig {
  return {
    name: 'Scenario-E-Sustained',
    description: 'Sustained load monitoring latency stability and queue behavior',
    url: `${baseUrl}/api/v1/rag/chat/stream`,
    queries: DEFAULT_BENCHMARK_QUERIES,
    concurrency: 2,
    total_requests: 20,
    warmup_requests: 2,
    timeout_ms: 35000,
    is_streaming: true,
  };
}

export function createFailureScenario(baseUrl: string): RuntimeScenarioConfig {
  return {
    name: 'Scenario-F-Failure-Handling',
    description: 'Tests resilience against invalid categories, rate limits, and short timeouts',
    url: `${baseUrl}/api/v1/rag/chat/stream`,
    queries: [
      'Query with invalid category trigger',
    ],
    category: 'INVALID-CATEGORY-!!!', // Will trigger 400 Bad Request
    concurrency: 1,
    total_requests: 3,
    warmup_requests: 0,
    timeout_ms: 5000,
    is_streaming: true,
    safety_max_consecutive_failures: 10,
  };
}

export async function isServerReachable(url: string): Promise<boolean> {
  const http = await import('http');
  return new Promise((resolve) => {
    try {
      const u = new URL(`${url}/api/v1/health/live`);
      const req = http.get(u, { timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Realistic mock executor simulating RAG pipeline behavior with queue, concurrency, and TTFT */
export function createMockExecutor(): (opts: any) => Promise<any> {
  let inFlight = 0;
  const maxConcurrency = 1;
  const maxQueue = 8;
  const queue: Array<() => void> = [];

  return async (opts) => {
    const start = performance.now();
    const reqId = `mock_${Math.random().toString(36).slice(2, 8)}`;

    if (inFlight >= maxConcurrency && queue.length >= maxQueue) {
      const end = performance.now();
      return {
        request_id: reqId,
        query: opts.query,
        scenario: opts.scenario,
        concurrency_level: opts.concurrency_level,
        start_time_ms: start,
        end_time_ms: end,
        total_latency_ms: Math.round((end - start) * 100) / 100,
        ttft_ms: null,
        completion_time_ms: Math.round((end - start) * 100) / 100,
        status_code: 429,
        success: false,
        is_timeout: false,
        is_aborted: false,
        error_message: 'LLM queue capacity exceeded (max_queue=8)',
      };
    }

    if (inFlight >= maxConcurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    inFlight++;
    try {
      const isFailureTrigger = opts.category === 'INVALID-CATEGORY-!!!';
      if (isFailureTrigger) {
        const end = performance.now();
        return {
          request_id: reqId,
          query: opts.query,
          scenario: opts.scenario,
          concurrency_level: opts.concurrency_level,
          start_time_ms: start,
          end_time_ms: end,
          total_latency_ms: Math.round((end - start) * 100) / 100,
          ttft_ms: null,
          completion_time_ms: Math.round((end - start) * 100) / 100,
          status_code: 400,
          success: false,
          is_timeout: false,
          is_aborted: false,
          error_message: 'Invalid scientific category',
        };
      }

      // Simulate realistic internal timings
      const embedMs = 15 + Math.random() * 5;
      const routeMs = 8 + Math.random() * 3;
      const searchMs = 20 + Math.random() * 10;
      const rerankMs = 5 + Math.random() * 2;
      const ttftMs = Math.round((embedMs + routeMs + searchMs + rerankMs + 25) * 100) / 100;
      const genMs = 25 + Math.random() * 15;
      const totalMs = Math.round((ttftMs + genMs) * 100) / 100;

      const end = performance.now() + totalMs;

      return {
        request_id: reqId,
        query: opts.query,
        scenario: opts.scenario,
        concurrency_level: opts.concurrency_level,
        start_time_ms: start,
        end_time_ms: end,
        total_latency_ms: totalMs,
        ttft_ms: ttftMs,
        completion_time_ms: totalMs,
        status_code: 200,
        success: true,
        is_timeout: false,
        is_aborted: false,
        token_count: 85,
        server_timings: {
          embed_ms: Math.round(embedMs),
          route_ms: Math.round(routeMs),
          search_ms: Math.round(searchMs),
          rerank_ms: Math.round(rerankMs),
          llm_ms: Math.round(genMs),
          total_ms: Math.round(totalMs),
        },
      };
    } finally {
      inFlight--;
      if (queue.length > 0) {
        const next = queue.shift();
        if (next) next();
      }
    }
  };
}
