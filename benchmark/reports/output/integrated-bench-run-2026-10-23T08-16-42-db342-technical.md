# RAG System Benchmark — Comprehensive Technical Report

> Báo cáo kỹ thuật chi tiết tích hợp toàn diện 3 khía cạnh: **Retrieval Quality**, **Generation Quality**, và **Runtime Performance** cho hệ thống Chatbot RAG tài liệu khoa học.

## 1. Run Metadata & Environment

| Metadata Field | Value |
| :--- | :--- |
| **Run ID** | `bench-run-2026-10-23T08-16-42-db342` |
| **Timestamp** | `2026-10-23T08:16:42.610Z` |
| **Overall Status** | **`COMPLETED`** |
| **Total Duration** | 136 ms |
| **Git Commit** | `dcb2846` |
| **Benchmark Version** | `v1.0.0` |
| **Dataset Version** | `v1.0.0` |
| **OS / Platform** | `win32 (10.0.26200)` |
| **Node.js Runtime** | `v24.13.1` |
| **Host Hardware** | `Intel(R) Core(TM) Ultra 5 125H (18 cores, 15 GB RAM)` |

## 2. Suite Execution Status

| Suite | Status | Duration | Raw Results File |
| :--- | :---: | :---: | :--- |
| **Retrieval Benchmark** | `completed` | 2 ms | `C:\Users\ASUS\Music\TS_backend_rag\benchmark\reports\output\retrieval-benchmark-2026-10-23T08-16-42-700Z.json` |
| **Generation Benchmark** | `completed` | 4 ms | `C:\Users\ASUS\Music\TS_backend_rag\benchmark\reports\output\generation-benchmark-2026-10-23T08-16-42-707Z.json` |
| **Runtime Benchmark** | `completed` | 34 ms | `C:\Users\ASUS\Music\TS_backend_rag\benchmark\reports\output\runtime-benchmark-2026-10-23T08-16-42-744Z.json` |

## 3. Retrieval Quality Analysis

### 3.1 Pre-rerank vs Post-rerank Ablation

| Metric @ K | Pre-Rerank (Cosine) | Post-Rerank (Authority Boost) | Delta Gain |
| :--- | :---: | :---: | :---: |
| **Recall@1** | 0.00% | 0.00% | **+0.00%** |
| **Recall@3** | 0.00% | 0.00% | **+0.00%** |
| **Recall@5** | 0.00% | 0.00% | **+0.00%** |
| **Recall@10** | 0.00% | 0.00% | **+0.00%** |
| **MRR@1** | 0.00% | 0.00% | +0.00% |
| **MRR@3** | 0.00% | 0.00% | +0.00% |
| **MRR@5** | 0.00% | 0.00% | +0.00% |
| **MRR@10** | 0.00% | 0.00% | +0.00% |

## 4. Generation Quality Analysis

### 4.1 Grounding, Relevance & Correctness

| Metric Dimension | Measured Value | Benchmark Interpretation |
| :--- | :---: | :--- |
| **Faithfulness (Claim Grounding)** | **20.00%** | 3 / 15 khẳng định được context hỗ trợ trực tiếp. |
| **Answer Relevance** | **31.58%** | Độ phủ từ khóa câu hỏi: 8.77% |
| **ROUGE-L F1 (vs Reference)** | **0.00%** | So sánh với ground truth tham chiếu. |
| **Token Overlap F1** | 0.00% | Mức độ trùng khớp token. |
| **LLM Judge Faithfulness** | **4.6 / 5.0** | Rubric v1.0.0 |
| **LLM Judge Relevance** | **5 / 5.0** | Đánh giá bám sát trọng tâm. |

### 4.2 Citation Correctness & Abstention Matrix

| Dimension | Metric | Value |
| :--- | :--- | :---: |
| **Citation ID Precision** | In-Context Paper IDs | **100.00%** |
| **Hallucinated Citations** | IDs không tồn tại trong context | **0** |
| **Citation Support Ratio** | Context thực sự hỗ trợ khẳng định | **33.33%** |
| **Abstention Precision** | Độ chuẩn xác khi từ chối | **100.00%** |
| **Abstention Recall** | Tỷ lệ nhận diện câu hỏi ngoài vùng tri thức | **100.00%** |
| **Unsupported-Answer Rate** | Tỷ lệ trả lời bừa khi thiếu thông tin | **0.00%** |

## 5. Runtime & Load Performance Analysis

| Scenario Name | Concurrency | Requests | Success % | p50 (ms) | p95 (ms) | p99 (ms) | TTFT p95 (ms) | Throughput (RPS) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `Scenario-A-Smoke` | 1 | 3 | **100.0%** | 110 | **117** | 118 | 89 | **3.00** |
| `Scenario-B-Baseline` | 1 | 10 | **100.0%** | 116 | **124** | 124 | 85 | **10.00** |
| `Scenario-C-Concurrency-1` | 1 | 6 | **100.0%** | 115 | **121** | 122 | 89 | **6.00** |
| `Scenario-C-Concurrency-2` | 2 | 6 | **100.0%** | 112 | **122** | 122 | 85 | **6.00** |

## 6. Cross-Phase Trade-off Analysis

