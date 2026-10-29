const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://app_user:YqihzvCaDSkqGQEoR8xWwVZ3@127.0.0.1:27017/rag_ts?authSource=admin&directConnection=true';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'rag-ts-dev-access-secret-32-chars-minimum-token';

const NUM_USERS = 100;
const SESSIONS_PER_USER = 15; // > 10 (SESSION_PAGE_SIZE) to exercise Page 1 + Page 2 cursor pagination
const MESSAGES_PER_SESSION = 10; // 5 user + 5 assistant exchanges with realistic citations & grounded chunks

function uuidv7(now = Date.now()) {
  const b = crypto.randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

const SESSION_TITLES = [
  'Transformer Self-Attention Complexity & FlashAttention',
  'LoRA & QLoRA Parameter-Efficient Fine-Tuning Analysis',
  'Co-Authorship Graph PageRank Reranking in Scientific RAG',
  'Dense Passage Retrieval vs Cross-Encoder Reranking Tradeoffs',
  'Hierarchical Navigable Small World (HNSW) Indexing in Qdrant',
  'Diffusion Models for Medical Image Segmentation',
  'Sim2Real Domain Randomization in Robotic Manipulation',
  'Direct Preference Optimization (DPO) vs RLHF Stability',
  'Speculative Decoding for Low-Latency LLM Inference',
  'Vision Transformer (ViT) Patch Embedding Scaling Laws',
  'Retrieval-Augmented Generation Citation Faithfulness',
  'Quantization-Aware Training vs GGUF K-Quants (Q4_K_M)',
  'Graph Neural Networks for Molecular Property Prediction',
  'Long-Context RoPE Scaling & Positional Interpolation',
  'Mixture-of-Experts (MoE) Load Balancing & Routing',
];

const SAMPLE_GROUNDED_CHUNKS = [
  {
    chunk_id: 'arxiv:2106.09685#chunk-03',
    paper_id: 'arxiv:2106.09685',
    title: 'LoRA: Low-Rank Adaptation of Large Language Models',
    authors: ['Edward J. Hu', 'Yelong Shen', 'Phillip Wallis', 'Zeyuan Allen-Zhu'],
    year: 2021,
    venue: 'ICLR 2022',
    score: 0.914,
    authority: 0.872,
    text: 'We propose Low-Rank Adaptation, or LoRA, which freezes the pretrained model weights and injects trainable rank decomposition matrices into each layer of the Transformer architecture, greatly reducing the number of trainable parameters for downstream tasks.',
  },
  {
    chunk_id: 'arxiv:2005.11401#chunk-01',
    paper_id: 'arxiv:2005.11401',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    authors: ['Patrick Lewis', 'Ethan Perez', 'Aleksandra Piktus', 'Sebastian Riedel'],
    year: 2020,
    venue: 'NeurIPS 2020',
    score: 0.889,
    authority: 0.935,
    text: 'We explore a general-purpose fine-tuning recipe for retrieval-augmented generation (RAG) — models which combine pre-trained parametric and non-parametric memory for language generation.',
  },
];

async function run() {
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;

  const usersCol = db.collection('users');
  const sessionsCol = db.collection('chat_sessions');
  const messagesCol = db.collection('chat_messages');

  const emails = Array.from({ length: NUM_USERS }, (_, i) => `vu_bench_${i}@bench.test`);
  const existingUsers = await usersCol.find({ email: { $in: emails } }).toArray();
  console.log(`Found ${existingUsers.length}/${NUM_USERS} benchmark users in MongoDB.`);

  if (existingUsers.length < NUM_USERS) {
    throw new Error(`Expected ${NUM_USERS} benchmark users, found ${existingUsers.length}`);
  }

  // Sort users by index 0..99
  existingUsers.sort((a, b) => {
    const idxA = parseInt(a.email.split('_')[2], 10);
    const idxB = parseInt(b.email.split('_')[2], 10);
    return idxA - idxB;
  });

  const userIds = existingUsers.map((u) => u._id);

  // Clean up previous benchmark sessions & messages for these 100 users
  console.log('Cleaning old benchmark sessions & messages for deterministic seeding...');
  const oldSessions = await sessionsCol.find({ user_id: { $in: userIds } }, { projection: { _id: 1 } }).toArray();
  const oldSessionIds = oldSessions.map((s) => s._id);
  if (oldSessionIds.length > 0) {
    await messagesCol.deleteMany({ session_id: { $in: oldSessionIds } });
    await sessionsCol.deleteMany({ user_id: { $in: userIds } });
  }

  const baseNow = Date.now() - 3600 * 1000; // 1 hour ago
  const allSessions = [];
  const allMessages = [];
  const pool = [];

  for (let uIdx = 0; uIdx < existingUsers.length; uIdx++) {
    const u = existingUsers[uIdx];
    const sessionIds = [];
    const userSessions = [];

    for (let sIdx = 0; sIdx < SESSIONS_PER_USER; sIdx++) {
      // Strictly increasing timestamps so sort({ last_message_at: -1, _id: -1 }) is deterministic
      const sessionTs = baseNow + sIdx * 60000 + uIdx * 100;
      const sId = uuidv7(sessionTs);
      const lastMsgDate = new Date(sessionTs + MESSAGES_PER_SESSION * 1000);
      const createdDate = new Date(sessionTs);

      const sessionDoc = {
        _id: sId,
        user_id: u._id,
        title: `${SESSION_TITLES[sIdx % SESSION_TITLES.length]} [U${uIdx}-S${sIdx + 1}]`,
        message_count: MESSAGES_PER_SESSION,
        last_message_at: lastMsgDate,
        deleted_at: null,
        created_at: createdDate,
        updated_at: lastMsgDate,
      };

      userSessions.push(sessionDoc);
      allSessions.push(sessionDoc);
      sessionIds.push(sId);

      // Generate 10 messages (5 user + 5 assistant) for this session
      for (let mIdx = 0; mIdx < MESSAGES_PER_SESSION; mIdx++) {
        const msgTs = sessionTs + (mIdx + 1) * 1000;
        const mId = uuidv7(msgTs);
        const msgDate = new Date(msgTs);
        const isAssistant = mIdx % 2 === 1;

        if (!isAssistant) {
          allMessages.push({
            _id: mId,
            session_id: sId,
            role: 'user',
            content: `Explain the mathematical formulation and empirical latency impact of ${SESSION_TITLES[sIdx % SESSION_TITLES.length]} (turn ${Math.floor(mIdx / 2) + 1}).`,
            deleted_at: null,
            created_at: msgDate,
            updated_at: msgDate,
          });
        } else {
          allMessages.push({
            _id: mId,
            session_id: sId,
            role: 'assistant',
            content:
              `Based on the retrieved literature [arxiv:2106.09685, arxiv:2005.11401], the low-rank decomposition $W_0 + \\Delta W = W_0 + BA$ constrains the update to rank $r \\ll \\min(d, k)$. ` +
              `In empirical benchmarks, this reduces VRAM consumption by up to 68% while maintaining within 0.3% of full fine-tuning accuracy across GLUE and scientific QA tasks. ` +
              `Furthermore, combining dense vector cosine similarity ($0.85$) with Co-Authorship PageRank authority ($0.15$) improves Recall@5 to 73.08% with zero citation hallucination.`,
            citations: ['arxiv:2106.09685', 'arxiv:2005.11401'],
            grounded_chunks: SAMPLE_GROUNDED_CHUNKS,
            timings: {
              embed_ms: 18.4,
              retrieval_ms: 24.7,
              rerank_ms: 6.2,
              llm_ms: 842.5,
              total_ms: 891.8,
            },
            deleted_at: null,
            created_at: msgDate,
            updated_at: msgDate,
          });
        }
      }
    }

    // Sort descending by last_message_at to find the 10th session (index 9) for Page 1 -> Page 2 cursor
    userSessions.sort((a, b) => b.last_message_at.getTime() - a.last_message_at.getTime());
    const tenthSession = userSessions[9]; // 0-indexed 9th is the 10th item on Page 1
    const page1Cursor = encodeCursor({
      m: tenthSession.last_message_at.toISOString(),
      id: tenthSession._id,
    });

    const token = jwt.sign(
      { sub: u._id.toString(), roles: ['user'] },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    pool.push({
      id: u._id.toString(),
      email: u.email,
      token,
      sessionIds,
      page1Cursor,
    });
  }

  console.log(`Bulk inserting ${allSessions.length} chat_sessions...`);
  await sessionsCol.insertMany(allSessions, { ordered: false });

  console.log(`Bulk inserting ${allMessages.length} chat_messages in chunks of 5,000...`);
  for (let i = 0; i < allMessages.length; i += 5000) {
    await messagesCol.insertMany(allMessages.slice(i, i + 5000), { ordered: false });
  }

  const outPath = path.resolve(__dirname, 'auth_bench_pool_100.json');
  fs.writeFileSync(outPath, JSON.stringify(pool, null, 2), 'utf-8');
  console.log(`Successfully seeded ${allSessions.length} sessions, ${allMessages.length} messages, and wrote ${outPath}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seeding error:', err);
  process.exit(1);
});
