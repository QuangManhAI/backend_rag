import {
  aggregateRuntimeMetrics,
  AggregatedRuntimeMetrics,
  RequestMeasurement,
} from '../metrics/runtime.metrics';
import { executeRagRequest, SseClientRequestOptions } from '../collectors/sse-client';
import { ResourceCollector, ResourceSummary } from '../collectors/resource.collector';

export interface RuntimeScenarioConfig {
  name: string;
  description?: string;
  url: string;
  queries: string[];
  concurrency: number;
  total_requests: number;
  warmup_requests?: number;
  timeout_ms?: number;
  is_streaming?: boolean;
  bearer_token?: string;
  category?: string;
  top_k?: number;
  nprobe?: number;
  use_authority_boost?: boolean;
  expand_query?: boolean;
  safety_max_consecutive_failures?: number;
}

export interface ScenarioRunResult {
  config: RuntimeScenarioConfig;
  duration_ms: number;
  warmup_duration_ms: number;
  aggregated_metrics: AggregatedRuntimeMetrics;
  measurements: RequestMeasurement[];
  resource_summary: ResourceSummary | null;
  aborted_early: boolean;
  abort_reason?: string;
}

export type RequestExecutor = (
  opts: SseClientRequestOptions,
) => Promise<RequestMeasurement>;

/**
 * Worker pool running tasks with a fixed concurrency limit.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  shouldStop?: () => boolean,
): Promise<T[]> {
  const results: T[] = [];
  let taskIndex = 0;

  async function worker() {
    while (taskIndex < tasks.length) {
      if (shouldStop && shouldStop()) break;
      const index = taskIndex++;
      const res = await tasks[index]();
      results.push(res);
    }
  }

  const workerCount = Math.min(concurrency, tasks.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}

/**
 * RuntimeRunner:
 * Executes runtime benchmark scenarios with precise concurrency control,
 * warm-up separation, and safety circuit breakers.
 */
export class RuntimeRunner {
  constructor(
    private readonly executor: RequestExecutor = executeRagRequest,
  ) {}

  async runScenario(
    config: RuntimeScenarioConfig,
  ): Promise<ScenarioRunResult> {
    const resourceCollector = new ResourceCollector();
    resourceCollector.snapshot('start');

    const timeout_ms = config.timeout_ms || 30000;
    const safetyLimit = config.safety_max_consecutive_failures || 5;

    // --- Phase 1: Warm-up ---
    let warmupDuration = 0;
    const warmupCount = config.warmup_requests || 0;
    if (warmupCount > 0) {
      const warmupStart = performance.now();
      const warmupTasks = Array.from({ length: warmupCount }, (_, i) => {
        const query = config.queries[i % config.queries.length];
        return () =>
          this.executor({
            url: config.url,
            query,
            scenario: `${config.name}-warmup`,
            concurrency_level: 1,
            timeout_ms,
            is_streaming: config.is_streaming,
            bearer_token: config.bearer_token,
            category: config.category,
            top_k: config.top_k,
            nprobe: config.nprobe,
            use_authority_boost: config.use_authority_boost,
            expand_query: config.expand_query,
          });
      });
      await runWithConcurrency(warmupTasks, 1);
      warmupDuration = Math.round(performance.now() - warmupStart);
      resourceCollector.snapshot('post_warmup');
    }

    // --- Phase 2: Measurement ---
    let consecutiveFailures = 0;
    let abortedEarly = false;
    let abortReason: string | undefined;

    const measurementStart = performance.now();

    const tasks = Array.from({ length: config.total_requests }, (_, i) => {
      const query = config.queries[i % config.queries.length];
      return async () => {
        const m = await this.executor({
          url: config.url,
          query,
          scenario: config.name,
          concurrency_level: config.concurrency,
          timeout_ms,
          is_streaming: config.is_streaming,
          bearer_token: config.bearer_token,
          category: config.category,
          top_k: config.top_k,
          nprobe: config.nprobe,
          use_authority_boost: config.use_authority_boost,
          expand_query: config.expand_query,
        });

        if (!m.success) {
          consecutiveFailures++;
          if (consecutiveFailures >= safetyLimit) {
            abortedEarly = true;
            abortReason = `Safety breaker triggered: ${consecutiveFailures} consecutive failures`;
          }
        } else {
          consecutiveFailures = 0;
        }

        return m;
      };
    });

    const measurements = await runWithConcurrency(
      tasks,
      config.concurrency,
      () => abortedEarly,
    );

    const duration_ms = Math.round(performance.now() - measurementStart);
    resourceCollector.snapshot('end');

    const aggregated = aggregateRuntimeMetrics(
      measurements,
      config.name,
      config.concurrency,
      duration_ms,
    );

    return {
      config,
      duration_ms,
      warmup_duration_ms: warmupDuration,
      aggregated_metrics: aggregated,
      measurements,
      resource_summary: resourceCollector.getSummary(),
      aborted_early: abortedEarly,
      abort_reason: abortReason,
    };
  }
}
