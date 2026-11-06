// One load step. Chosen by env: SCN (scenario), then RATE + DURATION (open model: arrivals do not
// slow down when the server does, so there is no coordinated omission) or VUS + DURATION (closed).
// Every response is checked for content, not only for its status. 429 is counted apart from errors.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE = `${__ENV.BASE_URL}/api/v1`;
const SCN = __ENV.SCN;
const data = new SharedArray('pool', () => [JSON.parse(open(__ENV.LOADTEST_POOL))]);
const pool = data[0] as { password: string; users: Array<{ email: string; token: string; sessions: string[] }>; papers: string[] };
const questions = new SharedArray('q', () => (JSON.parse(open(__ENV.EVAL_SET)) as { positives: string[][]; negatives: string[] }).positives.map((p) => p[1]));

const okRate = new Rate('ok');
const bad = new Counter('bad_responses');
const throttled = new Counter('throttled_429');
const unavailable = new Counter('server_5xx');
const trends: Record<string, Trend> = {};
for (const n of ['health', 'live', 'paper', 'papers_batch', 'list', 'page2', 'search', 'detail', 'messages', 'me', 'rename', 'patch_me', 'login', 'rotate', 'chat']) trends[n] = new Trend(`ep_${n}`, true);
const chat = { embed: new Trend('chat_embed_ms'), search: new Trend('chat_search_ms'), rerank: new Trend('chat_rerank_ms'), llm: new Trend('chat_llm_ms'), grounded: new Trend('chat_grounded_ms'), refine: new Trend('chat_refine_ms') };
const abstained = new Counter('chat_abstained');
const answered = new Counter('chat_answered');

const r = Number(__ENV.RATE ?? 0);
export const options = {
  discardResponseBodies: false,
  systemTags: ['status', 'name'],
  scenarios: {
    main: r
      ? { executor: 'constant-arrival-rate', rate: r, timeUnit: '1s', duration: __ENV.DURATION, preAllocatedVUs: Math.min(50 + r, 1500), maxVUs: Math.min(100 + r * 4, 3000), gracefulStop: '10s' }
      : { executor: 'constant-vus', vus: Number(__ENV.VUS), duration: __ENV.DURATION, gracefulStop: SCN === 'chat' ? '180s' : '15s' },
  },
};

const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
/** Anonymous requests come from many clients, so public routes are not capped by one address. */
const randomIp = () => `10.${200 + Math.floor(Math.random() * 50)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
/** Each simulated user is one client address; the server trusts one proxy hop in this test only. */
const ipOf = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
function userParams(i: number, name: string, withToken = true, timeout = '10s') {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Forwarded-For': ipOf(i + 1), 'Content-Type': 'application/json' };
  if (withToken) headers.Authorization = `Bearer ${pool.users[i].token}`;
  return { headers, timeout, tags: { name } };
}
function record(name: string, res: http.RefinedResponse<'text'>, valid: (b: any) => boolean, expected = 200): any {
  trends[name].add(res.timings.duration);
  if (res.status === 429) throttled.add(1);
  if (res.status >= 500 || res.status === 0) unavailable.add(1);
  let body: any = null;
  try { body = res.status === expected ? res.json() : null; } catch { body = null; }
  let good = false;
  try { good = res.status === expected && !!body && valid(body); } catch { good = false; }
  okRate.add(good);
  if (!good) bad.add(1, { name });
  check(res, { [`${name} valid`]: () => good });
  return body;
}
const cursors: Record<number, string> = {};
const refresh: Record<number, string> = {};

function paper(hot: boolean) {
  const id = hot ? pool.papers[Math.floor(Math.random() * 50)] : pick(pool.papers);
  const res = http.get(`${BASE}/papers/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json', 'X-Forwarded-For': randomIp() }, timeout: '10s', tags: { name: 'paper' } });
  record('paper', res, (b) => b.paper_id === id && b.chunks.length > 0 && typeof b.chunks[0].text === 'string' && b.chunks[0].text.length > 0);
}

