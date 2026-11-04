import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// @ts-ignore
const userPool = JSON.parse(open('./auth_bench_pool_100.json'));
const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export const Latency = new Trend('auth_latency', true);
export const Errors = new Rate('auth_errors');
export const SlaBreaches = new Counter('auth_sla_breaches_over_500ms');

export const options = {
  scenarios: {
    candidate_scan: {
      executor: 'ramping-vus',
      startVUs: 100,
      stages: [
        { duration: '15s', target: 200 }, // Stage 1: 200 VUs baseline
        { duration: '20s', target: 350 }, // Stage 2: 350 VUs
        { duration: '20s', target: 500 }, // Stage 3: 500 VUs
        { duration: '20s', target: 650 }, // Stage 4: 650 VUs
        { duration: '10s', target: 100 }, // Wind down
        { duration: '5s', target: 0 },    // Cool down
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
  },
};

export default function () {
  const user = userPool[(__VU - 1) % userPool.length];
  const authHeaders = {
    'Authorization': `Bearer ${user.token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const rand = Math.random();
  let res;

  if (rand < 0.50) {
    res = http.get(`${BASE_URL}/api/v1/auth/me`, { headers: authHeaders, tags: { endpoint: 'me' } });
  } else if (rand < 0.90) {
    res = http.get(`${BASE_URL}/api/v1/chat-sessions`, { headers: authHeaders, tags: { endpoint: 'sessions' } });
  } else {
    const payload = JSON.stringify({ display_name: `VU ${user.id.slice(-4)}` });
    res = http.patch(`${BASE_URL}/api/v1/auth/me`, payload, { headers: authHeaders, tags: { endpoint: 'patch' } });
  }

  const duration = res.timings.duration;
  Latency.add(duration);

  if (duration > 500) {
    SlaBreaches.add(1);
  }

  const ok = check(res, { 'status is 200': (r) => r.status === 200 });
  Errors.add(!ok);

  sleep(0.02 + Math.random() * 0.03);
}
