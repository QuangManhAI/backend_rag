import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const BurstDuration = new Trend('burst_duration', true);
export const FastRejections429 = new Counter('burst_fast_rejections_429');
export const Successes200 = new Counter('burst_successes_200');
export const TimeoutsOr5xx = new Counter('burst_timeouts_or_5xx');

export const options = {
  scenarios: {
    burst_saturation: {
      executor: 'per-vu-iterations',
      vus: 16,            // 16 users hit the system simultaneously at t=0
      iterations: 1,      // 1 query each
      maxDuration: '90s', // Wait up to 90s to observe timeout vs queue limits
    },
  },
};

const SAMPLE_QUERIES = [
  'What is machine learning?',
  'Explain the difference between supervised and unsupervised learning.',
  'How does neural network backpropagation work?',
  'What are the limitations of transformer attention?',
];

export default function () {
  const query = SAMPLE_QUERIES[__VU % SAMPLE_QUERIES.length];
  const payload = JSON.stringify({ query: query, top_k: 2 });
  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '75s',
    tags: { scenario: 'queue_burst' },
  };

  const startTime = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/rag/chat`, payload, params);
  const duration = Date.now() - startTime;
  BurstDuration.add(duration);

  if (res.status === 200) {
    Successes200.add(1);
    check(res, { '200 OK (Served)': (r) => r.status === 200 });
  } else if (res.status === 429) {
    FastRejections429.add(1);
    check(res, { '429 Queue Full (Fast Reject)': (r) => r.status === 429 });
  } else {
    TimeoutsOr5xx.add(1);
    check(res, { 'Timeout or 5xx': (r) => false });
  }
}
