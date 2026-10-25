import {
  calculatePercentile,
  computeLatencyStats,
  aggregateRuntimeMetrics,
  RequestMeasurement,
} from './runtime.metrics';

describe('Runtime Metrics Unit Tests', () => {
  describe('calculatePercentile', () => {
    it('returns 0 for empty array', () => {
      expect(calculatePercentile([], 50)).toBe(0);
    });

    it('returns the single element regardless of percentile', () => {
      expect(calculatePercentile([42], 0)).toBe(42);
      expect(calculatePercentile([42], 50)).toBe(42);
      expect(calculatePercentile([42], 99)).toBe(42);
    });

    it('computes exact hand-calculated percentiles using linear interpolation', () => {
      // 5 values: index range 0 to 4
      const vals = [10, 20, 30, 40, 50];

      // p0: index 0 -> 10
      expect(calculatePercentile(vals, 0)).toBe(10);

      // p50: index 0.5 * 4 = 2 -> vals[2] = 30
      expect(calculatePercentile(vals, 50)).toBe(30);

      // p90: index 0.9 * 4 = 3.6 -> lower=3 (40), upper=4 (50), weight=0.6 -> 40*0.4 + 50*0.6 = 46
      expect(calculatePercentile(vals, 90)).toBe(46);

      // p95: index 0.95 * 4 = 3.8 -> lower=3 (40), upper=4 (50), weight=0.8 -> 40*0.2 + 50*0.8 = 48
      expect(calculatePercentile(vals, 95)).toBe(48);

      // p100: index 4 -> 50
      expect(calculatePercentile(vals, 100)).toBe(50);
    });
  });

  describe('computeLatencyStats', () => {
    it('returns zeroed stats for empty list', () => {
      const stats = computeLatencyStats([]);
      expect(stats.count).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.mean).toBe(0);
      expect(stats.p50).toBe(0);
    });

    it('correctly calculates mean, min, max and percentiles', () => {
      const raw = [100, 200, 300, 400, 500];
      const stats = computeLatencyStats(raw);

      expect(stats.count).toBe(5);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(500);
      expect(stats.mean).toBe(300);
      expect(stats.p50).toBe(300);
      expect(stats.p90).toBe(460);
    });
  });

  describe('aggregateRuntimeMetrics', () => {
    const mockMeasurements: RequestMeasurement[] = [
      {
        request_id: 'req_1',
        query: 'q1',
        scenario: 'test-scenario',
        concurrency_level: 2,
        start_time_ms: 1000,
        end_time_ms: 1200,
        total_latency_ms: 200,
        ttft_ms: 50,
        completion_time_ms: 200,
        status_code: 200,
        success: true,
        is_timeout: false,
        is_aborted: false,
        server_timings: {
          embed_ms: 30,
          route_ms: 5,
          search_ms: 25,
          rerank_ms: 5,
          llm_ms: 130,
          total_ms: 195,
        },
      },
      {
        request_id: 'req_2',
        query: 'q2',
        scenario: 'test-scenario',
        concurrency_level: 2,
        start_time_ms: 1000,
        end_time_ms: 1400,
        total_latency_ms: 400,
        ttft_ms: 100,
        completion_time_ms: 400,
        status_code: 200,
        success: true,
        is_timeout: false,
        is_aborted: false,
        server_timings: {
          embed_ms: 30,
          route_ms: 5,
          search_ms: 35,
          rerank_ms: 5,
          llm_ms: 320,
          total_ms: 395,
        },
      },
      {
        request_id: 'req_3',
        query: 'q3',
        scenario: 'test-scenario',
        concurrency_level: 2,
        start_time_ms: 1000,
        end_time_ms: 1500,
        total_latency_ms: 500,
        ttft_ms: null,
        completion_time_ms: 500,
        status_code: 504,
        success: false,
        is_timeout: true,
        is_aborted: false,
      },
      {
        request_id: 'req_4',
        query: 'q4',
        scenario: 'test-scenario',
        concurrency_level: 2,
        start_time_ms: 1000,
        end_time_ms: 1050,
        total_latency_ms: 50,
        ttft_ms: null,
        completion_time_ms: 50,
        status_code: 429,
        success: false,
        is_timeout: false,
        is_aborted: false,
      },
    ];

    it('aggregates throughput, success rate, and error rate accurately', () => {
      const agg = aggregateRuntimeMetrics(
        mockMeasurements,
        'test-scenario',
        2,
        2000, // duration 2 seconds
      );

      expect(agg.total_requests).toBe(4);
      expect(agg.successful_requests).toBe(2);
      expect(agg.failed_requests).toBe(2);
      expect(agg.timeout_requests).toBe(1);

      // Success rate: 2/4 = 50%
      expect(agg.success_rate).toBe(50);
      // Error rate: 2/4 = 50%
      expect(agg.error_rate).toBe(50);
      // Timeout rate: 1/4 = 25%
      expect(agg.timeout_rate).toBe(25);

      // Throughput: 4 requests in 2 seconds = 2 req/s
      expect(agg.throughput.completed_rps).toBe(2);
      expect(agg.throughput.successful_rps).toBe(1);

      // Status codes breakdown
      expect(agg.status_codes[200]).toBe(2);
      expect(agg.status_codes[504]).toBe(1);
      expect(agg.status_codes[429]).toBe(1);

      // TTFT: only measured on req_1 (50ms) and req_2 (100ms)
      expect(agg.ttft.count).toBe(2);
      expect(agg.ttft.mean).toBe(75);
      expect(agg.ttft.min).toBe(50);
      expect(agg.ttft.max).toBe(100);

      // Server timings averages:
      expect(agg.server_timings_avg.embed_ms).toBe(30);
      expect(agg.server_timings_avg.search_ms).toBe(30);
      expect(agg.server_timings_avg.total_ms).toBe(295);
    });
  });
});
