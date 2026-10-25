import * as fs from 'fs';
import * as path from 'path';
import { RetrievalSuiteResult } from '../runners/retrieval.runner';

export function formatPct(val: number): string {
  if (Number.isNaN(val) || val === undefined) return 'N/A';
  return `${(val * 100).toFixed(2)}%`;
}

export function formatDelta(pre: number, post: number): string {
  if (Number.isNaN(pre) || Number.isNaN(post)) return '-';
  const diff = post - pre;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${(diff * 100).toFixed(2)}%`;
}

/**
 * Generates a clean, readable Markdown report from the benchmark suite result.
 */
export function generateMarkdownReport(suite: RetrievalSuiteResult): string {
  const { config, duration_ms, results, pre_rerank_aggregated, post_rerank_aggregated, failed_queries } =
    suite;

  const total = results.length;
  const evaluated = post_rerank_aggregated.evaluated_queries;
  const skipped = post_rerank_aggregated.skipped_queries;
  const emptyCount = post_rerank_aggregated.empty_retrieval_count;

  // Latency averages
  const validTimingResults = results.filter((r) => !r.error);
  const avg = (fn: (r: (typeof results)[0]) => number) =>
    validTimingResults.length > 0
      ? Math.round(
          (validTimingResults.reduce((sum, r) => sum + fn(r), 0) /
            validTimingResults.length) *
            10,
        ) / 10
      : 0;

  const avgEmbed = avg((r) => r.timings.embed_ms);
  const avgRoute = avg((r) => r.timings.route_ms);
  const avgSearch = avg((r) => r.timings.search_ms);
  const avgRerank = avg((r) => r.timings.rerank_ms);
  const avgTotal = avg((r) => r.timings.total_ms);

  const kList = config.k_values;

  let md = `# RAG Retrieval Benchmark Report\n\n`;
  md += `**Generated At:** ${new Date().toISOString()}  \n`;
  md += `**Dataset:** \`${config.dataset_path || 'In-Memory Sample'}\`  \n`;
  md += `**Adapter Type:** \`${config.adapter_type}\`  \n`;
  md += `**Execution Time:** ${duration_ms} ms  \n\n`;

  md += `## 1. Summary Statistics\n\n`;
  md += `| Metric | Count / Value |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Total Queries Processed** | ${total} |\n`;
  md += `| **Evaluated Queries (with Ground Truth)** | ${evaluated} |\n`;
  md += `| **Skipped Queries (Unanswerable / No GT)** | ${skipped} |\n`;
  md += `| **Empty Retrievals (0 items returned)** | ${emptyCount} (${formatPct(post_rerank_aggregated.empty_retrieval_rate)}) |\n`;
  md += `| **Failed / Errored Queries** | ${failed_queries.length} |\n\n`;

  md += `## 2. Latency Breakdown (Mean ms)\n\n`;
  md += `| Stage | Duration |\n`;
  md += `| :--- | :--- |\n`;
  md += `| Embedding (\`embed_ms\`) | ${avgEmbed} ms |\n`;
  md += `| Tree Routing (\`route_ms\`) | ${avgRoute} ms |\n`;
  md += `| Qdrant Search (\`search_ms\`) | ${avgSearch} ms |\n`;
  md += `| PageRank Rerank (\`rerank_ms\`) | ${avgRerank} ms |\n`;
  md += `| **Total Retrieval Pipeline** | **${avgTotal} ms** |\n\n`;

  md += `## 3. Paper-Level Metrics (Ablation: Pre-Rerank vs Post-Rerank)\n\n`;
  md += `> **Pre-Rerank:** Pure vector similarity from Qdrant  \n`;
  md += `> **Post-Rerank:** Cosine similarity (85%) + Author PageRank authority (15%)\n\n`;

  md += `| Metric @ K | Pre-Rerank | Post-Rerank | Delta (Improvement) |\n`;
  md += `| :--- | :---: | :---: | :---: |\n`;
  for (const k of kList) {
    const preRec = pre_rerank_aggregated.paper_recall[k]?.mean ?? NaN;
    const postRec = post_rerank_aggregated.paper_recall[k]?.mean ?? NaN;
    md += `| **Recall@${k}** | ${formatPct(preRec)} | ${formatPct(postRec)} | ${formatDelta(preRec, postRec)} |\n`;

    const preMrr = pre_rerank_aggregated.paper_mrr[k]?.mean ?? NaN;
    const postMrr = post_rerank_aggregated.paper_mrr[k]?.mean ?? NaN;
    md += `| **MRR@${k}** | ${formatPct(preMrr)} | ${formatPct(postMrr)} | ${formatDelta(preMrr, postMrr)} |\n`;

    const preNdcg = pre_rerank_aggregated.paper_ndcg[k]?.mean ?? NaN;
    const postNdcg = post_rerank_aggregated.paper_ndcg[k]?.mean ?? NaN;
    md += `| **nDCG@${k}** | ${formatPct(preNdcg)} | ${formatPct(postNdcg)} | ${formatDelta(preNdcg, postNdcg)} |\n`;

    const prePrec = pre_rerank_aggregated.paper_precision[k]?.mean ?? NaN;
    const postPrec = post_rerank_aggregated.paper_precision[k]?.mean ?? NaN;
    md += `| **Precision@${k}** | ${formatPct(prePrec)} | ${formatPct(postPrec)} | ${formatDelta(prePrec, postPrec)} |\n`;

    const preHit = pre_rerank_aggregated.paper_hit_rate[k]?.mean ?? NaN;
    const postHit = post_rerank_aggregated.paper_hit_rate[k]?.mean ?? NaN;
    md += `| **HitRate@${k}** | ${formatPct(preHit)} | ${formatPct(postHit)} | ${formatDelta(preHit, postHit)} |\n`;
    md += `| --- | --- | --- | --- |\n`;
  }
  md += `\n`;

  md += `## 4. Chunk-Level Metrics\n\n`;
  md += `| Metric @ K | Pre-Rerank | Post-Rerank | Delta |\n`;
  md += `| :--- | :---: | :---: | :---: |\n`;
  for (const k of kList) {
    const preRec = pre_rerank_aggregated.chunk_recall[k]?.mean ?? NaN;
    const postRec = post_rerank_aggregated.chunk_recall[k]?.mean ?? NaN;
    md += `| **Chunk Recall@${k}** | ${formatPct(preRec)} | ${formatPct(postRec)} | ${formatDelta(preRec, postRec)} |\n`;

    const preMrr = pre_rerank_aggregated.chunk_mrr[k]?.mean ?? NaN;
    const postMrr = post_rerank_aggregated.chunk_mrr[k]?.mean ?? NaN;
    md += `| **Chunk MRR@${k}** | ${formatPct(preMrr)} | ${formatPct(postMrr)} | ${formatDelta(preMrr, postMrr)} |\n`;
  }
  md += `\n`;

  // Per category
  const categories = Object.keys(post_rerank_aggregated.by_category);
  if (categories.length > 0) {
    md += `## 5. Performance by Category\n\n`;
    md += `| Category | Queries | Recall@5 | MRR@5 | nDCG@5 |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: |\n`;
    for (const cat of categories) {
      const data = post_rerank_aggregated.by_category[cat];
      md += `| \`${cat}\` | ${data.query_count} | ${formatPct(data.paper_recall[5])} | ${formatPct(data.paper_mrr[5])} | ${formatPct(data.paper_ndcg[5])} |\n`;
    }
    md += `\n`;
  }

  // Failed / Errored
  if (failed_queries.length > 0) {
    md += `## 6. Failed Queries (${failed_queries.length})\n\n`;
    md += `| Query ID | Query | Error |\n`;
    md += `| :--- | :--- | :--- |\n`;
    for (const f of failed_queries) {
      md += `| \`${f.query_id}\` | ${f.query} | \`${f.error}\` |\n`;
    }
    md += `\n`;
  }

  return md;
}

export function saveMarkdownReport(
  suiteResult: RetrievalSuiteResult,
  outputDir: string,
  fileName?: string,
): string {
  const dir = path.resolve(outputDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const name =
    fileName ||
    `retrieval-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
  const fullPath = path.join(dir, name);

  const md = generateMarkdownReport(suiteResult);
  fs.writeFileSync(fullPath, md, 'utf8');
  return fullPath;
}
