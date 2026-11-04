import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const FastApiDuration = new Trend('fast_api_duration', true);
export const FastApiErrors = new Rate('fast_api_errors');
export const RequestCount = new Counter('fast_api_requests');

export const options = {
  scenarios: {
    fast_api_ramp: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '15s', target: 10 },  // Warmup stage (10 VUs)
        { duration: '20s', target: 30 },  // Step 1: 30 VUs
        { duration: '20s', target: 60 },  // Step 2: 60 VUs
        { duration: '20s', target: 100 }, // Step 3: 100 VUs (Peak)
        { duration: '15s', target: 10 },  // Ramp-down
        { duration: '10s', target: 0 },   // Cool-down
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<300', 'p(99)<500'], // SLA: P95 < 300ms, P99 < 500ms
    'http_req_failed': ['rate<0.01'],                 // Error rate < 1%
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/health`, {
    headers: { 'Accept': 'application/json' },
    tags: { scenario: 'fast_api' },
  });

  FastApiDuration.add(res.timings.duration);
  RequestCount.add(1);

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'body has status ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'ok';
      } catch (e) {
        return false;
      }
    },
  });

  FastApiErrors.add(!success);

  // Think time of 50-150ms between requests per VU
  sleep(Math.random() * 0.1 + 0.05);
}
