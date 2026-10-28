import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const RagChatDuration = new Trend('rag_chat_duration', true);
export const RagChatSuccessDuration = new Trend('rag_chat_success_duration', true);
export const RagChatErrors = new Rate('rag_chat_errors');
export const QueueOverflow429 = new Counter('rag_queue_overflow_429');
export const Success200 = new Counter('rag_success_200');

export const options = {
  scenarios: {
    rag_stress_ramp: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 1 },  // Baseline single user (no queuing: ~10-15s)
        { duration: '30s', target: 3 },  // Moderate load (under queue limit: queued latency ~15-30s)
        { duration: '35s', target: 6 },  // Heavy load (approaching queue limit 8)
        { duration: '40s', target: 10 }, // Overflow stage (exceeds 1 active + 8 queued = 9)
        { duration: '35s', target: 14 }, // Severe saturation cliff (consistent 429s)
        { duration: '20s', target: 1 },  // Recovery stage
        { duration: '10s', target: 0 },  // Cool-down
      ],
      gracefulRampDown: '20s',
    },
  },
  thresholds: {
    'rag_chat_success_duration': ['p(95)<60000'], // SLA for served requests: P95 < 60s
  },
};

const SAMPLE_QUERIES = [
  'What is machine learning?',
  'Explain the difference between supervised and unsupervised learning.',
  'How does neural network backpropagation work?',
  'What are the limitations of transformer attention?',
  'Summarize the core architectural benefits of deep residual learning.',
];

export default function () {
  const query = SAMPLE_QUERIES[Math.floor(Math.random() * SAMPLE_QUERIES.length)];
  const payload = JSON.stringify({
    query: query,
    top_k: 2,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    timeout: '120s',
    tags: { scenario: 'rag_chat' },
  };

  const startTime = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/rag/chat`, payload, params);
  const duration = Date.now() - startTime;

  RagChatDuration.add(duration);

  if (res.status === 200) {
    Success200.add(1);
    RagChatErrors.add(0);
    RagChatSuccessDuration.add(duration);
    check(res, {
      'status is 200': (r) => r.status === 200,
      'has answer': (r) => {
        try {
          const body = JSON.parse(r.body);
          return !!body.answer && body.answer.length > 0;
        } catch (e) {
          return false;
        }
      },
    });
    // Normal user pacing after a successful response
    sleep(1.0);
  } else if (res.status === 429) {
    // Expected queue overflow: LLM queue is full
    QueueOverflow429.add(1);
    RagChatErrors.add(1);
    check(res, {
      'status is 429 queue overflow': (r) => r.status === 429,
    });
    // Backoff pacing when throttled/queued out
    sleep(3.0);
  } else {
    RagChatErrors.add(1);
    check(res, {
      'unexpected error status': (r) => false,
    });
    sleep(2.0);
  }
}
