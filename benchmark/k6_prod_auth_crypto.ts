import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Trend, Rate } from 'k6/metrics';

// @ts-ignore
const userPool = JSON.parse(open('./auth_bench_pool_100.json'));
const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const BENCH_PASSWORD = __ENV.BENCH_PASSWORD || 'BenchPass123!';

export const LoginArgon2Duration = new Trend('auth_login_argon2_duration', true);
export const RefreshRotateDuration = new Trend('auth_refresh_rotate_duration', true);
export const AuthMeProbeDuration = new Trend('auth_me_probe_duration', true);
export const CryptoErrorRate = new Rate('auth_crypto_errors');

export const options = {
  scenarios: {
    argon2_login_and_refresh: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '15s', target: 10 }, // 10 concurrent logins/refreshes
        { duration: '20s', target: 25 }, // 25 concurrent logins/refreshes
        { duration: '20s', target: 50 }, // 50 concurrent logins/refreshes
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.02'],
  },
};

export default function () {
  const userIdx = (exec.vu.idInTest - 1) % userPool.length;
  const user = userPool[userIdx];
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  // Step 1: POST /api/v1/auth/login (Argon2id verification + family token issuance)
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      email: user.email,
      password: BENCH_PASSWORD,
    }),
    { headers, timeout: '5s', tags: { endpoint: 'auth_login' } },
  );
  LoginArgon2Duration.add(loginRes.timings.duration);

  let refreshToken = null;
  let accessToken = null;
  const loginOk = check(loginRes, {
    'login 200': (r) => r.status === 200,
    'login returns tokens': (r) => {
      try {
        const b = JSON.parse(r.body);
        refreshToken = b.refresh_token;
        accessToken = b.access_token;
        return typeof refreshToken === 'string' && typeof accessToken === 'string';
      } catch (_) {
        return false;
      }
    },
  });

  if (!loginOk || !refreshToken) {
    CryptoErrorRate.add(true);
    sleep(0.2);
    return;
  }

  // Step 2: Probe Event Loop Responsiveness via lightweight GET /api/v1/auth/me while Argon2id is active
  const meRes = http.get(`${BASE_URL}/api/v1/auth/me`, {
    headers: {
      ...headers,
      'Authorization': `Bearer ${accessToken}`,
    },
    timeout: '2s',
    tags: { endpoint: 'auth_me_probe' },
  });
  AuthMeProbeDuration.add(meRes.timings.duration);

  // Step 3: POST /api/v1/auth/refresh (SHA-256 token lookup, single-use consume, family rotation)
  const refreshRes = http.post(
    `${BASE_URL}/api/v1/auth/refresh`,
    JSON.stringify({ refresh_token: refreshToken }),
    { headers, timeout: '5s', tags: { endpoint: 'auth_refresh' } },
  );
  RefreshRotateDuration.add(refreshRes.timings.duration);

  const refreshOk = check(refreshRes, {
    'refresh 200': (r) => r.status === 200,
    'refresh rotates token': (r) => {
      try {
        const b = JSON.parse(r.body);
        return typeof b.refresh_token === 'string' && b.refresh_token !== refreshToken;
      } catch (_) {
        return false;
      }
    },
  });

  CryptoErrorRate.add(!(loginOk && refreshOk));
  sleep(0.1);
}
