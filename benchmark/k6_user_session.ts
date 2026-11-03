import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const BrowseDuration = new Trend('user_session_browse_duration', true);
export const ChatDuration = new Trend('user_session_chat_duration', true);
export const SessionErrors = new Rate('user_session_errors');
export const QueueRejections429 = new Counter('user_session_queue_rejections_429');
export const Timeouts = new Counter('user_session_timeouts');
export const SuccessfulChats = new Counter('user_session_chats_200');
export const TotalSessions = new Counter('user_session_total_completed');

export const options = {
  scenarios: {
    realistic_researcher_sessions: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '30s', target: 10 },  // 10 concurrent researchers
        { duration: '40s', target: 25 },  // 25 concurrent researchers
        { duration: '50s', target: 50 },  // 50 concurrent researchers
        { duration: '60s', target: 80 },  // 80 concurrent researchers
        { duration: '30s', target: 10 },  // Wind down
        { duration: '15s', target: 0 },   // Cool down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'user_session_browse_duration': ['p(95)<300'], // Browse fast SLA: P95 < 300ms
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
  const vuId = __VU;

  // Phase 1: Connect and browse papers (70% traffic)
  group('1_Browse_and_Explore', function () {
    const healthRes = http.get(`${BASE_URL}/api/v1/health`, {
      tags: { action: 'browse_health' },
      timeout: '10s',
    });
    BrowseDuration.add(healthRes.timings.duration);
    check(healthRes, { 'health ok': (r) => r.status === 200 });

    // Browse 2 paper nodes
    const paperRes1 = http.get(`${BASE_URL}/api/v1/papers/openalex%3AW2594538354`, {
      tags: { action: 'browse_paper' },
      timeout: '10s',
    });
    BrowseDuration.add(paperRes1.timings.duration);

    // Human think time: Researcher reads paper abstract
    sleep(Math.random() * 4 + 6); // 6-10s think time
  });

  // Phase 2: First RAG chat inquiry (Heavy GPU inference)
  group('2_First_RAG_Inquiry', function () {
    const query = SAMPLE_QUERIES[Math.floor(Math.random() * SAMPLE_QUERIES.length)];
    const payload = JSON.stringify({ query: query, top_k: 2 });
    const params = {
      headers: { 'Content-Type': 'application/json' },
      timeout: '75s',
      tags: { action: 'chat_query' },
    };

    const chatRes = http.post(`${BASE_URL}/api/v1/rag/chat`, payload, params);
    ChatDuration.add(chatRes.timings.duration);

    if (chatRes.status === 200) {
      SuccessfulChats.add(1);
      SessionErrors.add(0);
      check(chatRes, { 'chat succeeded': (r) => r.status === 200 });
    } else if (chatRes.status === 429) {
      QueueRejections429.add(1);
      SessionErrors.add(1);
      check(chatRes, { 'chat queued out (429)': (r) => r.status === 429 });
    } else if (chatRes.status === 0 || chatRes.status === 504) {
      Timeouts.add(1);
      SessionErrors.add(1);
    } else {
      SessionErrors.add(1);
    }

    // Human reading time: Researcher reviews answer
    sleep(Math.random() * 8 + 12); // 12-20s reading time
  });

  // Phase 3: Browse follow-up
  group('3_Browse_Followup', function () {
    const followPaperRes = http.get(`${BASE_URL}/api/v1/papers/openalex%3AW2594538354`, {
      tags: { action: 'browse_paper' },
      timeout: '10s',
    });
    BrowseDuration.add(followPaperRes.timings.duration);
    sleep(Math.random() * 3 + 2); // 2-5s think time
  });

  TotalSessions.add(1);
}
