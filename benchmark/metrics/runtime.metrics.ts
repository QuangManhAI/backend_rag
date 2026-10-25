/**
 * Mathematical calculations for Runtime and Latency Metrics.
 * Pure TypeScript functions with zero external dependencies.
 */

export interface RequestMeasurement {
  request_id: string;
  query: string;
  scenario: string;
  concurrency_level: number;
  start_time_ms: number;
  end_time_ms: number;
  total_latency_ms: number;

  /** Time to first token in milliseconds (null if non-streaming or no token received) */
  ttft_ms: number | null;

  /** Total time to complete stream or receive full response in milliseconds */
  completion_time_ms: number;

  /** HTTP response status (200, 429, 503, 504, 0 if connection error) */
  status_code: number;

  success: boolean;
  is_timeout: boolean;
  is_aborted: boolean;
  error_message?: string;

  /** Token count produced in streaming response */
  token_count?: number;

  /** Server-side internal timings if returned in response/event */
  server_timings?: {
    embed_ms: number;
    route_ms: number;
    search_ms: number;
    rerank_ms: number;
    llm_ms: number;
    total_ms: number;
  };
}

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface AggregatedRuntimeMetrics {
  scenario: string;
  concurrency_level: number;
  duration_ms: number;

  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  timeout_requests: number;
  aborted_requests: number;

  success_rate: number;
  error_rate: number;
  timeout_rate: number;

  /** Throughput metrics (requests per second) */
  throughput: {
    started_rps: number;
    completed_rps: number;
    successful_rps: number;
  };

  /** End-to-end client latency stats */
  total_latency: LatencyStats;

  /** Time to first token stats (only for streaming requests that received tokens) */
  ttft: LatencyStats;

  /** Completion time stats */
  completion_time: LatencyStats;

  /** HTTP Status code breakdown (e.g. { 200: 95, 429: 5 }) */
  status_codes: Record<number, number>;

  /** Internal server timings (averages) */
  server_timings_avg: {
    embed_ms: number;
    route_ms: number;
    search_ms: number;
    rerank_ms: number;
    llm_ms: number;
    total_ms: number;
  };
}

/**
 * Calculates percentile using linear interpolation between closest ranks.
 * p is in range [0, 100].
 */
export function calculatePercentile(
  sortedValues: readonly number[],
  p: number,
): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  if (p <= 0) return sortedValues[0];
  if (p >= 100) return sortedValues[sortedValues.length - 1];

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  const interpolated =
    sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  return Math.round(interpolated * 100) / 100;
}

/**
 * Computes min, max, mean, p50, p90, p95, p99 over an array of numbers.
 */
export function computeLatencyStats(rawValues: number[]): LatencyStats {
  if (rawValues.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      p50: 0,
      p90: 0,
      p95: 0,
      p99: 0,
    };
  }

  const sorted = [...rawValues].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const count = sorted.length;

  return {
    count,
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[count - 1] * 100) / 100,
    mean: Math.round((sum / count) * 100) / 100,
    p50: calculatePercentile(sorted, 50),
    p90: calculatePercentile(sorted, 90),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
  };
}

/**
 * Aggregates runtime measurements into a comprehensive metrics object.
 */
export function aggregateRuntimeMetrics(
  measurements: RequestMeasurement[],
  scenario: string,
  concurrency_level: number,
  duration_ms: number,
): AggregatedRuntimeMetrics {
  const total = measurements.length;
  let successful = 0;
  let failed = 0;
  let timeouts = 0;
  let aborted = 0;

  const status_codes: Record<number, number> = {};
  const latencies: number[] = [];
  const ttfts: number[] = [];
  const completionTimes: number[] = [];

  let sumEmbed = 0;
  let sumRoute = 0;
  let sumSearch = 0;
  let sumRerank = 0;
  let sumLlm = 0;
  let sumServerTotal = 0;
  let serverTimingsCount = 0;

  for (const m of measurements) {
    status_codes[m.status_code] = (status_codes[m.status_code] || 0) + 1;

    if (m.is_timeout) timeouts++;
    if (m.is_aborted) aborted++;

    if (m.success) {
      successful++;
      latencies.push(m.total_latency_ms);
      completionTimes.push(m.completion_time_ms);

      if (m.ttft_ms !== null && m.ttft_ms > 0) {
        ttfts.push(m.ttft_ms);
      }

      if (m.server_timings) {
        sumEmbed += m.server_timings.embed_ms;
        sumRoute += m.server_timings.route_ms;
        sumSearch += m.server_timings.search_ms;
        sumRerank += m.server_timings.rerank_ms;
        sumLlm += m.server_timings.llm_ms;
        sumServerTotal += m.server_timings.total_ms;
        serverTimingsCount++;
      }
    } else {
      failed++;
      // Failed requests that completed still record their latency
      if (m.total_latency_ms > 0) {
        latencies.push(m.total_latency_ms);
      }
    }
  }

  const durationSec = duration_ms > 0 ? duration_ms / 1000 : 1;
  const started_rps = Math.round((total / durationSec) * 100) / 100;
  const completed_rps = Math.round((measurements.length / durationSec) * 100) / 100;
  const successful_rps = Math.round((successful / durationSec) * 100) / 100;

  const round2 = (x: number) => Math.round(x * 100) / 100;

  return {
    scenario,
    concurrency_level,
    duration_ms,
    total_requests: total,
    successful_requests: successful,
    failed_requests: failed,
    timeout_requests: timeouts,
    aborted_requests: aborted,
    success_rate: total > 0 ? round2((successful / total) * 100) : 0,
    error_rate: total > 0 ? round2((failed / total) * 100) : 0,
    timeout_rate: total > 0 ? round2((timeouts / total) * 100) : 0,
    throughput: {
      started_rps,
      completed_rps,
      successful_rps,
    },
    total_latency: computeLatencyStats(latencies),
    ttft: computeLatencyStats(ttfts),
    completion_time: computeLatencyStats(completionTimes),
    status_codes,
    server_timings_avg: {
      embed_ms:
        serverTimingsCount > 0 ? round2(sumEmbed / serverTimingsCount) : 0,
      route_ms:
        serverTimingsCount > 0 ? round2(sumRoute / serverTimingsCount) : 0,
      search_ms:
        serverTimingsCount > 0 ? round2(sumSearch / serverTimingsCount) : 0,
      rerank_ms:
        serverTimingsCount > 0 ? round2(sumRerank / serverTimingsCount) : 0,
      llm_ms: serverTimingsCount > 0 ? round2(sumLlm / serverTimingsCount) : 0,
      total_ms:
        serverTimingsCount > 0 ? round2(sumServerTotal / serverTimingsCount) : 0,
    },
  };
}
