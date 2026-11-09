/**
 * benchmark-vector-runner.mjs
 * ---------------------------
 * Pure Vector RAG Benchmark Runner (No Rerank, No Laya) using Nomic-embed-text-v1.5
 * on the exact same 150 test samples from test_set_v1.jsonl.
 * 
 * Flow:
 * 1. Nomic v1.5 Cosine Similarity Ranking (Tier 1: 100 Pos + 50 Neg)
 * 2. Qwen 2.5-7B Instruct Answer Generation using Top-1 Vector Context
 * 3. Export to logs/benchmarks/vector_eval_cases.json for DeepEval judging
 */

import fs from 'fs';
import path from 'path';

const DATASET_PATH = 'C:/Users/TDV/Downloads/test_set_v1.jsonl';
const QWEN_URL = 'http://127.0.0.1:9001/v1/chat/completions';
const EMBED_MODEL = 'nomic-ai/nomic-embed-text-v1.5';
const QUERY_PREFIX = 'search_query: ';
const DOC_PREFIX = 'search_document: ';

// Pseudo-random deterministic shuffle (exact same as Laya benchmark)
function seededShuffle(arr, seed) {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Dot product between two L2-normalized vectors = cosine similarity
function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

async function callQwen(systemPrompt, userPrompt) {
  try {
    const res = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 384
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[Qwen Call Error]:', err.message);
    return 'Lỗi sinh câu trả lời từ Qwen.';
  }
}

async function main() {
  console.log('================================================================');
  console.log('🚀 PURE VECTOR RAG BENCHMARK RUNNER (Nomic v1.5 Cosine Search)');
  console.log('Mode: FULL (150 cases: 100 Pos + 50 Neg) - No Reranker, No Laya');
  console.log('================================================================');

  // 1. Verify Qwen Server
  console.log('[1/4] Checking Local Qwen Server at port 9001...');
  try {
    const ping = await fetch('http://127.0.0.1:9001/v1/models');
    if (!ping.ok) throw new Error(`Status ${ping.status}`);
    console.log('  ✓ Local Qwen Server is online on port 9001.');
  } catch (e) {
    console.error('  ✗ Qwen Server is offline. Please start serve-qwen-judge.mjs first.');
    process.exit(1);
  }

  // 2. Load Nomic Embedder
  console.log('\n[2/4] Loading Nomic Embedder via @huggingface/transformers...');
  const { pipeline } = await import('@huggingface/transformers');
  const extractor = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'fp32' });
  console.log('  ✓ Nomic-embed-text-v1.5 extractor initialized.');

  async function getEmbedding(text, prefix = '') {
    const cleaned = text.trim().replace(/\s+/g, ' ');
    const out = await extractor(prefix + cleaned, { pooling: 'mean', normalize: true });
    return out.data;
  }

  // 3. Load Dataset
  console.log(`\n[3/4] Reading dataset: ${DATASET_PATH}`);
  const rawLines = fs.readFileSync(DATASET_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const posCases = rawLines.filter(r => r.kind === 'positive');
  const negCases = rawLines.filter(r => r.kind === 'negative');
  console.log(`  Loaded ${posCases.length} Positive cases and ${negCases.length} Negative cases.`);

  // 4. Run Benchmark Loop
  console.log('\n[4/4] Executing Pure Vector Ranking & Qwen Generation...');
  const stats = {
    mrr: 0,
    hit1: 0,
    hit3: 0,
    hit5: 0,
    totalTargetScore: 0,
    latencies: [],
    negScores: [],
    negRejected5: 0,
    negRejected6: 0,
    negRejected7: 0
  };

  const detailedCases = [];

  // --- POSITIVE CASES (10-Candidate Pool Reranking) ---
  console.log('\n--- Evaluating Positive Cases (10-Candidate Pool Pure Vector Ranking) ---');
  for (let i = 0; i < posCases.length; i++) {
    const item = posCases[i];
    const targetQuote = item.quote;

    // Build 10 candidate passages: 1 gold + 9 distractors (exact same selection)
    const candidates = [
      { id: item.gold_chunk, text: targetQuote, isTarget: true }
    ];
    for (let d = 1; d <= 9; d++) {
      const distractorItem = posCases[(i + d * 7) % posCases.length];
      candidates.push({
        id: distractorItem.gold_chunk,
        text: distractorItem.quote,
        isTarget: false
      });
    }

    const shuffled = seededShuffle(candidates, i * 42 + 7);

    const t0 = performance.now();
    // Embed query
    const qVec = await getEmbedding(item.question, QUERY_PREFIX);

    // Embed all 10 candidates & compute cosine similarity
    const scoredCandidates = [];
    for (const c of shuffled) {
      const docVec = await getEmbedding(c.text, DOC_PREFIX);
      const score = dotProduct(qVec, docVec);
      scoredCandidates.push({ ...c, score });
    }
    const latency = performance.now() - t0;
    stats.latencies.push(latency);

    // Rank candidates by cosine similarity descending
    const ranked = [...scoredCandidates].sort((a, b) => b.score - a.score);
    const targetRank = ranked.findIndex(c => c.isTarget) + 1;
    const targetScore = ranked.find(c => c.isTarget).score;

    stats.mrr += 1 / targetRank;
    if (targetRank === 1) stats.hit1++;
    if (targetRank <= 3) stats.hit3++;
    if (targetRank <= 5) stats.hit5++;
    stats.totalTargetScore += targetScore;

    // Synthesize Answer using Top-1 Chunk Context via Qwen 7B
    const topContext = ranked[0].text;
    const sysPrompt = "You are a scientific research assistant. Answer the user question based strictly on the provided context.";
    const userPrompt = `Context:\n${topContext}\n\nQuestion: ${item.question}\nAnswer:`;
    const answer = await callQwen(sysPrompt, userPrompt);

    detailedCases.push({
      id: item.id,
      kind: 'positive',
      question: item.question,
      reference: item.reference,
      gold_chunk: item.gold_chunk,
      vector: {
        rank: targetRank,
        targetScore,
        top1Chunk: ranked[0].id,
        context: topContext,
        answer,
        latencyMs: latency
      }
    });

    console.log(`  [Pos ${i + 1}/${posCases.length}] ${item.id} | Vector Rank: #${targetRank} (Score: ${targetScore.toFixed(4)}) | Top-1: ${ranked[0].id}`);
  }

  // --- NEGATIVE CASES (Off-Topic Cosine Similarity) ---
  console.log('\n--- Evaluating Negative Cases (Off-Topic Cosine Similarity) ---');
  for (let j = 0; j < negCases.length; j++) {
    const item = negCases[j];
    const sampleSciPassage = posCases[j % posCases.length].quote;

    const qVec = await getEmbedding(item.question, QUERY_PREFIX);
    const docVec = await getEmbedding(sampleSciPassage, DOC_PREFIX);
    const score = dotProduct(qVec, docVec);

    stats.negScores.push(score);
    if (score < 0.5) stats.negRejected5++;
    if (score < 0.6) stats.negRejected6++;
    if (score < 0.7) stats.negRejected7++;

    detailedCases.push({
      id: item.id,
      kind: 'negative',
      question: item.question,
      unrelated_passage: sampleSciPassage,
      vector: {
        score,
        rejectedAt05: score < 0.5,
        rejectedAt06: score < 0.6,
        rejectedAt07: score < 0.7
      }
    });

    console.log(`  [Neg ${j + 1}/${negCases.length}] ${item.id} | Vector Cosine: ${score.toFixed(4)} | Rejected @0.5: ${score < 0.5}`);
  }

  // Calculations
  const N_pos = posCases.length;
  const N_neg = negCases.length;

  const summary = {
    mode: 'FULL',
    evaluatedAt: new Date().toISOString(),
    totalCases: N_pos + N_neg,
    positiveCount: N_pos,
    negativeCount: N_neg,
    metrics: {
      vector: {
        mrr: stats.mrr / N_pos,
        hit1: stats.hit1 / N_pos,
        hit3: stats.hit3 / N_pos,
        hit5: stats.hit5 / N_pos,
        avgTargetCosine: stats.totalTargetScore / N_pos,
        avgLatencyMs: stats.latencies.reduce((a, b) => a + b, 0) / N_pos,
        avgNegCosine: stats.negScores.reduce((a, b) => a + b, 0) / N_neg,
        negRejectionRate05: stats.negRejected5 / N_neg,
        negRejectionRate06: stats.negRejected6 / N_neg,
        negRejectionRate07: stats.negRejected7 / N_neg
      }
    }
  };

  // Save intermediate cases for DeepEval Python step
  const outDir = 'C:/document/Study documents/Uth-Data-Mining/logs/benchmarks';
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'vector_eval_cases.json');
  fs.writeFileSync(outFile, JSON.stringify({ summary, cases: detailedCases }, null, 2), 'utf8');

  // Also save to backend_rag/benchmark/results/
  const repoResultsDir = path.resolve('benchmark/results');
  fs.mkdirSync(repoResultsDir, { recursive: true });
  fs.writeFileSync(path.join(repoResultsDir, 'vector_eval_cases.json'), JSON.stringify({ summary, cases: detailedCases }, null, 2), 'utf8');

  console.log('\n================================================================');
  console.log('🏆 PURE VECTOR RAG TIER 1 BENCHMARK SUMMARY:');
  console.log('================================================================');
  console.table({
    'MRR@10': { 'Pure Vector (Nomic)': summary.metrics.vector.mrr.toFixed(4) },
    'Hit@1 (Top-1)': { 'Pure Vector (Nomic)': `${(summary.metrics.vector.hit1 * 100).toFixed(1)}%` },
    'Hit@3 (Top-3)': { 'Pure Vector (Nomic)': `${(summary.metrics.vector.hit3 * 100).toFixed(1)}%` },
    'Hit@5 (Top-5)': { 'Pure Vector (Nomic)': `${(summary.metrics.vector.hit5 * 100).toFixed(1)}%` },
    'Avg Target Cosine': { 'Pure Vector (Nomic)': summary.metrics.vector.avgTargetCosine.toFixed(4) },
    'Avg Neg Cosine': { 'Pure Vector (Nomic)': summary.metrics.vector.avgNegCosine.toFixed(4) },
    'Off-topic Reject @0.5': { 'Pure Vector (Nomic)': `${(summary.metrics.vector.negRejectionRate05 * 100).toFixed(1)}%` },
    'Off-topic Reject @0.6': { 'Pure Vector (Nomic)': `${(summary.metrics.vector.negRejectionRate06 * 100).toFixed(1)}%` },
    'Avg Latency (ms)': { 'Pure Vector (Nomic)': `${summary.metrics.vector.avgLatencyMs.toFixed(1)} ms` }
  });

  console.log(`\n✓ Vector evaluation cases saved to: ${outFile}`);
  console.log(`Ready for DeepEval Local Qwen judging.`);
}

main().catch(err => {
  console.error('Fatal Runner Error:', err);
  process.exit(1);
});
