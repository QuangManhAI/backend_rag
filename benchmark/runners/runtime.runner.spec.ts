import {
  RuntimeRunner,
  runWithConcurrency,
  RuntimeScenarioConfig,
} from './runtime.runner';
import { RequestMeasurement } from '../metrics/runtime.metrics';
import { generateRuntimeMarkdownReport } from '../reports/runtime.reporter';

describe('RuntimeRunner Integration Tests', () => {
  it('runWithConcurrency strictly enforces maximum concurrent workers', async () => {
    let currentInFlight = 0;
    let maxInFlight = 0;

    const tasks = Array.from({ length: 8 }, (_, i) => async () => {
      currentInFlight++;
      if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;
      await new Promise((r) => setTimeout(r, 20));
      currentInFlight--;
      return i;
    });

    const results = await runWithConcurrency(tasks, 2);
    expect(results).toHaveLength(8);
    expect(maxInFlight).toBe(2);
    expect(currentInFlight).toBe(0);
  });

  it('runs scenario with warm-up, calculates percentiles and TTFT', async () => {
    const mockExecutor = async (opts: any): Promise<RequestMeasurement> => {
      const isWarmup = opts.scenario.includes('warmup');
      const start = performance.now();
      await new Promise((r) => setTimeout(r, 10));
      const end = performance.now();
      const latency = Math.round((end - start) * 100) / 100;

      return {
        request_id: `req_${Math.random()}`,
        query: opts.query,
        scenario: opts.scenario,
        concurrency_level: opts.concurrency_level,
        start_time_ms: start,
        end_time_ms: end,
        total_latency_ms: latency,
        ttft_ms: isWarmup ? null : latency * 0.4,
        completion_time_ms: latency,
        status_code: 200,
        success: true,
        is_timeout: false,
        is_aborted: false,
        token_count: 20,
        server_timings: {
          embed_ms: 5,
          route_ms: 1,
          search_ms: 2,
          rerank_ms: 1,
          llm_ms: 10,
          total_ms: 19,
        },
      };
    };

    const runner = new RuntimeRunner(mockExecutor);

    const config: RuntimeScenarioConfig = {
      name: 'Test-Baseline',
      url: 'http://localhost:3000/api/v1/rag/chat/stream',
      queries: ['query 1', 'query 2'],
      concurrency: 2,
      total_requests: 4,
      warmup_requests: 2,
      timeout_ms: 5000,
      is_streaming: true,
    };

    const res = await runner.runScenario(config);

    expect(res.warmup_duration_ms).toBeGreaterThanOrEqual(0);
    expect(res.measurements).toHaveLength(4);
    expect(res.aggregated_metrics.total_requests).toBe(4);
    expect(res.aggregated_metrics.successful_requests).toBe(4);
    expect(res.aggregated_metrics.success_rate).toBe(100);
    expect(res.aggregated_metrics.ttft.count).toBe(4);
    expect(res.resource_summary).toBeDefined();

    const md = generateRuntimeMarkdownReport({
      title: 'Test Report',
      timestamp: new Date().toISOString(),
      base_url: 'http://localhost:3000',
      scenarios: [res],
    });

    expect(md).toContain('# RAG Runtime & Load Benchmark Report');
    expect(md).toContain('Test-Baseline');
  });

  it('circuit breaker triggers and aborts early on consecutive failures', async () => {
    let callCount = 0;
    const failingExecutor = async (opts: any): Promise<RequestMeasurement> => {
      callCount++;
      return {
        request_id: `fail_${callCount}`,
        query: opts.query,
        scenario: opts.scenario,
        concurrency_level: 1,
        start_time_ms: 0,
        end_time_ms: 10,
        total_latency_ms: 10,
        ttft_ms: null,
        completion_time_ms: 10,
        status_code: 503,
        success: false,
        is_timeout: false,
        is_aborted: false,
        error_message: 'Service Unavailable',
      };
    };

    const runner = new RuntimeRunner(failingExecutor);
    const config: RuntimeScenarioConfig = {
      name: 'Safety-Breaker-Test',
      url: 'http://localhost:3000/api/v1/rag/chat/stream',
      queries: ['failing query'],
      concurrency: 1,
      total_requests: 10,
      warmup_requests: 0,
      safety_max_consecutive_failures: 3,
    };

    const res = await runner.runScenario(config);

    expect(res.aborted_early).toBe(true);
    expect(res.abort_reason).toContain('Safety breaker triggered');
    expect(res.measurements.length).toBeLessThan(10);
  });
});
