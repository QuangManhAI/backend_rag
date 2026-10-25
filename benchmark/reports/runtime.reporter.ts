import * as fs from 'fs';
import * as path from 'path';
import { ScenarioRunResult } from '../runners/runtime.runner';
import { LatencyStats } from '../metrics/runtime.metrics';

export interface RuntimeSuiteReportData {
  title: string;
  timestamp: string;
  base_url: string;
  scenarios: ScenarioRunResult[];
}

function formatStats(s: LatencyStats): string {
  if (s.count === 0) return 'N/A';
  return `p50: ${s.p50} ms | p95: ${s.p95} ms | p99: ${s.p99} ms (mean: ${s.mean} ms)`;
}

export function generateRuntimeMarkdownReport(
  suiteData: RuntimeSuiteReportData,
): string {
  let md = `# RAG Runtime & Load Benchmark Report\n\n`;
  md += `**Generated At:** ${suiteData.timestamp}  \n`;
  md += `**Target Base URL:** \`${suiteData.base_url}\`  \n`;
  md += `**Total Scenarios Evaluated:** ${suiteData.scenarios.length}  \n\n`;

  md += `## 1. Scenario Comparison Overview\n\n`;
  md += `| Scenario | Concurrency | Requests | Success % | Throughput | p50 Latency | p95 Latency | Mean TTFT |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

  for (const s of suiteData.scenarios) {
    const m = s.aggregated_metrics;
    const ttftMean = m.ttft.count > 0 ? `${m.ttft.mean} ms` : 'N/A';
    md += `| **${m.scenario}** | ${m.concurrency_level} | ${m.total_requests} | ${m.success_rate.toFixed(1)}% | ${m.throughput.completed_rps} req/s | ${m.total_latency.p50} ms | ${m.total_latency.p95} ms | ${ttftMean} |\n`;
  }
  md += `\n`;

  md += `## 2. Detailed Scenario Breakdown\n\n`;

  for (const s of suiteData.scenarios) {
    const m = s.aggregated_metrics;
    const res = s.resource_summary;

    md += `### ${m.scenario}\n\n`;
    if (s.config.description) {
      md += `*${s.config.description}*  \n\n`;
    }

    md += `- **Execution Time:** ${s.duration_ms} ms (Warm-up: ${s.warmup_duration_ms} ms)\n`;
    md += `- **Total Requests:** ${m.total_requests} (Success: ${m.successful_requests}, Failed: ${m.failed_requests}, Timeouts: ${m.timeout_requests})\n`;
    md += `- **Error Rate:** ${m.error_rate.toFixed(2)}% | **Timeout Rate:** ${m.timeout_rate.toFixed(2)}%\n`;
    md += `- **Throughput:** ${m.throughput.completed_rps} completed req/s (${m.throughput.successful_rps} success req/s)\n`;

    const statusList = Object.entries(m.status_codes)
      .map(([code, count]) => `\`${code}\`: ${count}`)
      .join(', ');
    md += `- **HTTP Status Breakdown:** ${statusList || 'None'}\n\n`;

    md += `#### Latency & Streaming Timings\n\n`;
    md += `| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
    md += `| **Total Latency (Client E2E)** | ${m.total_latency.mean} ms | ${m.total_latency.p50} ms | ${m.total_latency.p90} ms | ${m.total_latency.p95} ms | ${m.total_latency.p99} ms | ${m.total_latency.min} ms | ${m.total_latency.max} ms |\n`;
    md += `| **TTFT (Time to First Token)** | ${m.ttft.mean || 0} ms | ${m.ttft.p50 || 0} ms | ${m.ttft.p90 || 0} ms | ${m.ttft.p95 || 0} ms | ${m.ttft.p99 || 0} ms | ${m.ttft.min || 0} ms | ${m.ttft.max || 0} ms |\n`;
    md += `| **Completion Time** | ${m.completion_time.mean} ms | ${m.completion_time.p50} ms | ${m.completion_time.p90} ms | ${m.completion_time.p95} ms | ${m.completion_time.p99} ms | ${m.completion_time.min} ms | ${m.completion_time.max} ms |\n\n`;

    if (m.server_timings_avg.total_ms > 0) {
      md += `#### Internal Server Stage Timings (Mean)\n\n`;
      md += `| Embedding (\`embed_ms\`) | Routing (\`route_ms\`) | Search (\`search_ms\`) | Reranking (\`rerank_ms\`) | LLM Gen (\`llm_ms\`) | Server Total |\n`;
      md += `| :---: | :---: | :---: | :---: | :---: | :---: |\n`;
      md += `| ${m.server_timings_avg.embed_ms} ms | ${m.server_timings_avg.route_ms} ms | ${m.server_timings_avg.search_ms} ms | ${m.server_timings_avg.rerank_ms} ms | ${m.server_timings_avg.llm_ms} ms | **${m.server_timings_avg.total_ms} ms** |\n\n`;
    }

    if (res) {
      md += `#### Process Resource Utilization\n\n`;
      md += `- **Start RSS:** ${res.start_snapshot.memory_mb.rss} MB | **Peak RSS:** ${res.peak_rss_mb} MB | **Delta RSS:** ${res.delta_rss_mb > 0 ? '+' : ''}${res.delta_rss_mb} MB\n`;
      md += `- **Start Heap:** ${res.start_snapshot.memory_mb.heap_used} MB | **Peak Heap:** ${res.peak_heap_used_mb} MB | **Delta Heap:** ${res.delta_heap_used_mb > 0 ? '+' : ''}${res.delta_heap_used_mb} MB\n`;
      md += `- **Total CPU Time (Process):** ${res.total_cpu_time_ms} ms\n\n`;
    }

    if (s.aborted_early) {
      md += `> [!WARNING]\n`;
      md += `> **Scenario Aborted Early:** ${s.abort_reason}\n\n`;
    }

    md += `---\n\n`;
  }

  return md;
}

export function saveRuntimeReports(
  suiteData: RuntimeSuiteReportData,
  outputDir: string,
  baseFileName?: string,
): { jsonPath: string; mdPath: string } {
  const dir = path.resolve(outputDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const prefix =
    baseFileName ||
    `runtime-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const jsonPath = path.join(dir, `${prefix}.json`);
  const mdPath = path.join(dir, `${prefix}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(suiteData, null, 2), 'utf8');
  fs.writeFileSync(mdPath, generateRuntimeMarkdownReport(suiteData), 'utf8');

  return { jsonPath, mdPath };
}