function crud(i: number) {
  const u = pool.users[i];
  const x = Math.random();
  if (x < 0.3) {
    const b = record('list', http.get(`${BASE}/chat-sessions`, userParams(i, 'list')), (j) => j.items.length === 10);
    if (b?.next_cursor) cursors[i] = b.next_cursor;
  } else if (x < 0.35 && cursors[i]) {
    record('page2', http.get(`${BASE}/chat-sessions?cursor=${encodeURIComponent(cursors[i])}`, userParams(i, 'page2')), (j) => j.items.length > 0);
  } else if (x < 0.4) {
    record('search', http.get(`${BASE}/chat-sessions?q=Transformer`, userParams(i, 'search')), (j) => j.items.length > 0);
  } else if (x < 0.65) {
    const sid = pick(u.sessions);
    record('detail', http.get(`${BASE}/chat-sessions/${sid}`, userParams(i, 'detail')), (j) => j.messages?.length === 10 || j.id === sid || j.session_id === sid);
  } else if (x < 0.7) {
    record('messages', http.get(`${BASE}/chat-sessions/${pick(u.sessions)}/messages`, userParams(i, 'messages')), (j) => j.items.length === 10);
  } else if (x < 0.85) {
    record('me', http.get(`${BASE}/users/me`, userParams(i, 'me')), (j) => j.email === u.email);
  } else if (x < 0.95) {
    const title = `Renamed ${Math.random().toString(36).slice(2, 10)}`;
    record('rename', http.patch(`${BASE}/chat-sessions/${pick(u.sessions)}`, JSON.stringify({ title }), userParams(i, 'rename')), (j) => j.title === title);
  } else {
    const display_name = `Load ${Math.random().toString(36).slice(2, 8)}`;
    record('patch_me', http.patch(`${BASE}/users/me`, JSON.stringify({ display_name }), userParams(i, 'patch_me')), (j) => j.display_name === display_name);
  }
}

function crypto(i: number) {
  if (refresh[i] && Math.random() < 0.7) {
    const b = record('rotate', http.post(`${BASE}/auth/token-rotations`, JSON.stringify({ refresh_token: refresh[i] }), userParams(i, 'rotate', false)), (j) => !!j.access_token, 201);
    if (b) refresh[i] = b.refresh_token; else delete refresh[i];
  } else {
    const b = record('login', http.post(`${BASE}/auth/tokens`, JSON.stringify({ email: pool.users[i].email, password: pool.password }), userParams(i, 'login', false, '30s')), (j) => !!j.access_token, 201);
    if (b) refresh[i] = b.refresh_token;
  }
}

function chatOnce(i: number) {
  const res = http.post(`${BASE}/rag/chat`, JSON.stringify({ query: pick(questions) }), userParams(i, 'chat', true, '180s'));
  const b = record('chat', res, (j) => typeof j.answer === 'string' && j.answer.length > 0);
  if (!b) return;
  const t = b.timings;
  chat.embed.add(t.embed_ms); chat.search.add(t.search_ms); chat.rerank.add(t.rerank_ms); chat.llm.add(t.llm_ms);
  if (t.grounded_ms !== undefined) chat.grounded.add(t.grounded_ms);
  if (t.refine_ms !== undefined) chat.refine.add(t.refine_ms);
  (b.quality?.abstained ? abstained : answered).add(1);
}

export default function () {
  // A closed VU keeps one identity; an open iteration is a random user of the pool.
  const i = r ? Math.floor(Math.random() * pool.users.length) : (__VU - 1) % pool.users.length;
  const anon = { headers: { Accept: 'application/json', 'X-Forwarded-For': randomIp() }, timeout: '10s' };
  switch (SCN) {
    case 'live': record('live', http.get(`${BASE}/health/live`, { ...anon, tags: { name: 'live' } }), (j) => j.status === 'ok' || j.status === 'alive'); break;
    case 'health': record('health', http.get(`${BASE}/health`, { ...anon, tags: { name: 'health' } }), (j) => !!j.components); break;
    case 'papers_hot': paper(true); break;
    case 'papers_cold': paper(false); break;
    case 'crud': crud(i); break;
    case 'crypto': crypto(i); break;
    case 'journey':
      // A person using the app without asking: read history, open papers, think between actions.
      record('me', http.get(`${BASE}/users/me`, userParams(i, 'me')), (j) => j.email === pool.users[i].email); sleep(1 + Math.random() * 2);
      record('list', http.get(`${BASE}/chat-sessions`, userParams(i, 'list')), (j) => j.items.length === 10); sleep(2 + Math.random() * 4);
      record('detail', http.get(`${BASE}/chat-sessions/${pick(pool.users[i].sessions)}`, userParams(i, 'detail')), () => true); sleep(3 + Math.random() * 5);
      paper(Math.random() < 0.7); sleep(4 + Math.random() * 6);
      break;
    case 'chat': chatOnce(i); break;
    default: throw new Error(`unknown scenario ${SCN}`);
  }
}
