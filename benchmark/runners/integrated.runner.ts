import * as path from 'path';
import {
  BENCHMARK_VERSION,
  captureEnvironment,
  IntegratedRunConfig,
  IntegratedSuiteResult,
  SuiteExecutionInfo,
  SuiteRunStatus,
} from '../schemas/integrated.schema';
import {
  RetrievalAdapter,
  RetrievalRunner,
  RetrievalSuiteResult,
} from './retrieval.runner';
import {
  GenerationAdapter,
  GenerationRunner,
  GenerationSuiteResult,
} from './generation.runner';
import {
  RequestExecutor,
  RuntimeRunner,
} from './runtime.runner';
import { MockRetrievalAdapter } from './adapters';
import { LlmJudgeProvider, MockJudgeProvider } from '../evaluators/llm-judge.evaluator';
import { loadDatasetFromJsonl } from '../datasets/loader';
import {
  createBaselineScenario,
  createConcurrencyScenario,
  createMockExecutor,
  createSmokeScenario,
  isServerReachable,
} from '../scenarios';
import { executeRagRequest } from '../collectors/sse-client';
import {
  analyzeTradeoffs,
  RuntimeScenarioData,
  RuntimeSuiteData,
} from '../analysis/tradeoff.analyzer';
import { saveJsonReport } from '../reports/json.reporter';
import { saveMarkdownReport } from '../reports/markdown.reporter';
import { saveGenerationReports } from '../reports/generation.reporter';
import { saveRuntimeReports } from '../reports/runtime.reporter';
import { saveIntegratedReports } from '../reports/integrated.reporter';

export interface IntegratedRunnerOptions {
  datasetPath?: string;
  outputDir?: string;
  k_values?: number[];
  judge_type?: string;
  runtime_scenario?: string;
  runtime_base_url?: string;
  suites_to_run?: Array<'retrieval' | 'generation' | 'runtime'>;
  retrievalAdapter?: RetrievalAdapter;
  generationAdapter?: GenerationAdapter;
  runtimeExecutor?: RequestExecutor;
  judgeProvider?: LlmJudgeProvider;
}

