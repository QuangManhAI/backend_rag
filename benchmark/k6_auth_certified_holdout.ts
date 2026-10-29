import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Load pre-authenticated pool of 100 users
// @ts-ignore
const userPool = JSON.parse(open('./auth_bench_pool_100.json'));

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export const AuthMeDuration = new Trend('auth_me_duration', true);
export const SessionsListDuration = new Trend('sessions_list_duration', true);
export const ProfilePatchDuration = new Trend('profile_patch_duration', true);
export const AuthenticatedErrors = new Rate('authenticated_errors');
export const AuthenticatedRequests = new Counter('authenticated_requests_total');

export const options = {
  scenarios: {
    certified_3min_holdout: {
      executor: 'ramping-vus',
      startVUs: 50,
      stages: [
        { duration: '15s', target: 300 },  // Quick ramp to 300 VUs target
        { duration: '180s', target: 300 }, // Sustained 3-minute hold-out at 300 VUs (Rule L1)
        { duration: '15s', target: 0 },    // Cool down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'], // Rule L1 SLA: P95 < 500ms, P99 < 1000ms
    'http_req_failed': ['rate<0.01'],                  // Rule L1 Error SLA: < 1%
    'auth_me_duration': ['p(95)<500'],
    'sessions_list_duration': ['p(95)<500'],
    'profile_patch_duration': ['p(95)<500'],
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

  if (rand < 0.50) {
    // 50% Traffic: GET /api/v1/auth/me
    const res = http.get(`${BASE_URL}/api/v1/auth/me`, {
      headers: authHeaders,
      tags: { endpoint: 'auth_me' },
    });

    AuthMeDuration.add(res.timings.duration);
    AuthenticatedRequests.add(1);

    const ok = check(res, {
      'auth_me status 200': (r) => r.status === 200,
      'auth_me returns user id': (r) => {
        try {
          return JSON.parse(r.body).id === user.id;
        } catch (_) {
          return false;
        }
      },
    });

    AuthenticatedErrors.add(!ok);
  } else if (rand < 0.90) {
    // 40% Traffic: GET /api/v1/chat-sessions
    const res = http.get(`${BASE_URL}/api/v1/chat-sessions`, {
      headers: authHeaders,
      tags: { endpoint: 'chat_sessions' },
    });

    SessionsListDuration.add(res.timings.duration);
    AuthenticatedRequests.add(1);

    const ok = check(res, {
      'chat_sessions status 200': (r) => r.status === 200,
      'chat_sessions has items': (r) => {
        try {
          return Array.isArray(JSON.parse(r.body).items);
        } catch (_) {
          return false;
        }
      },
    });

    AuthenticatedErrors.add(!ok);
  } else {
    // 10% Traffic: PATCH /api/v1/auth/me
    const newName = `Bench VU ${user.id.slice(-4)} ${Math.floor(Math.random() * 1000)}`;
    const payload = JSON.stringify({ display_name: newName });

    const res = http.patch(`${BASE_URL}/api/v1/auth/me`, payload, {
      headers: authHeaders,
      tags: { endpoint: 'profile_patch' },
    });

    ProfilePatchDuration.add(res.timings.duration);
    AuthenticatedRequests.add(1);

    const ok = check(res, {
      'profile_patch status 200': (r) => r.status === 200,
    });

    AuthenticatedErrors.add(!ok);
  }

  sleep(0.02 + Math.random() * 0.03);
}
