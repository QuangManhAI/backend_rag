// Seeds a THROWAWAY MongoDB for the load tests and writes the k6 pool. Refuses any database whose
// name is not `rag_ts_loadtest`, so it cannot touch real data.
// Env: LOADTEST_MONGO_URI, JWT_ACCESS_SECRET, CORPUS_MONGO_URI, LOADTEST_POOL (output path).
import { randomBytes, randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';

const { LOADTEST_MONGO_URI, JWT_ACCESS_SECRET, CORPUS_MONGO_URI, LOADTEST_POOL } = process.env;
const USERS = Number(process.env.SEED_USERS ?? 1000);
const SESSIONS = 15; // more than one page (10)
const MESSAGES = 10;
const PAPERS = 3000;

const uuidv7 = (ms) => {
  const b = randomBytes(16);
  b.writeUIntBE(ms, 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const client = new MongoClient(LOADTEST_MONGO_URI);
await client.connect();
const db = client.db();
if (db.databaseName !== 'rag_ts_loadtest') throw new Error(`refusing database ${db.databaseName}`);

const password = randomBytes(18).toString('base64url');
const password_hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
const now = Date.now() - 3_600_000;
const users = [];
const pool = { password, users: [], papers: [] };
for (let i = 0; i < USERS; i++) {
  const _id = new ObjectId();
  const d = new Date(now);
  users.push({ _id, email: `load_${i}@loadtest.invalid`, password_hash, display_name: `Load ${i}`, roles: ['user'], is_active: true, disabled_at: null, disabled_by: null, disabled_reason: null, token_version: 0, last_login_at: null, created_at: d, updated_at: d });
}
await db.collection('users').insertMany(users);
const chunk = { chunk_id: 'x_sec0', paper_id: 'x', title: 'A seeded paper title', section_title: 'Method', section_type: 'method', text: 'Seeded context. '.repeat(120), similarity_score: 0.8, authority_score: 0.1, final_score: 0.7, citation_tag: '[Paper: x]' };
let sessions = [];
let messages = [];
const flush = async () => {
  if (sessions.length) await db.collection('chat_sessions').insertMany(sessions);
  if (messages.length) await db.collection('chat_messages').insertMany(messages);
  sessions = [];
  messages = [];
};
for (const [i, u] of users.entries()) {
  const ids = [];
  for (let s = 0; s < SESSIONS; s++) {
    const ts = now + s * 60_000 + i;
    const sid = uuidv7(ts);
    ids.push(sid);
    const last = new Date(ts + MESSAGES * 1000);
    sessions.push({ _id: sid, user_id: u._id, title: `Transformer attention review ${i}-${s}`, message_count: MESSAGES, last_message_at: last, deleted_at: null, created_at: new Date(ts), updated_at: last });
    for (let m = 0; m < MESSAGES; m++) {
      const at = new Date(ts + (m + 1) * 1000);
      const base = { _id: uuidv7(at.getTime()), session_id: sid, deleted_at: null, created_at: at, updated_at: at };
      messages.push(m % 2 === 0
        ? { ...base, role: 'user', content: 'Explain how the attention mechanism scales with sequence length.' }
        : { ...base, role: 'assistant', content: 'Based on the retrieved literature [Paper: x], attention cost grows quadratically. '.repeat(8), citations: ['x'], grounded_chunks: [chunk, chunk, chunk, chunk, chunk], timings: { embed_ms: 20, route_ms: 0, search_ms: 30, rerank_ms: 5, llm_ms: 20000, total_ms: 20060 } });
    }
  }
  pool.users.push({ id: u._id.toString(), email: u.email, sessions: ids, token: jwt.sign({ sub: u._id.toString(), roles: ['user'], ver: 0, jti: randomUUID() }, JWT_ACCESS_SECRET, { expiresIn: '24h' }) });
  if (i % 100 === 99) await flush();
}
await flush();

const corpus = new MongoClient(CORPUS_MONGO_URI);
await corpus.connect();
const rows = await corpus.db('rag_ts_corpus').collection('paper_chunks').aggregate([{ $sample: { size: PAPERS * 2 } }, { $group: { _id: '$paper_id' } }, { $limit: PAPERS }]).toArray();
pool.papers = rows.map((r) => r._id);
await corpus.close();
writeFileSync(LOADTEST_POOL, JSON.stringify(pool));
console.log(`seeded users=${USERS} sessions=${USERS * SESSIONS} messages=${USERS * SESSIONS * MESSAGES} papers=${pool.papers.length}`);
await client.close();