export class IntegratedRunner {
  async run(options: IntegratedRunnerOptions = {}): Promise<IntegratedSuiteResult> {
    const startTime = performance.now();
    const timestamp = new Date().toISOString();
    const runId = `bench-run-${timestamp.replace(/[:.]/g, '-').slice(0, 19)}-${Math.random().toString(36).substring(2, 7)}`;

    const datasetPath =
      options.datasetPath ||
      path.resolve(
        __dirname,
        '../datasets/samples/sample_evaluation.jsonl',
      );
    const outputDir =
      options.outputDir || path.resolve(__dirname, '../reports/output');
    const kValues = options.k_values || [1, 3, 5, 10];
    const judgeType = options.judge_type || 'mock';
    const runtimeBaseUrl = options.runtime_base_url || 'http://localhost:3000';
    const runtimeScenario = options.runtime_scenario || 'smoke';
    const suitesToRun = options.suites_to_run || ['retrieval', 'generation', 'runtime'];

    const config: IntegratedRunConfig = {
      run_id: runId,
      timestamp,
      benchmark_version: BENCHMARK_VERSION,
      dataset_path: datasetPath,
      dataset_version: '1.0.0',
      k_values: kValues,
      judge_type: judgeType,
      runtime_base_url: runtimeBaseUrl,
      runtime_scenario: runtimeScenario,
      execution_order: ['retrieval', 'generation', 'runtime'],
    };

    const env = captureEnvironment();

    // 1. Load Dataset
    let datasetItems: any[] = [];
    try {
      const loaded = loadDatasetFromJsonl(datasetPath);
      datasetItems = loaded.validItems;
    } catch {
      datasetItems = [];
    }

    let retrievalInfo: SuiteExecutionInfo<RetrievalSuiteResult> = {
      status: 'skipped',
      duration_ms: 0,
    };

    let generationInfo: SuiteExecutionInfo<GenerationSuiteResult> = {
      status: 'skipped',
      duration_ms: 0,
    };

    let runtimeInfo: SuiteExecutionInfo<RuntimeSuiteData> = {
      status: 'skipped',
      duration_ms: 0,
    };

    // --- STEP 1: RETRIEVAL SUITE ---
    if (suitesToRun.includes('retrieval')) {
      const rStart = performance.now();
      try {
        const adapter = options.retrievalAdapter || new MockRetrievalAdapter();
        const runner = new RetrievalRunner(adapter, {
          k_values: kValues,
          top_k: Math.max(...kValues),
          use_authority_boost: true,
        });

        const rResult = await runner.run(datasetItems, datasetPath);
        const rDuration = Math.round(performance.now() - rStart);
        const rawJsonPath = saveJsonReport(rResult, outputDir);
        saveMarkdownReport(rResult, outputDir);

        const allQueriesFailed =
          datasetItems.length > 0 &&
          rResult.failed_queries.length === datasetItems.length;
        const someQueriesFailed =
          rResult.failed_queries.length > 0 &&
          rResult.failed_queries.length < datasetItems.length;

        retrievalInfo = {
          status: allQueriesFailed ? 'failed' : someQueriesFailed ? 'partial' : 'completed',
          duration_ms: rDuration,
          raw_file: rawJsonPath,
          error: allQueriesFailed ? rResult.failed_queries[0]?.error : undefined,
          data: rResult,
        };
      } catch (err) {
        retrievalInfo = {
          status: 'failed',
          duration_ms: Math.round(performance.now() - rStart),
          error: (err as Error).message,
        };
      }
    }

    // --- STEP 2: GENERATION SUITE ---
    if (suitesToRun.includes('generation')) {
      const gStart = performance.now();
      try {
        class DefaultMockGenerationAdapter implements GenerationAdapter {
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
                  'Low-rank adaptation LoRA freezes pre-trained weights and injects trainable rank decomposition matrices [Paper: 2106.09685].',
                citations: ['2106.09685'],
                grounded_chunks: [
                  {
                    chunk_id: '2106.09685_abs',
                    paper_id: '2106.09685',
                    text: 'We freeze the pre-trained model weights and inject trainable rank decomposition matrices into each layer.',
                  },
                ],
              };
            }
            return {
              answer:
                'Scientific findings show consistent experimental results [Paper: 1706.03762].',
              citations: ['1706.03762'],
              grounded_chunks: [
                {
                  chunk_id: '1706.03762_abs',
                  paper_id: '1706.03762',
                  text: 'We propose the Transformer model architecture based on attention mechanisms.',
                },
              ],
            };
          }
        }

        const genAdapter =
          options.generationAdapter || new DefaultMockGenerationAdapter();
        const judge =
          options.judgeProvider ||
          (judgeType === 'mock' ? new MockJudgeProvider() : undefined);

        const gRunner = new GenerationRunner(genAdapter, judge);
        const gResult = await gRunner.run(datasetItems, datasetPath);
        const gDuration = Math.round(performance.now() - gStart);
        const { jsonPath } = saveGenerationReports(gResult, outputDir);

        const allGenFailed =
          datasetItems.length > 0 &&
          gResult.aggregated_metrics.failed_evaluations === datasetItems.length;
        const someGenFailed =
          gResult.aggregated_metrics.failed_evaluations > 0 &&
          gResult.aggregated_metrics.failed_evaluations < datasetItems.length;

