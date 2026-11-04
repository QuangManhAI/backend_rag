// Compares the vector ranking with Laya's reranking on benchmark/laya-eval-set.json, and sweeps the
// evidence and groundedness thresholds. Read-only: `node benchmark/eval-laya.mjs` from backend_rag/
// with QDRANT_URL, QDRANT_API_KEY, CORPUS_MONGO_URI, EMBEDDING_MODEL and LAYA_MODEL_DIR set.
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { MongoClient } from 'mongodb';
import { pipeline } from '@huggingface/transformers';
import { Laya } from '@receptron/laya';

const E = process.env;
const set = JSON.parse(readFileSync('benchmark/laya-eval-set.json', 'utf8'));
const RELEVANCE =
  'Does the passage directly answer the question? True only if the passage states the answer. ' +
  'False if it merely shares words or the topic without answering.';
const GROUNDED =
  'Is the answer supported by the evidence passage? True only if the claims in the answer are ' +
  'stated in the evidence. False if the answer adds facts the evidence does not contain.';
const POOLS = [10, 20];

const mongo = new MongoClient(E.CORPUS_MONGO_URI);
await mongo.connect();
const db = mongo.db('rag_ts_corpus');
const extract = await pipeline('feature-extraction', E.EMBEDDING_MODEL, { dtype: 'fp32' });
const laya = await Laya.load({ modelDir: resolve(E.LAYA_MODEL_DIR) });

async function search(q, limit) {
  const v = await extract(`search_query: ${q}`, { pooling: 'mean', normalize: true });
  const r = await fetch(`${E.QDRANT_URL}/collections/${E.QDRANT_COLLECTION ?? 'scientific_papers_gold'}/points/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': E.QDRANT_API_KEY ?? '' },
    body: JSON.stringify({ query: Array.from(v.data), limit, with_payload: true, with_vector: false }),
  });
  const pts = (await r.json()).result.points;
  const ids = pts.map((p) => p.payload.chunk_id);
  const chunks = await db.collection('paper_chunks').find({ _id: { $in: ids } }).toArray();
  const paperIds = [...new Set(chunks.map((c) => c.paper_id))];
  const papers = await db.collection('papers').find({ _id: { $in: paperIds } }, { projection: { title: 1 } }).toArray();
  const title = new Map(papers.map((p) => [p._id, p.title ?? '']));
  const byId = new Map(chunks.map((c) => [c._id, c]));
  return ids.filter((i) => byId.has(i)).map((i) => {
    const c = byId.get(i);
    const head = [title.get(c.paper_id), c.section_title].filter(Boolean).join(' — ');
    return { id: i, passage: head ? `${head}\n${c.text}` : c.text, text: c.text, section: c.section_title, title: title.get(c.paper_id) };
  });
}
let ms = 0, calls = 0;
async function noul(state, instructions) {
  const t = performance.now();
  const r = await laya.systemOne(state, { q: { type: 'noul', instructions } });
  ms += performance.now() - t; calls++;
  return r.answers.q.noul;
}
const rr = (rank) => (rank ? 1 / rank : 0);
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const report = (name, ranks, n) => console.log(name.padEnd(26), 'hit@1', pct(ranks.filter((r) => r === 1).length / n).padStart(6), 'hit@5', pct(ranks.filter((r) => r && r <= 5).length / n).padStart(6), 'MRR', (ranks.reduce((a, r) => a + rr(r), 0) / n).toFixed(3));

const out = { positives: [], negatives: [], groundedness: [] };
const maxPool = Math.max(...POOLS);
for (const [gold, q] of set.positives) {
  const hits = await search(q, 40);
  const pool = hits.slice(0, maxPool);
  const scores = [];
  for (const h of pool) scores.push(await noul({ question: q, passage: h.passage }, RELEVANCE));
  out.positives.push({ gold, q, vectorRank: hits.findIndex((h) => h.id === gold) + 1, ids: pool.map((h) => h.id), scores });
  console.error('pos', out.positives.length);
}
for (const q of set.negatives) {
  const pool = (await search(q, 40)).slice(0, 10);
  const scores = [];
  for (const h of pool) scores.push(await noul({ question: q, passage: h.passage }, RELEVANCE));
  out.negatives.push({ q, scores });
}
for (const [id, q, yes, no] of set.groundedness) {
  const c = await db.collection('paper_chunks').findOne({ _id: id });
  const evidence = c.text.slice(0, 1100);
  out.groundedness.push({ id, yes: await noul({ question: q, answer: yes, evidence }, GROUNDED), no: await noul({ question: q, answer: no, evidence }, GROUNDED) });
}

// Same fusion as fuseRanks in src/rag/rag.service.ts: the vector order plus Laya's, best first.
const fused = (scores) => {
  const byScore = scores.map((_, i) => i).sort((x, y) => scores[y] - scores[x] || x - y);
  return scores.map((_, i) => i).sort((x, y) => 1 / (61 + y) + 1 / (61 + byScore.indexOf(y)) - (1 / (61 + x) + 1 / (61 + byScore.indexOf(x))) || x - y);
};
const n = out.positives.length;
console.log(`\nRanking, ${n} questions, gold chunk known (authority boost off)`);
for (const size of POOLS) {
  const vec = out.positives.map((p) => (p.vectorRank && p.vectorRank <= size ? p.vectorRank : 0));
  const lay = out.positives.map((p) => {
    const idx = p.ids.slice(0, size).map((id, i) => [id, p.scores[i], i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]);
    return idx.findIndex((x) => x[0] === p.gold) + 1;
  });
  const fus = out.positives.map((p) => fused(p.scores.slice(0, size)).findIndex((i) => p.ids[i] === p.gold) + 1);
  report(`vector, top ${size}`, vec, n);
  report(`Laya alone, top ${size}`, lay, n);
  report(`vector + Laya RRF, top ${size}`, fus, n);
}
console.log('gold in top 40:', out.positives.filter((p) => p.vectorRank > 0).length, '/', n);

console.log('\nEvidence gate on the context the LLM reads (fused top 5 of 10)');
const best5 = (scores) => Math.max(...fused(scores.slice(0, 10)).slice(0, 5).map((i) => scores[i]));
for (const t of [0.3, 0.5, 0.6, 0.7, 0.8]) {
  console.log(`t=${t}`.padEnd(8), 'answerable kept', `${out.positives.filter((p) => best5(p.scores) >= t).length}/${n}`.padStart(6), ' unanswerable rejected', `${out.negatives.filter((x) => best5(x.scores) < t).length}/${out.negatives.length}`.padStart(6));
}
console.log('unanswerable kept at 0.6:', out.negatives.filter((x) => best5(x.scores) >= 0.6).map((x) => x.q).join(' | '));

console.log('\nGroundedness gate (supported vs fabricated answers)');
for (const t of [0.1, 0.2, 0.3, 0.5, 0.7]) {
  console.log(`t=${t}`.padEnd(8), 'supported kept', `${out.groundedness.filter((g) => g.yes >= t).length}/${out.groundedness.length}`.padStart(6), ' fabricated rejected', `${out.groundedness.filter((g) => g.no < t).length}/${out.groundedness.length}`.padStart(6));
}
console.log(out.groundedness.map((g) => `${g.yes.toFixed(2)}/${g.no.toFixed(2)}`).join(' '));
console.log(`\nLaya: ${calls} calls, mean ${Math.round(ms / calls)} ms per call`);
if (E.EVAL_OUT) writeFileSync(E.EVAL_OUT, JSON.stringify(out, null, 1));
await laya.close();
await mongo.close();
