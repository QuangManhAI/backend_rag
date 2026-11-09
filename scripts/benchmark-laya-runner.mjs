/**
 * benchmark-laya-runner.mjs
 * -------------------------
 * Tier 1 & Tier 2 Benchmark Runner for Laya New (20261108-seed0) vs Laya Baseline.
 * 
 * Supports:
 *   node scripts/benchmark-laya-runner.mjs --pilot (15 cases: 10 pos + 5 neg)
 *   node scripts/benchmark-laya-runner.mjs --full  (150 cases: 100 pos + 50 neg)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RELEVANCE_QUESTION =
  'Does the passage directly answer the question? True only if the passage states the answer. ' +
  'False if it merely shares words or the topic without answering.';

const DATASET_PATH = 'C:/Users/TDV/Downloads/test_set_v1.jsonl';
const QWEN_URL = 'http://127.0.0.1:9001/v1/chat/completions';
const NEW_MODEL_DIR = resolvePath('../models/laya_onnx_20261108-2053_seed0');

function resolvePath(rel) {
  return path.resolve(rel);
}

// Pseudo-random deterministic shuffle
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
  const args = process.argv.slice(2);
  const isPilot = !args.includes('--full');

  console.log('================================================================');
  console.log(`🚀 LAYA BENCHMARK RUNNER (Tier 1 & Generation Preparation)`);
  console.log(`Mode: ${isPilot ? 'PILOT (15 cases: 10 Pos + 5 Neg)' : 'FULL (150 cases)'}`);
  console.log('================================================================');

  // 1. Verify Qwen Server
  console.log('[1/4] Checking Local Qwen Server at port 9001...');
  try {
    const ping = await fetch('http://127.0.0.1:9001/v1/models');
    if (!ping.ok) throw new Error(`Status ${ping.status}`);
    console.log('  ✓ Local Qwen Server is online and responsive on port 9001.');
  } catch (e) {
    console.error('  ✗ Qwen Server is offline. Please start serve-qwen-judge.mjs first.');
    process.exit(1);
  }

  // 2. Load Models
  console.log('\n[2/4] Loading Laya Models via @receptron/laya...');
  const { Laya } = await import('@receptron/laya');

  console.log('  Loading Baseline Laya (Pretrained)...');
  const baselineLaya = await Laya.load();
  console.log('  ✓ Baseline Laya loaded.');

  console.log('  Loading Fine-Tuned Laya (20261108-seed0)...');
  const newLaya = await Laya.load({ modelDir: NEW_MODEL_DIR });
  console.log('  ✓ Fine-Tuned Laya loaded.');

  // 3. Load Dataset
  console.log(`\n[3/4] Reading dataset: ${DATASET_PATH}`);
  const rawLines = fs.readFileSync(DATASET_PATH, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const allPos = rawLines.filter(r => r.kind === 'positive');
  const allNeg = rawLines.filter(r => r.kind === 'negative');

  const posCases = isPilot ? allPos.slice(0, 10) : allPos;
  const negCases = isPilot ? allNeg.slice(0, 5) : allNeg;

  console.log(`  Loaded ${posCases.length} Positive cases and ${negCases.length} Negative cases.`);

  // 4. Run Benchmark Loop
  console.log('\n[4/4] Executing Tier 1 Ranking & Tier 2 Generation...');

  const stats = {
    baseline: {
      mrr: 0, hit1: 0, hit3: 0, hit5: 0,
      totalRelevanceScore: 0,
      latencies: [],
      negRejected3: 0, negRejected5: 0, negFalseAccept5: 0
    },
    newModel: {
      mrr: 0, hit1: 0, hit3: 0, hit5: 0,
      totalRelevanceScore: 0,
      latencies: [],
      negRejected3: 0, negRejected5: 0, negFalseAccept5: 0
    }
  };

  const detailedCases = [];

  // --- POSITIVE EVALUATION (Ranking) ---
  console.log('\n--- Evaluating Positive Cases (10-Candidate Pool Reranking) ---');
  for (let i = 0; i < posCases.length; i++) {
    const item = posCases[i];
    const targetQuote = item.quote;

    // Build 10 candidate passages: 1 gold + 9 distractors
    const candidates = [
      { id: item.gold_chunk, text: targetQuote, isTarget: true }
    ];
    for (let d = 1; d <= 9; d++) {
      const distractorItem = allPos[(i + d * 7) % allPos.length];
      candidates.push({
        id: distractorItem.gold_chunk,
        text: distractorItem.quote,
        isTarget: false
      });
    }

    const shuffled = seededShuffle(candidates, i * 42 + 7);

    // Score with Baseline Laya
    const t0Base = performance.now();
    const baseScores = [];
    for (const c of shuffled) {
      const res = await baselineLaya.systemOne(
        { question: item.question, passage: c.text },
        { q: { type: 'noul', instructions: RELEVANCE_QUESTION } }
      );
      baseScores.push(res.answers.q.noul);
    }
    const baseLat = performance.now() - t0Base;
    stats.baseline.latencies.push(baseLat);

    // Score with New Laya
    const t0New = performance.now();
    const newScores = [];
    for (const c of shuffled) {
      const res = await newLaya.systemOne(
        { question: item.question, passage: c.text },
        { q: { type: 'noul', instructions: RELEVANCE_QUESTION } }
      );
      newScores.push(res.answers.q.noul);
    }
    const newLat = performance.now() - t0New;
    stats.newModel.latencies.push(newLat);

    // Rank candidates
    const baseRanked = shuffled.map((c, idx) => ({ ...c, score: baseScores[idx] }))
      .sort((a, b) => b.score - a.score);
    const newRanked = shuffled.map((c, idx) => ({ ...c, score: newScores[idx] }))
      .sort((a, b) => b.score - a.score);

    const baseRank = baseRanked.findIndex(c => c.isTarget) + 1;
    const newRank = newRanked.findIndex(c => c.isTarget) + 1;

    // Accumulate Baseline Ranking Stats
    stats.baseline.mrr += 1 / baseRank;
    if (baseRank === 1) stats.baseline.hit1++;
    if (baseRank <= 3) stats.baseline.hit3++;
    if (baseRank <= 5) stats.baseline.hit5++;
    const baseTargetScore = baseRanked.find(c => c.isTarget).score;
    stats.baseline.totalRelevanceScore += baseTargetScore;

    // Accumulate New Model Ranking Stats
    stats.newModel.mrr += 1 / newRank;
    if (newRank === 1) stats.newModel.hit1++;
    if (newRank <= 3) stats.newModel.hit3++;
    if (newRank <= 5) stats.newModel.hit5++;
    const newTargetScore = newRanked.find(c => c.isTarget).score;
    stats.newModel.totalRelevanceScore += newTargetScore;

    // Synthesize Answers using Top-1 Chunk Context via Qwen 7B
    const topContextBase = baseRanked[0].text;
    const topContextNew = newRanked[0].text;

    const sysPrompt = "You are a scientific research assistant. Answer the user question based strictly on the provided context.";
    const userPromptBase = `Context:\n${topContextBase}\n\nQuestion: ${item.question}\nAnswer:`;
    const userPromptNew = `Context:\n${topContextNew}\n\nQuestion: ${item.question}\nAnswer:`;

    const answerBase = await callQwen(sysPrompt, userPromptBase);
    const answerNew = await callQwen(sysPrompt, userPromptNew);

    detailedCases.push({
      id: item.id,
      kind: 'positive',
      question: item.question,
      reference: item.reference,
      gold_chunk: item.gold_chunk,
      baseline: {
        rank: baseRank,
        targetScore: baseTargetScore,
        top1Chunk: baseRanked[0].id,
        context: topContextBase,
        answer: answerBase,
        latencyMs: baseLat
      },
      newModel: {
        rank: newRank,
        targetScore: newTargetScore,
        top1Chunk: newRanked[0].id,
        context: topContextNew,
        answer: answerNew,
        latencyMs: newLat
      }
    });

    console.log(`  [Pos ${i + 1}/${posCases.length}] ${item.id} | Base Rank: #${baseRank} (${baseTargetScore.toFixed(3)}) | New Rank: #${newRank} (${newTargetScore.toFixed(3)}) | Winner: ${newRank <= baseRank ? 'NEW/TIE' : 'BASE'}`);
  }

  // --- NEGATIVE EVALUATION (Hallucination / Rejection) ---
  console.log('\n--- Evaluating Negative Cases (Adversarial / Off-Topic Rejection) ---');
  for (let j = 0; j < negCases.length; j++) {
    const item = negCases[j];
    // Arbitrary scientific passage as unrelated context
    const sampleSciPassage = allPos[j % allPos.length].quote;

    // Baseline score
    const resBase = await baselineLaya.systemOne(
      { question: item.question, passage: sampleSciPassage },
      { q: { type: 'noul', instructions: RELEVANCE_QUESTION } }
    );
    const scoreBase = resBase.answers.q.noul;

    // New Laya score
    const resNew = await newLaya.systemOne(
      { question: item.question, passage: sampleSciPassage },
      { q: { type: 'noul', instructions: RELEVANCE_QUESTION } }
    );
    const scoreNew = resNew.answers.q.noul;

    // Baseline rejection check
    if (scoreBase < 0.3) stats.baseline.negRejected3++;
    if (scoreBase < 0.5) stats.baseline.negRejected5++;
    if (scoreBase >= 0.5) stats.baseline.negFalseAccept5++;

    // New Model rejection check
    if (scoreNew < 0.3) stats.newModel.negRejected3++;
    if (scoreNew < 0.5) stats.newModel.negRejected5++;
    if (scoreNew >= 0.5) stats.newModel.negFalseAccept5++;

    detailedCases.push({
      id: item.id,
      kind: 'negative',
      question: item.question,
      unrelated_passage: sampleSciPassage,
      baseline: { score: scoreBase, rejectedAt05: scoreBase < 0.5 },
      newModel: { score: scoreNew, rejectedAt05: scoreNew < 0.5 }
    });

    console.log(`  [Neg ${j + 1}/${negCases.length}] ${item.id} | Base Score: ${scoreBase.toFixed(4)} (${scoreBase < 0.5 ? 'REJECTED' : 'ACCEPTED'}) | New Score: ${scoreNew.toFixed(4)} (${scoreNew < 0.5 ? 'REJECTED' : 'ACCEPTED'})`);
  }

  // Close Laya models
  await baselineLaya.close();
  await newLaya.close();

  // Final Summary Calculations
  const N_pos = posCases.length;
  const N_neg = negCases.length;

  const summary = {
    mode: isPilot ? 'PILOT' : 'FULL',
    evaluatedAt: new Date().toISOString(),
    totalCases: N_pos + N_neg,
    positiveCount: N_pos,
    negativeCount: N_neg,
    metrics: {
      baseline: {
        mrr: stats.baseline.mrr / N_pos,
        hit1: stats.baseline.hit1 / N_pos,
        hit3: stats.baseline.hit3 / N_pos,
        hit5: stats.baseline.hit5 / N_pos,
        avgTargetRelevance: stats.baseline.totalRelevanceScore / N_pos,
        avgLatencyMs: stats.baseline.latencies.reduce((a, b) => a + b, 0) / N_pos,
        negRejectionRate05: stats.baseline.negRejected5 / N_neg,
        negRejectionRate03: stats.baseline.negRejected3 / N_neg,
        negFalseAcceptRate05: stats.baseline.negFalseAccept5 / N_neg,
      },
      newModel: {
        mrr: stats.newModel.mrr / N_pos,
        hit1: stats.newModel.hit1 / N_pos,
        hit3: stats.newModel.hit3 / N_pos,
        hit5: stats.newModel.hit5 / N_pos,
        avgTargetRelevance: stats.newModel.totalRelevanceScore / N_pos,
        avgLatencyMs: stats.newModel.latencies.reduce((a, b) => a + b, 0) / N_pos,
        negRejectionRate05: stats.newModel.negRejected5 / N_neg,
        negRejectionRate03: stats.newModel.negRejected3 / N_neg,
        negFalseAcceptRate05: stats.newModel.negFalseAccept5 / N_neg,
      }
    }
  };

  // Save intermediate eval cases for DeepEval Python step
  const outDir = 'C:/document/Study documents/Uth-Data-Mining/logs/benchmarks';
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'laya_ab_eval_cases.json');
  fs.writeFileSync(outFile, JSON.stringify({ summary, cases: detailedCases }, null, 2), 'utf8');

  console.log('\n================================================================');
  console.log('🏆 TIER 1 BENCHMARK SUMMARY RESULTS:');
  console.log('================================================================');
  console.table({
    'MRR@10': {
      'Baseline Pretrained': summary.metrics.baseline.mrr.toFixed(4),
      'Laya New (20261108)': summary.metrics.newModel.mrr.toFixed(4),
      'Delta': `+${((summary.metrics.newModel.mrr - summary.metrics.baseline.mrr) * 100).toFixed(2)}%`
    },
    'Hit@1 (Top-1)': {
      'Baseline Pretrained': `${(summary.metrics.baseline.hit1 * 100).toFixed(1)}%`,
      'Laya New (20261108)': `${(summary.metrics.newModel.hit1 * 100).toFixed(1)}%`,
      'Delta': `+${((summary.metrics.newModel.hit1 - summary.metrics.baseline.hit1) * 100).toFixed(1)}%`
    },
    'Hit@5 (Top-5)': {
      'Baseline Pretrained': `${(summary.metrics.baseline.hit5 * 100).toFixed(1)}%`,
      'Laya New (20261108)': `${(summary.metrics.newModel.hit5 * 100).toFixed(1)}%`,
      'Delta': `+${((summary.metrics.newModel.hit5 - summary.metrics.baseline.hit5) * 100).toFixed(1)}%`
    },
    'Avg Target Conf': {
      'Baseline Pretrained': summary.metrics.baseline.avgTargetRelevance.toFixed(4),
      'Laya New (20261108)': summary.metrics.newModel.avgTargetRelevance.toFixed(4),
      'Delta': `+${(summary.metrics.newModel.avgTargetRelevance - summary.metrics.baseline.avgTargetRelevance).toFixed(4)}`
    },
    'Off-topic Reject @0.5': {
      'Baseline Pretrained': `${(summary.metrics.baseline.negRejectionRate05 * 100).toFixed(1)}%`,
      'Laya New (20261108)': `${(summary.metrics.newModel.negRejectionRate05 * 100).toFixed(1)}%`,
      'Delta': `+${((summary.metrics.newModel.negRejectionRate05 - summary.metrics.baseline.negRejectionRate05) * 100).toFixed(1)}%`
    },
    'False Accept @0.5 (Ảo giác)': {
      'Baseline Pretrained': `${(summary.metrics.baseline.negFalseAcceptRate05 * 100).toFixed(1)}%`,
      'Laya New (20261108)': `${(summary.metrics.newModel.negFalseAcceptRate05 * 100).toFixed(1)}%`,
      'Delta': `${((summary.metrics.newModel.negFalseAcceptRate05 - summary.metrics.baseline.negFalseAcceptRate05) * 100).toFixed(1)}%`
    }
  });

  console.log(`\n✓ Intermediate evaluation cases saved to: ${outFile}`);
  console.log(`Ready for DeepEval Local Qwen judging.`);
}

main().catch(err => {
  console.error('Fatal Runner Error:', err);
  process.exit(1);
});
