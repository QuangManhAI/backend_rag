import * as os from 'os';
import { execSync } from 'child_process';
import { z } from 'zod';
import { RetrievalSuiteResult } from '../runners/retrieval.runner';
import { GenerationSuiteResult } from '../runners/generation.runner';
import { AggregatedRuntimeMetrics } from '../metrics/runtime.metrics';

export const BENCHMARK_VERSION = '1.0.0';

export interface BenchmarkEnvironment {
  os_platform: string;
  os_release: string;
  node_version: string;
  cpu_model: string;
  cpu_cores: number;
  total_ram_gb: number;
  git_commit: string;
}

export function captureEnvironment(): BenchmarkEnvironment {
  let gitCommit = 'unknown';
  try {
    gitCommit = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    gitCommit = 'unknown';
  }

  const cpus = os.cpus();
  return {
    os_platform: process.platform,
    os_release: os.release(),
    node_version: process.version,
    cpu_model: cpus[0]?.model || 'unknown',
    cpu_cores: cpus.length,
    total_ram_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    git_commit: gitCommit,
  };
}

export type SuiteRunStatus = 'completed' | 'partial' | 'failed' | 'skipped';

export interface SuiteExecutionInfo<T = unknown> {
  status: SuiteRunStatus;
  duration_ms: number;
  error?: string;
  raw_file?: string;
  data?: T;
}

export interface ActionPriorityItem {
  priority: 'P0' | 'P1' | 'P2';
  classification: 'confirmed_bug' | 'hypothesis' | 'enhancement';
  observed_issue: string;
  evidence: string;
  proposed_action: string;
  verification_method: string;
}

export interface TradeoffAnalysis {
  retrieval_generation_link: {
    summary: string;
    correlation_observed: boolean;
    evidence: string;
  };
  concurrency_scaling: {
    summary: string;
    saturation_point: string;
    p95_degradation: string;
  };
  rerank_impact: {
    summary: string;
    recall_gain_pct: number;
    tradeoff_assessment: string;
  };
  citation_reliability: {
    summary: string;
    in_context_precision_pct: number;
    hallucination_count: number;
  };
  biggest_bottleneck: {
    component: 'retrieval' | 'generation' | 'runtime' | 'ground_truth';
    reason: string;
    impact: string;
  };
}

export interface IntegratedRunConfig {
  run_id: string;
  timestamp: string;
  benchmark_version: string;
  dataset_path?: string;
  dataset_version: string;
  k_values: number[];
  judge_type: string;
  runtime_base_url: string;
  runtime_scenario: string;
  execution_order: string[];
}

export interface IntegratedSuiteResult {
  metadata: {
    run_id: string;
    timestamp: string;
    benchmark_version: string;
    dataset_version: string;
    overall_status: SuiteRunStatus;
    total_duration_ms: number;
    environment: BenchmarkEnvironment;
    config: IntegratedRunConfig;
  };
  suites: {
    retrieval: SuiteExecutionInfo<RetrievalSuiteResult>;
    runtime: SuiteExecutionInfo<{
      title: string;
      base_url: string;
      scenarios: Array<{
        config: {
          name: string;
          concurrency: number;
          total_requests: number;
          is_streaming?: boolean;
        };
        duration_ms: number;
        aggregated_metrics: AggregatedRuntimeMetrics;
      }>;
    }>;
    generation: SuiteExecutionInfo<GenerationSuiteResult>;
  };
  tradeoffs: TradeoffAnalysis;
  action_priorities: ActionPriorityItem[];
}

export const actionPriorityItemSchema = z.object({
  priority: z.enum(['P0', 'P1', 'P2']),
  classification: z.enum(['confirmed_bug', 'hypothesis', 'enhancement']),
  observed_issue: z.string().min(1),
  evidence: z.string().min(1),
  proposed_action: z.string().min(1),
  verification_method: z.string().min(1),
});
