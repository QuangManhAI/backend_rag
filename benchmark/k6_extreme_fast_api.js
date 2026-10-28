import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const LatencyP50 = new Trend('extreme_latency_p50', true);
export const LatencyP95 = new Trend('extreme_latency_p95', true);
export const LatencyP99 = new Trend('extreme_latency_p99', true);
export const ErrorRate = new Rate('extreme_error_rate');
export const SocketErrors = new Counter('extreme_socket_errors');
export const ServerErrors5xx = new Counter('extreme_5xx_errors');
export const SlaBreaches = new Counter('extreme_sla_breaches_p95_over_500ms');

export const options = {
  scenarios: {
    extreme_fast_api_ramp: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '15s', target: 100 },  // 100 VUs baseline
        { duration: '20s', target: 250 },  // 250 VUs
        { duration: '25s', target: 500 },  // 500 VUs
        { duration: '25s', target: 750 },  // 750 VUs
        { duration: '30s', target: 1000 }, // 1000 VUs (Peak saturation push)
        { duration: '15s', target: 50 },   // Recovery
        { duration: '10s', target: 0 },    // Cool-down
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(50)<100', 'p(95)<500', 'p(99)<1000'], // User SLA: P50<100ms, P95<500ms, P99<1000ms
    'http_req_failed': ['rate<0.01'],                               // Error rate < 1%
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/health`, {
    headers: { 'Accept': 'application/json' },
    tags: { scenario: 'extreme_fast_api' },
    timeout: '10s',
  });

  const duration = res.timings.duration;
  LatencyP50.add(duration);
  LatencyP95.add(duration);
  LatencyP99.add(duration);

  if (duration > 500) {
    SlaBreaches.add(1);
  }

  if (res.status === 200) {
    ErrorRate.add(0);
    check(res, {
      'status is 200': (r) => r.status === 200,
    });
  } else {
    ErrorRate.add(1);
    if (res.status >= 500) {
      ServerErrors5xx.add(1);
    } else if (res.status === 0) {
      // Status 0 represents network socket timeout / connection refused
      SocketErrors.add(1);
    }
    check(res, {
      'unexpected response': (r) => false,
    });
  }

  // Small random sleep to simulate rapid API consumers
  sleep(Math.random() * 0.05 + 0.02);
}
