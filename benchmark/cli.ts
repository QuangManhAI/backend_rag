#!/usr/bin/env node
import * as http from 'http';
import * as path from 'path';
import { loadDatasetFromJsonl } from './datasets/loader';
import { RetrievalRunner } from './runners/retrieval.runner';
import { MockRetrievalAdapter } from './runners/adapters';
import { saveJsonReport } from './reports/json.reporter';
import { formatPct, saveMarkdownReport } from './reports/markdown.reporter';
import { RuntimeRunner } from './runners/runtime.runner';
import {
  createBaselineScenario,
  createCacheComparisonScenario,
  createConcurrencyScenario,
  createFailureScenario,
  createSmokeScenario,
  createSustainedScenario,
} from './scenarios';
import { executeRagRequest } from './collectors/sse-client';
import { saveRuntimeReports } from './reports/runtime.reporter';
import { RequestMeasurement } from './metrics/runtime.metrics';
import { GenerationAdapter, GenerationRunner } from './runners/generation.runner';
import { MockJudgeProvider } from './evaluators/llm-judge.evaluator';
import { saveGenerationReports } from './reports/generation.reporter';
import { IntegratedRunner } from './runners/integrated.runner';

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {
    suite: 'retrieval',
    dataset: path.join(
      __dirname,
      'datasets',
      'samples',
      'sample_evaluation.jsonl',
    ),
    k: '1,3,5,10',
    adapter: 'mock',
    scenario: 'all',
    judge: 'mock',
    url: 'http://localhost:3000',
    output: path.join(__dirname, 'reports', 'output'),
  };

  for (const arg of args) {
    if (arg.startsWith('--suite=')) {
      options.suite = arg.split('=')[1];
    } else if (arg.startsWith('--dataset=')) {
      options.dataset = arg.split('=')[1];
    } else if (arg.startsWith('--k=')) {
      options.k = arg.split('=')[1];
    } else if (arg.startsWith('--adapter=')) {
      options.adapter = arg.split('=')[1];
    } else if (arg.startsWith('--scenario=')) {
      options.scenario = arg.split('=')[1];
    } else if (arg.startsWith('--judge=')) {
      options.judge = arg.split('=')[1];
    } else if (arg.startsWith('--url=')) {
      options.url = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      options.output = arg.split('=')[1];
    }
  }

  return options;
}

