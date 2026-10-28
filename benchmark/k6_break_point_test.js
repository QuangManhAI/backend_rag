import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const LatencyP50 = new Trend('break_latency_p50', true);
export const LatencyP95 = new Trend('break_latency_p95', true);
export const LatencyP99 = new Trend('break_latency_p99', true);
export const ErrorRate = new Rate('break_error_rate');
export const SlaBreaches = new Counter('break_sla_breaches_over_500ms');

export const options = {
  scenarios: {
    find_breaking_point: {
      executor: 'ramping-vus',
      startVUs: 100,
      stages: [
        { duration: '15s', target: 500 },  // Stage 1: 500 VUs
        { duration: '20s', target: 1200 }, // Stage 2: 1,200 VUs
        { duration: '20s', target: 2000 }, // Stage 3: 2,000 VUs
        { duration: '25s', target: 2500 }, // Stage 4: 2,500 VUs (Image 1 target)
        { duration: '25s', target: 3000 }, // Stage 5: 3,000 VUs (Image 2 failure cliff)
        { duration: '10s', target: 100 },  // Recovery
        { duration: '5s', target: 0 },     // Wind down
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/health`, {
    headers: { 'Accept': 'application/json' },
    tags: { scenario: 'break_point' },
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
    check(res, { 'status is 200': (r) => r.status === 200 });
  } else {
    ErrorRate.add(1);
    check(res, { 'request error': (r) => false });
  }

  sleep(Math.random() * 0.05 + 0.02);
}
