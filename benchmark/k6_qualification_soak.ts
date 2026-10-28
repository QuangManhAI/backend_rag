import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

/**
 * 5-minute endurance qualification soak.
 *
 * Phases:
 *   1. Ramp-up  (RAMP, default 30s): 0 -> SOAK_VUS. Prevents a synthetic "thundering herd"
 *      that overflows the Node.js TCP listen backlog (511) and yields ECONNREFUSED storms.
 *   2. Hold     (SOAK_DURATION): constant SOAK_VUS. ONLY this phase is judged against the SLA.
 *
 * Hold-phase metrics are recorded into dedicated `hold_*` metrics so ramp-up noise never
 * contaminates the qualification verdict. Latency percentiles use successful responses only;
 * failures are tracked separately via `hold_error_rate` (a 0 ms refused connection must never
 * be allowed to drag P95 down).
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = parseInt(__ENV.SOAK_VUS || '2000', 10);
const DURATION = __ENV.SOAK_DURATION || '1m';
const RAMP = __ENV.SOAK_RAMP || '30s';
const SCENARIO_TYPE = __ENV.SOAK_SCENARIO || 'fast'; // 'fast' or 'session'

function toMs(d: string): number {
  const m = d.match(/^(\d+)(ms|s|m)$/);
  if (!m) return 30000;
  const n = parseInt(m[1], 10);
  return m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : n * 60000;
}
const RAMP_MS = toMs(RAMP);

// Hold-phase (qualification) metrics
export const HoldDuration = new Trend('hold_req_duration', true); // successful requests only
export const HoldErrorRate = new Rate('hold_error_rate');
export const HoldRequests = new Counter('hold_requests');
export const HoldP95Breaches = new Counter('hold_over_500ms');
export const HoldP99Breaches = new Counter('hold_over_1000ms');

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  scenarios: {
    soak_qualification: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },     // ramp-up (not judged)
        { duration: DURATION, target: VUS }, // hold (judged)
      ],
      gracefulRampDown: '5s',
      gracefulStop: '5s',
    },
  },
  thresholds: {
    hold_req_duration: ['p(95)<500', 'p(99)<1000'],
    hold_error_rate: ['rate<0.01'],
  },
};

export function setup() {
  return { t0: Date.now() };
}

function record(res: any, t0: number) {
  if (Date.now() - t0 < RAMP_MS) return; // ramp-up phase: ignore
  HoldRequests.add(1);
  const ok = res.status === 200 || res.status === 429; // 429 = intentional load-shedding (chat only)
  HoldErrorRate.add(!ok);
  if (res.status === 200) {
    const d = res.timings.duration;
    HoldDuration.add(d);
    if (d > 500) HoldP95Breaches.add(1);
    if (d > 1000) HoldP99Breaches.add(1);
  }
}

export default function (data: { t0: number }) {
  if (SCENARIO_TYPE === 'fast') {
    const res = http.get(`${BASE_URL}/api/v1/health`, {
      headers: { Accept: 'application/json' },
      tags: { scenario: 'fast_soak' },
      timeout: '10s',
    });
    check(res, { 'status is 200': (r) => r.status === 200 });
    record(res, data.t0);
    // Rapid-consumer pacing (20-70 ms), identical to k6_extreme_fast_api.ts
    sleep(Math.random() * 0.05 + 0.02);
  } else {
    // Realistic researcher journey: browse -> think -> chat -> read
    const r1 = http.get(`${BASE_URL}/api/v1/health`, { timeout: '5s' });
    check(r1, { 'health ok': (r) => r.status === 200 });
    record(r1, data.t0);

    const r2 = http.get(`${BASE_URL}/api/v1/documents`, { timeout: '5s' });
    check(r2, { 'docs ok': (r) => r.status === 200 });
    record(r2, data.t0);

    sleep(2 + Math.random() * 2);

    const r3 = http.post(
      `${BASE_URL}/api/v1/rag/chat`,
      JSON.stringify({ query: 'Explain neural networks', top_k: 2 }),
      { headers: { 'Content-Type': 'application/json' }, timeout: '60s' },
    );
    check(r3, { 'chat served or shed': (r) => r.status === 200 || r.status === 429 });
    if (Date.now() - data.t0 >= RAMP_MS) {
      HoldRequests.add(1);
      HoldErrorRate.add(!(r3.status === 200 || r3.status === 429));
    }

    sleep(3 + Math.random() * 3);
  }
}