async function isServerReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const u = new URL(`${url}/api/v1/health/live`);
      const req = http.get(u, { timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Realistic mock executor simulating RAG pipeline behavior with queue, concurrency, and TTFT */
function createMockExecutor(): (opts: any) => Promise<RequestMeasurement> {
  let inFlight = 0;
  const maxConcurrency = 1;
  const maxQueue = 8;
  const queue: Array<() => void> = [];

  return async (opts) => {
    const start = performance.now();
    const reqId = `mock_${Math.random().toString(36).slice(2, 8)}`;

    if (inFlight >= maxConcurrency && queue.length >= maxQueue) {
      const end = performance.now();
      return {
        request_id: reqId,
        query: opts.query,
        scenario: opts.scenario,
        concurrency_level: opts.concurrency_level,
        start_time_ms: start,
        end_time_ms: end,
        total_latency_ms: Math.round((end - start) * 100) / 100,
        ttft_ms: null,
        completion_time_ms: Math.round((end - start) * 100) / 100,
        status_code: 429,
        success: false,
        is_timeout: false,
        is_aborted: false,
        error_message: 'HTTP 429: llm queue is full',
      };
    }

    if (inFlight >= maxConcurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    inFlight++;

    try {
      if (opts.category && opts.category.includes('INVALID')) {
        const end = performance.now();
        return {
          request_id: reqId,
          query: opts.query,
          scenario: opts.scenario,
          concurrency_level: opts.concurrency_level,
          start_time_ms: start,
          end_time_ms: end,
          total_latency_ms: Math.round((end - start) * 100) / 100,
          ttft_ms: null,
          completion_time_ms: Math.round((end - start) * 100) / 100,
          status_code: 400,
          success: false,
          is_timeout: false,
          is_aborted: false,
          error_message: 'HTTP 400: validation error',
        };
      }

      await new Promise((r) => setTimeout(r, 45));
      const ttft = Math.round((performance.now() - start) * 100) / 100;
      await new Promise((r) => setTimeout(r, 35));
      const end = performance.now();
      const totalLatency = Math.round((end - start) * 100) / 100;

      return {
        request_id: reqId,
        query: opts.query,
        scenario: opts.scenario,
        concurrency_level: opts.concurrency_level,
        start_time_ms: start,
        end_time_ms: end,
        total_latency_ms: totalLatency,
        ttft_ms: ttft,
        completion_time_ms: totalLatency,
        status_code: 200,
        success: true,
        is_timeout: false,
        is_aborted: false,
        token_count: 45,
        server_timings: {
          embed_ms: 25,
          route_ms: 2,
          search_ms: 15,
          rerank_ms: 3,
          llm_ms: 35,
          total_ms: 80,
        },
      };
    } finally {
      inFlight--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

async function runRetrievalSuite(options: Record<string, string>) {
  console.log('\n>>> RUNNING RETRIEVAL BENCHMARK SUITE');
  const datasetPath = options.dataset;
  const kValues = options.k
    .split(',')
    .map((v) => parseInt(v.trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
  const adapterType = options.adapter;
  const outputDir = options.output;

  const dataset = loadDatasetFromJsonl(datasetPath);
  console.log(`[INFO] Loaded ${dataset.stats.validCount} valid dataset items.`);

  let adapter;
  if (adapterType === 'mock') {
    adapter = new MockRetrievalAdapter();
  } else {
    console.warn('[WARN] Falling back to MockAdapter for retrieval test.');
    adapter = new MockRetrievalAdapter();
  }

  const runner = new RetrievalRunner(adapter, {
    k_values: kValues,
    top_k: Math.max(...kValues),
    use_authority_boost: true,
  });

  const suiteResult = await runner.run(dataset.validItems, datasetPath);
  const jsonPath = saveJsonReport(suiteResult, outputDir);
  const mdPath = saveMarkdownReport(suiteResult, outputDir);

  console.log(`[SUCCESS] Retrieval JSON Report:     ${jsonPath}`);
  console.log(`[SUCCESS] Retrieval Markdown Report: ${mdPath}`);

  console.log('\n--- RETRIEVAL RESULTS SUMMARY ---');
  for (const k of kValues) {
    const pre = suiteResult.pre_rerank_aggregated.paper_recall[k]?.mean ?? 0;
    const post = suiteResult.post_rerank_aggregated.paper_recall[k]?.mean ?? 0;
    console.log(
      `Recall@${k}`.padEnd(12) +
        `Pre: ${formatPct(pre)}`.padEnd(16) +
        `Post: ${formatPct(post)}`.padEnd(16) +
        `Delta: ${(post - pre >= 0 ? '+' : '')}${((post - pre) * 100).toFixed(2)}%`,
    );
  }
}

async function runRuntimeSuite(options: Record<string, string>) {
  console.log('\n>>> RUNNING RUNTIME & LOAD BENCHMARK SUITE');
  const baseUrl = options.url;
  const outputDir = options.output;
  const selectedScenario = options.scenario;

  const serverUp = await isServerReachable(baseUrl);
  console.log(
    `[INFO] Target server status at ${baseUrl}: ${serverUp ? 'ONLINE (HTTP)' : 'OFFLINE (Running Mock Simulator)'}`,
  );

  const executor = serverUp ? executeRagRequest : createMockExecutor();
  const runner = new RuntimeRunner(executor);

  const scenariosToRun = [];

  if (selectedScenario === 'all' || selectedScenario === 'smoke') {
    scenariosToRun.push(createSmokeScenario(baseUrl));
  }
  if (selectedScenario === 'all' || selectedScenario === 'baseline') {
    scenariosToRun.push(createBaselineScenario(baseUrl));
  }
  if (selectedScenario === 'all' || selectedScenario === 'concurrency') {
    scenariosToRun.push(createConcurrencyScenario(baseUrl, 1));
    scenariosToRun.push(createConcurrencyScenario(baseUrl, 2));
    scenariosToRun.push(createConcurrencyScenario(baseUrl, 4));
    scenariosToRun.push(createConcurrencyScenario(baseUrl, 8));
  }
  if (selectedScenario === 'all' || selectedScenario === 'cache') {
    scenariosToRun.push(createCacheComparisonScenario(baseUrl, false));
    scenariosToRun.push(createCacheComparisonScenario(baseUrl, true));
  }
  if (selectedScenario === 'all' || selectedScenario === 'sustained') {
    scenariosToRun.push(createSustainedScenario(baseUrl));
  }
  if (selectedScenario === 'all' || selectedScenario === 'failure') {
    scenariosToRun.push(createFailureScenario(baseUrl));
  }

  const results = [];
  for (const sc of scenariosToRun) {
    console.log(`\n--> Executing scenario: ${sc.name} (Concurrency: ${sc.concurrency}, Requests: ${sc.total_requests})...`);
    const res = await runner.runScenario(sc);
    results.push(res);
    const m = res.aggregated_metrics;
    console.log(
      `    Done in ${res.duration_ms} ms | Success: ${m.success_rate}% | Throughput: ${m.throughput.completed_rps} req/s | p50: ${m.total_latency.p50} ms | p95: ${m.total_latency.p95} ms | Mean TTFT: ${m.ttft.mean || 'N/A'} ms`,
    );
  }

  const suiteData = {
    title: 'RAG Runtime & Load Benchmark',
    timestamp: new Date().toISOString(),
    base_url: baseUrl,
    scenarios: results,
  };

  const { jsonPath, mdPath } = saveRuntimeReports(suiteData, outputDir);
  console.log(`\n[SUCCESS] Runtime JSON Report:     ${jsonPath}`);
  console.log(`[SUCCESS] Runtime Markdown Report: ${mdPath}`);
}

async function runGenerationSuite(options: Record<string, string>) {
  console.log('\n>>> RUNNING GENERATION BENCHMARK SUITE');
  const datasetPath = options.dataset;
  const outputDir = options.output;
  const judgeType = options.judge;

  const dataset = loadDatasetFromJsonl(datasetPath);
  console.log(`[INFO] Loaded ${dataset.stats.validCount} valid evaluation items.`);

  class MockGenerationAdapter implements GenerationAdapter {
    async generate(
      query: string,
      fixedContexts?: Array<{ chunk_id: string; paper_id: string; text: string }>,
    ) {
      if (/influenza|pizza|dough/i.test(query)) {
        return {
          answer:
            'The provided literature does not contain sufficient details regarding this question.',
          citations: [],
          grounded_chunks: [],
        };
      }
      if (/lora|low-rank/i.test(query)) {
        return {
          answer:
            'Low-rank adaptation LoRA freezes pre-trained weights and injects trainable rank decomposition matrices [Paper: 2106.09685]. This drastically reduces trainable parameters.',
          citations: ['2106.09685'],
          grounded_chunks: [
            {
              chunk_id: '2106.09685_abs',
              paper_id: '2106.09685',
              text: 'We freeze the pre-trained model weights and inject trainable rank decomposition matrices into each layer of the Transformer architecture, greatly reducing the number of trainable parameters.',
            },
          ],
        };
      }
      if (/attention|transformer/i.test(query)) {
        return {
          answer:
            'The Transformer architecture computes queries, keys, and values through scaled dot-product attention [Paper: 1706.03762].',
          citations: ['1706.03762'],
          grounded_chunks: [
            {
              chunk_id: '1706.03762_abs',
              paper_id: '1706.03762',
              text: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose the Transformer, based solely on attention mechanisms.',
            },
          ],
        };
      }
      return {
        answer: `Scientific findings show consistent experimental results [Paper: 2400.10000].`,
        citations: ['2400.10000'],
        grounded_chunks: [
          {
            chunk_id: '2400.10000_abs',
            paper_id: '2400.10000',
            text: 'Scientific findings show consistent experimental results across tasks.',
          },
        ],
      };
    }
  }

  const generationAdapter = new MockGenerationAdapter();

  const judgeProvider =
    judgeType === 'mock' ? new MockJudgeProvider() : undefined;

  const runner = new GenerationRunner(generationAdapter, judgeProvider);
  const suiteResult = await runner.run(dataset.validItems, datasetPath);

  const { jsonPath, mdPath } = saveGenerationReports(suiteResult, outputDir);
  console.log(`[SUCCESS] Generation JSON Report:     ${jsonPath}`);
  console.log(`[SUCCESS] Generation Markdown Report: ${mdPath}`);

  console.log('\n--- GENERATION RESULTS SCORECARD ---');
  const m = suiteResult.aggregated_metrics;
  console.log(`Faithfulness Score:       ${formatPct(m.mean_faithfulness_score)} (${m.total_supported_claims}/${m.total_claims_evaluated} claims supported)`);
  console.log(`Answer Relevance Score:   ${formatPct(m.mean_relevance_score)}`);
  console.log(`Citation ID Precision:    ${formatPct(m.mean_citation_id_precision)} (Hallucinated: ${m.total_hallucinated_citations})`);
  console.log(`Citation Support Ratio:   ${formatPct(m.mean_citation_support_ratio)}`);
  console.log(`Abstention Precision:     ${formatPct(m.abstention.abstention_precision)}`);
  console.log(`Abstention Recall:        ${formatPct(m.abstention.abstention_recall)}`);
  console.log(`Unsupported-Answer Rate:  ${formatPct(m.abstention.unsupported_answer_rate)}`);
  if (m.judge_averages) {
    console.log(`LLM Judge Faithfulness:   ${m.judge_averages.mean_faithfulness_score_1_to_5} / 5.0`);
    console.log(`LLM Judge Relevance:      ${m.judge_averages.mean_relevance_score_1_to_5} / 5.0`);
  }
}

async function runIntegratedSuite(options: Record<string, string>) {
  console.log('\n>>> RUNNING INTEGRATED RAG BENCHMARK (PHASE 1–5 FULL SUITE)');
  const runner = new IntegratedRunner();
  const kValues = options.k
    ? options.k
        .split(',')
        .map((v) => parseInt(v.trim(), 10))
        .filter((v) => !isNaN(v))
    : [1, 3, 5, 10];

  const result = await runner.run({
    datasetPath: options.dataset,
    outputDir: options.output,
    k_values: kValues.length > 0 ? kValues : [1, 3, 5, 10],
    judge_type: options.judge,
    runtime_base_url: options.url,
    runtime_scenario: options.scenario || 'all',
  });

  console.log('\n=================================================================');
  console.log('              INTEGRATED BENCHMARK SCORECARD                     ');
  console.log('=================================================================');
  console.log(`Run ID:                 ${result.metadata.run_id}`);
  console.log(`Overall Status:         ${result.metadata.overall_status.toUpperCase()}`);
  console.log(`Total Duration:         ${result.metadata.total_duration_ms} ms`);
  console.log(`Git Commit:             ${result.metadata.environment.git_commit}`);
  console.log(
    `Environment:            ${result.metadata.environment.os_platform} | Node ${result.metadata.environment.node_version} | ${result.metadata.environment.total_ram_gb}GB RAM`,
  );

  console.log('\n[REPORTS GENERATED]:');
  console.log(`  - Machine JSON:       integrated-${result.metadata.run_id}.json`);
  console.log(`  - Technical Report:   integrated-${result.metadata.run_id}-technical.md`);
  console.log(`  - Executive Summary:  integrated-${result.metadata.run_id}-executive.md`);

  console.log('\n[KEY FINDINGS]:');
  console.log(
    `  - Bottleneck:         ${result.tradeoffs.biggest_bottleneck.component.toUpperCase()} (${result.tradeoffs.biggest_bottleneck.reason})`,
  );
  console.log(
    `  - Citation Precision: ${result.tradeoffs.citation_reliability.in_context_precision_pct}% (Hallucinations: ${result.tradeoffs.citation_reliability.hallucination_count})`,
  );
  console.log(
    `  - Action Priorities:  ${result.action_priorities.length} actions recommended (Top P0: ${result.action_priorities[0]?.observed_issue})`,
  );
}

async function main() {
  console.log('='.repeat(65));
  console.log('        RAG BENCHMARK SUITE — TYPESCRIPT 100%        ');
  console.log('='.repeat(65));

  const options = parseArgs();

  if (options.suite === 'retrieval') {
    await runRetrievalSuite(options);
  } else if (options.suite === 'runtime') {
    await runRuntimeSuite(options);
  } else if (options.suite === 'generation') {
    await runGenerationSuite(options);
  } else if (options.suite === 'all' || options.suite === 'integrated') {
    await runIntegratedSuite(options);
  } else {
    console.error(
      `[ERROR] Unknown suite "${options.suite}". Choose retrieval, runtime, generation, all, or integrated.`,
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
}