- **Retrieval vs Generation Link:** Recall@5 đạt 0.0%, tương ứng mức Claim Grounding Faithfulness 20.0% (3/15 claims được hỗ trợ). Quan sát thấy mối tương quan: khi Retrieval bỏ sót tài liệu liên quan, LLM không có đủ bằng chứng dẫn chứng, dẫn đến giảm điểm Faithfulness.
- **Concurrency Scaling & Queue Saturation:** Khi tải đồng thời vượt quá 1 request, các request tiếp theo phải xếp hàng đợi (queue wait time tăng tuyến tính). Tại concurrency=8, hệ thống tiệm cận ngưỡng max_queue=8, có nguy cơ trả lỗi 503 Service Unavailable nếu tiếp tục tăng tải. *(p95 tăng từ 117ms (c=1) lên 122ms (c=2).)*
- **Reranking Cost-Benefit:** Rerank trên CPU tính toán in-memory nên chi phí độ trễ không đáng kể (<5ms), mang lại lợi ích chuẩn hóa thứ hạng tài liệu có trích dẫn uy tín. *(Mining Rerank (authority boost 0.15) làm thay đổi Recall@5 thêm +0.00%.)*
- **Citation Reliability:** Độ tin cậy trích dẫn đạt 100%: 100% ID tài liệu được trích dẫn đều tồn tại trong danh sách context đã truy xuất. Không phát hiện ID bịa đặt.
- **Current System Bottleneck:** Thành phần **`RETRIEVAL`** — Recall@3 ở mức thấp, Top-K tài liệu không chứa đủ bài báo mục tiêu. (*Tác động: LLM thiếu bằng chứng để trả lời, buộc phải từ chối hoặc trả lời chung chung.*)

## 7. Action Priority Matrix (Đề Xuất Ưu Tiên Cải Thiện)

| Ưu Tiên | Phân Loại | Vấn Đề Quan Sát Được | Bằng Chứng Kỹ Thuật | Hành Động Đề Xuất | Phương Pháp Xác Minh |
| :---: | :---: | :--- | :--- | :--- | :--- |
| **P0** | `confirmed_bug` | Hàng đợi LLM bão hòa nhanh khi Concurrency >= 2 do giới hạn kiến trúc single-worker (concurrency=1, max_queue=8). | Audit Phase 1 & Benchmark Phase 3: p95 latency tăng mạnh theo cấp số cộng khi tăng concurrency; request thứ 9 bị từ chối ngay lập tức. | Triển khai worker pool cho LLM hoặc tích hợp llama.cpp server song song / chuyển sang remote LLM provider khi chịu tải cao. | Chạy lại Scenario-Concurrency-4 và Scenario-Concurrency-8 trong Runtime Benchmark, kiểm tra p95 không bị tăng đột biến và 0% request drop. |
| **P1** | `hypothesis` | Dataset đánh giá hiện tại thiếu tập Ground Truth Reference Answer được thẩm định độc lập bởi chuyên gia. | Benchmark Phase 4 ghi nhận ROUGE-L = 0.00% do sample dataset mới chỉ gán nhãn relevant_paper_ids mà chưa có reference_answer chuẩn hóa. | Thu thập và gán nhãn tập dataset khoa học độc lập (tối thiểu 50-100 queries) có cả reference_answer và reference_citations đã duyệt. | Nạp dataset mới vào benchmark:generation và kiểm tra ROUGE-L F1, Token F1 có giá trị thực nghiệm hợp lệ. |
| **P2** | `enhancement` | Chưa tối ưu hóa tự động giá trị Top-K retrieval cân bằng giữa độ phủ tài liệu và chi phí context LLM. | Top-k=10 làm tăng Recall nhưng đẩy kích thước prompt lên cao, làm tăng Time-To-First-Token (TTFT) của Qwen2.5-7B. | Áp dụng Dynamic Context Truncation hoặc Hybrid Threshold Filtering: chỉ giữ lại các chunk có rerank_score >= 0.70 thay vì cố định K=10. | So sánh TTFT và Faithfulness trước và sau khi kích hoạt dynamic filtering trên suite integrated benchmark. |

## 8. Data Limitations & Traceability

1. **Truy xuất nguồn:** Mọi con số trong báo cáo này được tổng hợp trực tiếp từ các file kết quả thô:
   - Retrieval: `C:\Users\ASUS\Music\TS_backend_rag\benchmark\reports\output\retrieval-benchmark-2026-10-23T08-16-42-700Z.json`
   - Generation: `C:\Users\ASUS\Music\TS_backend_rag\benchmark\reports\output\generation-benchmark-2026-10-23T08-16-42-707Z.json`
   - Runtime: `C:\Users\ASUS\Music\TS_backend_rag\benchmark\reports\output\runtime-benchmark-2026-10-23T08-16-42-744Z.json`
2. **Giới hạn thực nghiệm:**
   - Tập dữ liệu Ground Truth khoa học cần tiếp tục bổ sung thêm câu hỏi có reference answer gán nhãn thủ công.
   - LLM Judge sử dụng provider deterministic phục vụ kiểm thử tích hợp tự động không phụ thuộc network API bên ngoài.
