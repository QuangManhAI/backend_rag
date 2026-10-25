import * as fs from 'fs';
import * as path from 'path';
import { GenerationSuiteResult } from '../runners/generation.runner';

export function formatPct(val: number): string {
  if (Number.isNaN(val) || val === undefined) return 'N/A';
  return `${(val * 100).toFixed(2)}%`;
}

export function generateGenerationMarkdownReport(
  suite: GenerationSuiteResult,
): string {
  const m = suite.aggregated_metrics;
  const cfg = suite.config;

  let md = `# RAG Generation Quality Benchmark Report\n\n`;
  md += `**Generated At:** ${new Date().toISOString()}  \n`;
  md += `**Dataset:** \`${cfg.dataset_path || 'In-Memory Sample'}\`  \n`;
  md += `**Adapter:** \`${cfg.adapter_name}\`  \n`;
  md += `**LLM Judge:** \`${cfg.judge_enabled ? cfg.judge_name : 'Disabled (Rule-based Evaluators only)'}\` (Rubric v${cfg.rubric_version})  \n`;
  md += `**Evaluation Duration:** ${suite.duration_ms} ms  \n\n`;

  md += `## 1. Overall Generation Quality Scorecard\n\n`;
  md += `| Evaluation Dimension | Metric | Score / Ratio |\n`;
  md += `| :--- | :--- | :---: |\n`;
  md += `| **Faithfulness** | Mean Claim Grounding Score | **${formatPct(m.mean_faithfulness_score)}** |\n`;
  md += `| | Supported Claims / Total Claims | ${m.total_supported_claims} / ${m.total_claims_evaluated} |\n`;
  md += `| **Answer Relevance** | Mean Relevance Score | **${formatPct(m.mean_relevance_score)}** |\n`;
  md += `| | Question Keyword Coverage | ${formatPct(m.mean_query_coverage)} |\n`;
  md += `| **Answer Correctness** | ROUGE-L F1 (vs Reference) | **${formatPct(m.mean_rouge_l_f1)}** |\n`;
  md += `| | Token Overlap F1 | ${formatPct(m.mean_token_f1)} |\n`;
  md += `| | Exact Match Rate | ${formatPct(m.exact_match_rate)} |\n`;

  if (m.judge_averages) {
    md += `| **LLM Judge Score (1–5)** | Faithfulness (1–5) | **${m.judge_averages.mean_faithfulness_score_1_to_5} / 5.0** |\n`;
    md += `| | Correctness (1–5) | **${m.judge_averages.mean_correctness_score_1_to_5} / 5.0** |\n`;
    md += `| | Relevance (1–5) | **${m.judge_averages.mean_relevance_score_1_to_5} / 5.0** |\n`;
  }
  md += `\n`;

  md += `## 2. Citation Correctness Breakdown\n\n`;
  md += `| Level | Check | Value |\n`;
  md += `| :--- | :--- | :---: |\n`;
  md += `| **Level A: Format Validity** | Total Citations Found | ${m.total_citations_found} |\n`;
  md += `| **Level B: ID Validity** | In-Context ID Precision | **${formatPct(m.mean_citation_id_precision)}** |\n`;
  md += `| | Hallucinated Citation IDs | **${m.total_hallucinated_citations}** |\n`;
  md += `| **Level C: Context Support** | Citation Support Ratio | **${formatPct(m.mean_citation_support_ratio)}** |\n`;
  md += `| **Level D: Completeness** | Claims With Citations | **${formatPct(m.mean_citation_completeness)}** |\n\n`;

  md += `## 3. Abstention & Refusal Matrix\n\n`;
  md += `> Đánh giá khả năng từ chối trả lời chuẩn xác (\`NO_CONTEXT_ANSWER\`) khi câu hỏi nằm ngoài cơ sở tri thức.\n\n`;
  md += `| Abstention Metric | Count / Percentage |\n`;
  md += `| :--- | :---: |\n`;
  md += `| **Total Expected Abstentions** | ${m.abstention.expected_abstention_count} |\n`;
  md += `| **Actual System Abstentions** | ${m.abstention.actual_abstention_count} |\n`;
  md += `| **True Abstentions (Correct Refusal)** | ${m.abstention.true_abstention_count} |\n`;
  md += `| **False Abstentions (Unwarranted Refusal)** | ${m.abstention.false_abstention_count} |\n`;
  md += `| **Unsupported Answers (Failed to Refuse)** | ${m.abstention.unsupported_answer_count} |\n`;
  md += `| **Abstention Precision** | **${formatPct(m.abstention.abstention_precision)}** |\n`;
  md += `| **Abstention Recall** | **${formatPct(m.abstention.abstention_recall)}** |\n`;
  md += `| **False Abstention Rate** | ${formatPct(m.abstention.false_abstention_rate)} |\n`;
  md += `| **Unsupported-Answer Rate** | **${formatPct(m.abstention.unsupported_answer_rate)}** |\n\n`;

  // Categories
  const categories = Object.keys(m.by_category);
  if (categories.length > 0) {
    md += `## 4. Performance by Category\n\n`;
    md += `| Category | Samples | Faithfulness | ROUGE-L F1 | Citation ID Precision |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: |\n`;
    for (const cat of categories) {
      const c = m.by_category[cat];
      md += `| \`${cat}\` | ${c.sample_count} | ${formatPct(c.mean_faithfulness)} | ${formatPct(c.mean_rouge_l)} | ${formatPct(c.citation_id_precision)} |\n`;
    }
    md += `\n`;
  }

  // Hallucination / Unsupported claims audit
  const queriesWithHallucinations = suite.results.filter(
    (r) => r.citations_eval.hallucinated_citations.length > 0,
  );

  if (queriesWithHallucinations.length > 0) {
    md += `## 5. Audit: Hallucinated Citations Log\n\n`;
    md += `| Query ID | Query | Hallucinated Paper IDs |\n`;
    md += `| :--- | :--- | :--- |\n`;
    for (const q of queriesWithHallucinations) {
      md += `| \`${q.query_id}\` | ${q.query} | \`${q.citations_eval.hallucinated_citations.join(', ')}\` |\n`;
    }
    md += `\n`;
  }

  return md;
}

export function saveGenerationReports(
  suiteResult: GenerationSuiteResult,
  outputDir: string,
  baseFileName?: string,
): { jsonPath: string; mdPath: string } {
  const dir = path.resolve(outputDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const prefix =
    baseFileName ||
    `generation-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const jsonPath = path.join(dir, `${prefix}.json`);
  const mdPath = path.join(dir, `${prefix}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(suiteResult, null, 2), 'utf8');
  fs.writeFileSync(mdPath, generateGenerationMarkdownReport(suiteResult), 'utf8');

  return { jsonPath, mdPath };
}
