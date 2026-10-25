# RAG Generation Quality Benchmark Report

**Generated At:** 2026-10-23T08:16:42.708Z  
**Dataset:** `C:\Users\ASUS\Music\TS_backend_rag\benchmark\datasets\samples\sample_evaluation.jsonl`  
**Adapter:** `DefaultMockGenerationAdapter`  
**LLM Judge:** `MockJudgeProvider` (Rubric v1.0.0)  
**Evaluation Duration:** 3 ms  

## 1. Overall Generation Quality Scorecard

| Evaluation Dimension | Metric | Score / Ratio |
| :--- | :--- | :---: |
| **Faithfulness** | Mean Claim Grounding Score | **20.00%** |
| | Supported Claims / Total Claims | 3 / 15 |
| **Answer Relevance** | Mean Relevance Score | **31.58%** |
| | Question Keyword Coverage | 8.77% |
| **Answer Correctness** | ROUGE-L F1 (vs Reference) | **0.00%** |
| | Token Overlap F1 | 0.00% |
| | Exact Match Rate | 0.00% |
| **LLM Judge Score (1–5)** | Faithfulness (1–5) | **4.6 / 5.0** |
| | Correctness (1–5) | **0 / 5.0** |
| | Relevance (1–5) | **5 / 5.0** |

## 2. Citation Correctness Breakdown

| Level | Check | Value |
| :--- | :--- | :---: |
| **Level A: Format Validity** | Total Citations Found | 13 |
| **Level B: ID Validity** | In-Context ID Precision | **100.00%** |
| | Hallucinated Citation IDs | **0** |
| **Level C: Context Support** | Citation Support Ratio | **33.33%** |
| **Level D: Completeness** | Claims With Citations | **0.00%** |

## 3. Abstention & Refusal Matrix

> Đánh giá khả năng từ chối trả lời chuẩn xác (`NO_CONTEXT_ANSWER`) khi câu hỏi nằm ngoài cơ sở tri thức.

| Abstention Metric | Count / Percentage |
| :--- | :---: |
| **Total Expected Abstentions** | 2 |
| **Actual System Abstentions** | 2 |
| **True Abstentions (Correct Refusal)** | 2 |
| **False Abstentions (Unwarranted Refusal)** | 0 |
| **Unsupported Answers (Failed to Refuse)** | 0 |
| **Abstention Precision** | **100.00%** |
| **Abstention Recall** | **100.00%** |
| **False Abstention Rate** | 0.00% |
| **Unsupported-Answer Rate** | **0.00%** |

## 4. Performance by Category

| Category | Samples | Faithfulness | ROUGE-L F1 | Citation ID Precision |
| :--- | :---: | :---: | :---: | :---: |
| `cs.LG` | 5 | 60.00% | 0.00% | 100.00% |
| `cs.CL` | 6 | 0.00% | 0.00% | 100.00% |
| `cs.CV` | 2 | 0.00% | 0.00% | 100.00% |
| `biomedical` | 1 | 0.00% | 0.00% | 100.00% |
| `cooking` | 1 | 0.00% | 0.00% | 100.00% |

