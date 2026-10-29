import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Trend, Rate, Counter } from 'k6/metrics';

// @ts-ignore
const userPool = JSON.parse(open('./auth_bench_pool_100.json'));
const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';

// Endpoint-specific latency trends
export const ListPage1Duration = new Trend('prod_list_page1_duration', true);
export const ListPage2SearchDuration = new Trend('prod_list_page2_search_duration', true);
export const SessionDetailDuration = new Trend('prod_session_detail_duration', true);
export const AuthMeDuration = new Trend('prod_auth_me_duration', true);
export const SessionRenameDuration = new Trend('prod_session_rename_duration', true);
export const ProfilePatchDuration = new Trend('prod_profile_patch_duration', true);

export const ProdErrors = new Rate('prod_errors');
export const SlaBreaches500ms = new Counter('prod_sla_breaches_over_500ms');

export const options = {
  scenarios: {
    rule_l1_certified_holdout_3min: {
      executor: 'ramping-arrival-rate',
      startRate: 40,
      timeUnit: '1s',
      preAllocatedVUs: 100, // 100 Concurrent Users (CUs) pool
      maxVUs: 200,
      stages: [
        { duration: '15s', target: 50 },  // Warm-up ramp to 50 req/s (100 CUs with 1.75s think time)
        { duration: '180s', target: 50 }, // Rule L1: Full 3-Minute (180s) Continuous Hold-Out at 50 req/s (100 CUs)
        { duration: '10s', target: 0 },   // Graceful ramp-down
      ],
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'prod_errors': ['rate<0.01'],
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'prod_list_page1_duration': ['p(95)<500'],
    'prod_list_page2_search_duration': ['p(95)<500'],
    'prod_auth_me_duration': ['p(95)<500'],
    'prod_session_rename_duration': ['p(95)<500'],
    'prod_profile_patch_duration': ['p(95)<500'],
    'prod_session_detail_duration': ['p(95)<750', 'p(99)<1000'],
  },
};

export default function () {
  const userIdx = (exec.vu.idInTest - 1) % userPool.length;
  const user = userPool[userIdx];
  const authHeaders = {
    'Authorization': `Bearer ${user.token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };

  const rand = Math.random();
  let res;
  let ok = false;

  if (rand < 0.30) {
    // 30%: GET /api/v1/chat-sessions (Page 1 - 10 items + next_cursor)
    res = http.get(`${BASE_URL}/api/v1/chat-sessions`, {
      headers: authHeaders,
      timeout: '2s',
      tags: { endpoint: 'list_page1' },
    });
    ListPage1Duration.add(res.timings.duration);
    ok = check(res, {
      'list_page1 200': (r) => r.status === 200,
      'list_page1 has 10 items': (r) => {
        try {
          const b = JSON.parse(r.body);
          return Array.isArray(b.items) && b.items.length === 10 && b.next_cursor !== null;
        } catch (_) {
          return false;
        }
      },
    });
  } else if (rand < 0.40) {
    // 10%: Page 2 Cursor Pagination (5%) or Regex Search ?q=Transformer (5%)
    const url =
      rand < 0.35
        ? `${BASE_URL}/api/v1/chat-sessions?cursor=${encodeURIComponent(user.page1Cursor)}`
        : `${BASE_URL}/api/v1/chat-sessions?q=Transformer`;
    res = http.get(url, {
      headers: authHeaders,
      timeout: '2s',
      tags: { endpoint: 'list_page2_or_search' },
    });
    ListPage2SearchDuration.add(res.timings.duration);
    ok = check(res, {
      'page2_or_search 200': (r) => r.status === 200,
      'page2_or_search non-empty': (r) => {
        try {
          const b = JSON.parse(r.body);
          return Array.isArray(b.items) && b.items.length > 0;
        } catch (_) {
          return false;
        }
      },
    });
  } else if (rand < 0.70) {
    // 30%: GET /api/v1/chat-sessions/:id (Full session detail with 10 messages & citations)
    const sId = user.sessionIds[Math.floor(Math.random() * user.sessionIds.length)];
    res = http.get(`${BASE_URL}/api/v1/chat-sessions/${sId}`, {
      headers: authHeaders,
      timeout: '2s',
      tags: { endpoint: 'session_detail' },
    });
    SessionDetailDuration.add(res.timings.duration);
    ok = check(res, {
      'session_detail 200': (r) => r.status === 200,
      'session_detail has 10 messages': (r) => {
        try {
          const b = JSON.parse(r.body);
          return Array.isArray(b.messages) && b.messages.length === 10;
        } catch (_) {
          return false;
        }
      },
    });
  } else if (rand < 0.85) {
    // 15%: GET /api/v1/auth/me
    res = http.get(`${BASE_URL}/api/v1/auth/me`, {
      headers: authHeaders,
      timeout: '2s',
      tags: { endpoint: 'auth_me' },
    });
    AuthMeDuration.add(res.timings.duration);
    ok = check(res, {
      'auth_me 200': (r) => r.status === 200,
    });
  } else if (rand < 0.95) {
    // 10%: PATCH /api/v1/chat-sessions/:id (Rename session write)
    const sId = user.sessionIds[Math.floor(Math.random() * user.sessionIds.length)];
    const payload = JSON.stringify({
      title: `Transformer & LoRA Analysis [U${userIdx}-${Math.floor(Math.random() * 999)}]`,
    });
    res = http.patch(`${BASE_URL}/api/v1/chat-sessions/${sId}`, payload, {
      headers: authHeaders,
      timeout: '2s',
      tags: { endpoint: 'session_rename' },
    });
    SessionRenameDuration.add(res.timings.duration);
    ok = check(res, {
      'session_rename 200': (r) => r.status === 200,
    });
  } else {
    // 5%: PATCH /api/v1/auth/me (Profile update write)
    const payload = JSON.stringify({
      display_name: `Researcher VU ${userIdx}`,
    });
    res = http.patch(`${BASE_URL}/api/v1/auth/me`, payload, {
      headers: authHeaders,
      timeout: '2s',
      tags: { endpoint: 'profile_patch' },
    });
    ProfilePatchDuration.add(res.timings.duration);
    ok = check(res, {
      'profile_patch 200': (r) => r.status === 200,
    });
  }

  const dur = res.timings.duration;
  if (dur > 500) {
    SlaBreaches500ms.add(1);
  }
  ProdErrors.add(!ok);
}