        generationInfo = {
          status: allGenFailed ? 'failed' : someGenFailed ? 'partial' : 'completed',
          duration_ms: gDuration,
          raw_file: jsonPath,
          error: allGenFailed ? gResult.results[0]?.error : undefined,
          data: gResult,
        };
      } catch (err) {
        generationInfo = {
          status: 'failed',
          duration_ms: Math.round(performance.now() - gStart),
          error: (err as Error).message,
        };
      }
    }

    // --- STEP 3: RUNTIME SUITE ---
    if (suitesToRun.includes('runtime')) {
      const rtStart = performance.now();
      try {
        let executor = options.runtimeExecutor;
        if (!executor) {
          const isUp = await isServerReachable(runtimeBaseUrl);
          executor = isUp ? executeRagRequest : createMockExecutor();
        }

        const rtRunner = new RuntimeRunner(executor);
        const scenariosToRun = [];

        if (runtimeScenario === 'all' || runtimeScenario === 'smoke') {
          scenariosToRun.push(createSmokeScenario(runtimeBaseUrl));
        }
        if (runtimeScenario === 'all' || runtimeScenario === 'baseline') {
          scenariosToRun.push(createBaselineScenario(runtimeBaseUrl));
        }
        if (runtimeScenario === 'all' || runtimeScenario === 'concurrency') {
          scenariosToRun.push(createConcurrencyScenario(runtimeBaseUrl, 1));
          scenariosToRun.push(createConcurrencyScenario(runtimeBaseUrl, 2));
        }

        const scenarioResults: RuntimeScenarioData[] = [];
        for (const sc of scenariosToRun) {
          const res = await rtRunner.runScenario(sc);
          scenarioResults.push({
            config: {
              name: res.config.name,
              concurrency: res.config.concurrency,
              total_requests: res.config.total_requests,
              is_streaming: res.config.is_streaming,
            },
            duration_ms: res.duration_ms,
            aggregated_metrics: res.aggregated_metrics,
          });
        }

        const rtDuration = Math.round(performance.now() - rtStart);
        const runtimeSuitePayload: RuntimeSuiteData = {
          title: 'RAG Runtime & Load Benchmark',
          base_url: runtimeBaseUrl,
          scenarios: scenarioResults,
        };

        const { jsonPath } = saveRuntimeReports(runtimeSuitePayload as any, outputDir);

        const allScenariosFailed =
          scenarioResults.length > 0 &&
          scenarioResults.every((s) => s.aggregated_metrics.success_rate === 0);
        const someScenariosFailed = scenarioResults.some(
          (s) => s.aggregated_metrics.error_rate > 0,
        );

        runtimeInfo = {
          status: allScenariosFailed ? 'failed' : someScenariosFailed ? 'partial' : 'completed',
          duration_ms: rtDuration,
          raw_file: jsonPath,
          data: runtimeSuitePayload,
        };
      } catch (err) {
        runtimeInfo = {
          status: 'failed',
          duration_ms: Math.round(performance.now() - rtStart),
          error: (err as Error).message,
        };
      }
    }

    // Determine Overall Status
    const executedStatuses = [
      suitesToRun.includes('retrieval') ? retrievalInfo.status : null,
      suitesToRun.includes('generation') ? generationInfo.status : null,
      suitesToRun.includes('runtime') ? runtimeInfo.status : null,
    ].filter(Boolean) as SuiteRunStatus[];

    let overallStatus: SuiteRunStatus = 'completed';
    const completedCount = executedStatuses.filter((s) => s === 'completed').length;
    const failedCount = executedStatuses.filter((s) => s === 'failed').length;
    const partialCount = executedStatuses.filter((s) => s === 'partial').length;

    if (failedCount > 0 && completedCount > 0) {
      overallStatus = 'partial';
    } else if (partialCount > 0) {
      overallStatus = 'partial';
    } else if (failedCount > 0 && completedCount === 0) {
      overallStatus = 'failed';
    } else if (completedCount > 0) {
      overallStatus = 'completed';
    }

    // Analyze Cross-Phase Trade-offs and Actions
    const { tradeoffs, actionPriorities } = analyzeTradeoffs(
      retrievalInfo,
      runtimeInfo,
      generationInfo,
    );

    const totalDuration = Math.round(performance.now() - startTime);

    const integratedResult: IntegratedSuiteResult = {
      metadata: {
        run_id: runId,
        timestamp,
        benchmark_version: BENCHMARK_VERSION,
        dataset_version: '1.0.0',
        overall_status: overallStatus,
        total_duration_ms: totalDuration,
        environment: env,
        config,
      },
      suites: {
        retrieval: retrievalInfo,
        generation: generationInfo,
        runtime: runtimeInfo,
      },
      tradeoffs,
      action_priorities: actionPriorities,
    };

    // Save final integrated reports
    saveIntegratedReports(integratedResult, outputDir, `integrated-${runId}`);

    return integratedResult;
  }
}
