import http from 'k6/http';
import { check } from 'k6';
export const options = {
  scenarios: {
    four_parallel: {
      executor: 'per-vu-iterations',
      vus: 4,
      iterations: 1,
      maxDuration: '30s',
    },
  },
};
export default function () {
  const payload = JSON.stringify({ query: 'What is machine learning?', top_k: 2 });
  const params = { headers: { 'Content-Type': 'application/json' }, timeout: '60s' };
  const res = http.post('http://localhost:3000/api/v1/rag/chat', payload, params);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
