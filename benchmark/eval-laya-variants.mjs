// Replays the pools saved by eval-laya.mjs (EVAL_OUT) with other ways of asking Laya. Read-only.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MongoClient } from 'mongodb';
import { Laya } from '@receptron/laya';

const E = process.env;
const saved = JSON.parse(readFileSync(E.EVAL_OUT, 'utf8')).positives;
const mongo = new MongoClient(E.CORPUS_MONGO_URI);
await mongo.connect();
const db = mongo.db('rag_ts_corpus');
const laya = await Laya.load({ modelDir: resolve(E.LAYA_MODEL_DIR) });

const VARIANTS = {
  'noul, TypedRank wording': async (q, passage) =>
    (await laya.systemOne({ query: q, candidate: passage }, { q: { type: 'noul', instructions: 'The candidate directly helps answer or satisfy the query.' } })).answers.q.noul,
  'score 0-3': async (q, passage) =>
    (await laya.systemOne({ query: q, candidate: passage }, { q: { type: 'score', instructions: 'How well does the candidate answer the query?', criteria: ['unrelated', 'same topic, no answer', 'partly answers', 'directly answers'] } })).answers.q.score,
};
const SIZE = 10;
const rankIn = (order, gold) => order.indexOf(gold) + 1;
const line = (name, ranks) => console.log(name.padEnd(28), 'hit@1', `${ranks.filter((r) => r === 1).length}/${ranks.length}`.padStart(6), 'hit@5', `${ranks.filter((r) => r && r <= 5).length}/${ranks.length}`.padStart(6), 'MRR', (ranks.reduce((a, r) => a + (r ? 1 / r : 0), 0) / ranks.length).toFixed(3));
const byScore = (ids, s) => ids.map((id, i) => [id, s[i], i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]);
const rrf = (ids, s) => { const o = byScore(ids, s); return [...ids].map((id, i) => [id, 1 / (60 + i + 1) + 1 / (60 + o.indexOf(id) + 1), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]); };

const runs = Object.fromEntries(Object.keys(VARIANTS).map((k) => [k, []]));
for (const p of saved) {
  const ids = p.ids.slice(0, SIZE);
  const docs = await db.collection('paper_chunks').find({ _id: { $in: ids } }).toArray();
  const pap = await db.collection('papers').find({ _id: { $in: [...new Set(docs.map((d) => d.paper_id))] } }, { projection: { title: 1 } }).toArray();
  const title = new Map(pap.map((x) => [x._id, x.title ?? '']));
  const text = new Map(docs.map((d) => [d._id, `${[title.get(d.paper_id), d.section_title].filter(Boolean).join(' — ')}\n${d.text}`]));
  for (const [k, f] of Object.entries(VARIANTS)) {
    const s = [];
    for (const id of ids) s.push(await f(p.q, text.get(id)));
    runs[k].push({ ids, s, gold: p.gold });
  }
}
const base = saved.map((p) => ({ ids: p.ids.slice(0, SIZE), s: p.scores.slice(0, SIZE), gold: p.gold }));
console.log(`Top ${SIZE} of the same ${saved.length} questions`);
line('vector', base.map((r) => rankIn(r.ids, r.gold)));
line('noul, our wording', base.map((r) => rankIn(byScore(r.ids, r.s), r.gold)));
line('vector + noul (RRF)', base.map((r) => rankIn(rrf(r.ids, r.s), r.gold)));
for (const [k, rs] of Object.entries(runs)) {
  line(k, rs.map((r) => rankIn(byScore(r.ids, r.s), r.gold)));
  line(`vector + ${k} (RRF)`.slice(0, 28), rs.map((r) => rankIn(rrf(r.ids, r.s), r.gold)));
}
await laya.close();
await mongo.close();
