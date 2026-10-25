import { IntegratedSuiteResult } from '../schemas/integrated.schema';

export function formatPct(val?: number): string {
  if (val === undefined || Number.isNaN(val)) return 'N/A';
  return `${(val * 100).toFixed(2)}%`;
}

export function generateTechnicalReport(result: IntegratedSuiteResult): string {
  const meta = result.metadata;
  const env = meta.environment;
  const suites = result.suites;
  const tradeoffs = result.tradeoffs;

  let md = `# RAG System Benchmark — Comprehensive Technical Report\n\n`;
  md += `> Báo cáo kỹ thuật chi tiết tích hợp toàn diện 3 khía cạnh: **Retrieval Quality**, **Generation Quality**, và **Runtime Performance** cho hệ thống Chatbot RAG tài liệu khoa học.\n\n`;

  // Section 1: Execution Metadata
  md += `## 1. Run Metadata & Environment\n\n`;
  md += `| Metadata Field | Value |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Run ID** | \`${meta.run_id}\` |\n`;
  md += `| **Timestamp** | \`${meta.timestamp}\` |\n`;
  md += `| **Overall Status** | **\`${meta.overall_status.toUpperCase()}\`** |\n`;
  md += `| **Total Duration** | ${meta.total_duration_ms} ms |\n`;
  md += `| **Git Commit** | \`${env.git_commit}\` |\n`;
  md += `| **Benchmark Version** | \`v${meta.benchmark_version}\` |\n`;
  md += `| **Dataset Version** | \`v${meta.dataset_version}\` |\n`;
  md += `| **OS / Platform** | \`${env.os_platform} (${env.os_release})\` |\n`;
  md += `| **Node.js Runtime** | \`${env.node_version}\` |\n`;
  md += `| **Host Hardware** | \`${env.cpu_model} (${env.cpu_cores} cores, ${env.total_ram_gb} GB RAM)\` |\n\n`;

  // Section 2: Suite Execution Status
  md += `## 2. Suite Execution Status\n\n`;
  md += `| Suite | Status | Duration | Raw Results File |\n`;
  md += `| :--- | :---: | :---: | :--- |\n`;
  md += `| **Retrieval Benchmark** | \`${suites.retrieval.status}\` | ${suites.retrieval.duration_ms} ms | \`${suites.retrieval.raw_file || 'N/A'}\` |\n`;
  md += `| **Generation Benchmark** | \`${suites.generation.status}\` | ${suites.generation.duration_ms} ms | \`${suites.generation.raw_file || 'N/A'}\` |\n`;
  md += `| **Runtime Benchmark** | \`${suites.runtime.status}\` | ${suites.runtime.duration_ms} ms | \`${suites.runtime.raw_file || 'N/A'}\` |\n\n`;

  // Section 3: Retrieval Quality Deep-Dive
  md += `## 3. Retrieval Quality Analysis\n\n`;
  if (suites.retrieval.status === 'completed' && suites.retrieval.data) {
    const rData = suites.retrieval.data;
    const pre = rData.pre_rerank_aggregated;
    const post = rData.post_rerank_aggregated;
    const kValues = rData.config.k_values || [1, 3, 5, 10];

    md += `### 3.1 Pre-rerank vs Post-rerank Ablation\n\n`;
    md += `| Metric @ K | Pre-Rerank (Cosine) | Post-Rerank (Authority Boost) | Delta Gain |\n`;
    md += `| :--- | :---: | :---: | :---: |\n`;
    for (const k of kValues) {
      const pRecall = pre.paper_recall[k]?.mean ?? 0;
      const poRecall = post.paper_recall[k]?.mean ?? 0;
      const diff = poRecall - pRecall;
      md += `| **Recall@${k}** | ${formatPct(pRecall)} | ${formatPct(poRecall)} | **${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(2)}%** |\n`;
    }
    for (const k of kValues) {
      const pMrr = pre.paper_mrr[k]?.mean ?? 0;
      const poMrr = post.paper_mrr[k]?.mean ?? 0;
      const diff = poMrr - pMrr;
      md += `| **MRR@${k}** | ${formatPct(pMrr)} | ${formatPct(poMrr)} | ${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(2)}% |\n`;
    }
    md += `\n`;
  } else {
    md += `> Suite Retrieval không hoàn thành hoặc bị bỏ qua: \`${suites.retrieval.error || 'No data'}\`\n\n`;
  }

  // Section 4: Generation Quality Deep-Dive
  md += `## 4. Generation Quality Analysis\n\n`;
  if (suites.generation.status === 'completed' && suites.generation.data) {
    const gData = suites.generation.data;
    const gm = gData.aggregated_metrics;

    md += `### 4.1 Grounding, Relevance & Correctness\n\n`;
    md += `| Metric Dimension | Measured Value | Benchmark Interpretation |\n`;
    md += `| :--- | :---: | :--- |\n`;
    md += `| **Faithfulness (Claim Grounding)** | **${formatPct(gm.mean_faithfulness_score)}** | ${gm.total_supported_claims} / ${gm.total_claims_evaluated} khẳng định được context hỗ trợ trực tiếp. |\n`;
    md += `| **Answer Relevance** | **${formatPct(gm.mean_relevance_score)}** | Độ phủ từ khóa câu hỏi: ${formatPct(gm.mean_query_coverage)} |\n`;
    md += `| **ROUGE-L F1 (vs Reference)** | **${formatPct(gm.mean_rouge_l_f1)}** | So sánh với ground truth tham chiếu. |\n`;
    md += `| **Token Overlap F1** | ${formatPct(gm.mean_token_f1)} | Mức độ trùng khớp token. |\n`;
    if (gm.judge_averages) {
      md += `| **LLM Judge Faithfulness** | **${gm.judge_averages.mean_faithfulness_score_1_to_5} / 5.0** | Rubric v${gData.config.rubric_version} |\n`;
      md += `| **LLM Judge Relevance** | **${gm.judge_averages.mean_relevance_score_1_to_5} / 5.0** | Đánh giá bám sát trọng tâm. |\n`;
    }
    md += `\n`;

    md += `### 4.2 Citation Correctness & Abstention Matrix\n\n`;
    md += `| Dimension | Metric | Value |\n`;
    md += `| :--- | :--- | :---: |\n`;
    md += `| **Citation ID Precision** | In-Context Paper IDs | **${formatPct(gm.mean_citation_id_precision)}** |\n`;
    md += `| **Hallucinated Citations** | IDs không tồn tại trong context | **${gm.total_hallucinated_citations}** |\n`;
    md += `| **Citation Support Ratio** | Context thực sự hỗ trợ khẳng định | **${formatPct(gm.mean_citation_support_ratio)}** |\n`;
    md += `| **Abstention Precision** | Độ chuẩn xác khi từ chối | **${formatPct(gm.abstention.abstention_precision)}** |\n`;
    md += `| **Abstention Recall** | Tỷ lệ nhận diện câu hỏi ngoài vùng tri thức | **${formatPct(gm.abstention.abstention_recall)}** |\n`;
    md += `| **Unsupported-Answer Rate** | Tỷ lệ trả lời bừa khi thiếu thông tin | **${formatPct(gm.abstention.unsupported_answer_rate)}** |\n\n`;
  } else {
    md += `> Suite Generation không hoàn thành hoặc bị bỏ qua: \`${suites.generation.error || 'No data'}\`\n\n`;
  }

  // Section 5: Runtime Performance Deep-Dive
  md += `## 5. Runtime & Load Performance Analysis\n\n`;
  if (suites.runtime.status === 'completed' && suites.runtime.data) {
    const scenarios = suites.runtime.data.scenarios;
    md += `| Scenario Name | Concurrency | Requests | Success % | p50 (ms) | p95 (ms) | p99 (ms) | TTFT p95 (ms) | Throughput (RPS) |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
    for (const sc of scenarios) {
      const sm = sc.aggregated_metrics;
      md += `| \`${sm.scenario}\` | ${sm.concurrency_level} | ${sm.total_requests} | **${sm.success_rate.toFixed(1)}%** | ${sm.total_latency.p50.toFixed(0)} | **${sm.total_latency.p95.toFixed(0)}** | ${sm.total_latency.p99.toFixed(0)} | ${sm.ttft?.p95 ? sm.ttft.p95.toFixed(0) : 'N/A'} | **${sm.throughput.completed_rps.toFixed(2)}** |\n`;
    }
    md += `\n`;
  } else {
    md += `> Suite Runtime không hoàn thành hoặc bị bỏ qua: \`${suites.runtime.error || 'No data'}\`\n\n`;
  }

  // Section 6: Cross-Phase Trade-offs
  md += `## 6. Cross-Phase Trade-off Analysis\n\n`;
  md += `- **Retrieval vs Generation Link:** ${tradeoffs.retrieval_generation_link.summary}\n`;
  md += `- **Concurrency Scaling & Queue Saturation:** ${tradeoffs.concurrency_scaling.summary} *(${tradeoffs.concurrency_scaling.p95_degradation})*\n`;
  md += `- **Reranking Cost-Benefit:** ${tradeoffs.rerank_impact.summary} *(${tradeoffs.rerank_impact.tradeoff_assessment})*\n`;
  md += `- **Citation Reliability:** ${tradeoffs.citation_reliability.summary}\n`;
  md += `- **Current System Bottleneck:** Thành phần **\`${tradeoffs.biggest_bottleneck.component.toUpperCase()}\`** — ${tradeoffs.biggest_bottleneck.reason} (*Tác động: ${tradeoffs.biggest_bottleneck.impact}*)\n\n`;

  // Section 7: Action Priority Matrix
  md += `## 7. Action Priority Matrix (Đề Xuất Ưu Tiên Cải Thiện)\n\n`;
  md += `| Ưu Tiên | Phân Loại | Vấn Đề Quan Sát Được | Bằng Chứng Kỹ Thuật | Hành Động Đề Xuất | Phương Pháp Xác Minh |\n`;
  md += `| :---: | :---: | :--- | :--- | :--- | :--- |\n`;
  for (const item of result.action_priorities) {
    md += `| **${item.priority}** | \`${item.classification}\` | ${item.observed_issue} | ${item.evidence} | ${item.proposed_action} | ${item.verification_method} |\n`;
  }
  md += `\n`;

  // Section 8: Limitations & Traceability
  md += `## 8. Data Limitations & Traceability\n\n`;
  md += `1. **Truy xuất nguồn:** Mọi con số trong báo cáo này được tổng hợp trực tiếp từ các file kết quả thô:\n`;
  md += `   - Retrieval: \`${suites.retrieval.raw_file || 'In-Memory'}\`\n`;
  md += `   - Generation: \`${suites.generation.raw_file || 'In-Memory'}\`\n`;
  md += `   - Runtime: \`${suites.runtime.raw_file || 'In-Memory'}\`\n`;
  md += `2. **Giới hạn thực nghiệm:**\n`;
  md += `   - Tập dữ liệu Ground Truth khoa học cần tiếp tục bổ sung thêm câu hỏi có reference answer gán nhãn thủ công.\n`;
  md += `   - LLM Judge sử dụng provider deterministic phục vụ kiểm thử tích hợp tự động không phụ thuộc network API bên ngoài.\n`;

  return md;
}
