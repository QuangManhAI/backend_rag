# RAG Retrieval Benchmark Report

**Generated At:** 2026-10-23T08:19:38.080Z  
**Dataset:** `C:\Users\ASUS\Music\TS_backend_rag\benchmark\datasets\samples\sample_evaluation.jsonl`  
**Adapter Type:** `MockRetrievalAdapter`  
**Execution Time:** 2 ms  

## 1. Summary Statistics

| Metric | Count / Value |
| :--- | :--- |
| **Total Queries Processed** | 15 |
| **Evaluated Queries (with Ground Truth)** | 13 |
| **Skipped Queries (Unanswerable / No GT)** | 2 |
| **Empty Retrievals (0 items returned)** | 0 (0.00%) |
| **Failed / Errored Queries** | 0 |

## 2. Latency Breakdown (Mean ms)

| Stage | Duration |
| :--- | :--- |
| Embedding (`embed_ms`) | 1 ms |
| Tree Routing (`route_ms`) | 1 ms |
| Qdrant Search (`search_ms`) | 2 ms |
| PageRank Rerank (`rerank_ms`) | 1 ms |
| **Total Retrieval Pipeline** | **0 ms** |

## 3. Paper-Level Metrics (Ablation: Pre-Rerank vs Post-Rerank)

> **Pre-Rerank:** Pure vector similarity from Qdrant  
> **Post-Rerank:** Cosine similarity (85%) + Author PageRank authority (15%)

| Metric @ K | Pre-Rerank | Post-Rerank | Delta (Improvement) |
| :--- | :---: | :---: | :---: |
| **Recall@1** | 73.08% | 73.08% | 0.00% |
| **MRR@1** | 76.92% | 76.92% | 0.00% |
| **nDCG@1** | 76.92% | 76.92% | 0.00% |
| **Precision@1** | 76.92% | 76.92% | 0.00% |
| **HitRate@1** | 76.92% | 76.92% | 0.00% |
| --- | --- | --- | --- |
| **Recall@3** | 73.08% | 73.08% | 0.00% |
| **MRR@3** | 76.92% | 76.92% | 0.00% |
| **nDCG@3** | 76.29% | 76.29% | 0.00% |
| **Precision@3** | 25.64% | 25.64% | 0.00% |
| **HitRate@3** | 76.92% | 76.92% | 0.00% |
| --- | --- | --- | --- |
| **Recall@5** | 73.08% | 73.08% | 0.00% |
| **MRR@5** | 76.92% | 76.92% | 0.00% |
| **nDCG@5** | 76.29% | 76.29% | 0.00% |
| **Precision@5** | 15.38% | 15.38% | 0.00% |
| **HitRate@5** | 76.92% | 76.92% | 0.00% |
| --- | --- | --- | --- |
| **Recall@10** | 73.08% | 73.08% | 0.00% |
| **MRR@10** | 76.92% | 76.92% | 0.00% |
| **nDCG@10** | 76.29% | 76.29% | 0.00% |
| **Precision@10** | 7.69% | 7.69% | 0.00% |
| **HitRate@10** | 76.92% | 76.92% | 0.00% |
| --- | --- | --- | --- |

## 4. Chunk-Level Metrics

| Metric @ K | Pre-Rerank | Post-Rerank | Delta |
| :--- | :---: | :---: | :---: |
| **Chunk Recall@1** | 20.00% | 20.00% | 0.00% |
| **Chunk MRR@1** | 20.00% | 20.00% | 0.00% |
| **Chunk Recall@3** | 40.00% | 40.00% | 0.00% |
| **Chunk MRR@3** | 30.00% | 30.00% | 0.00% |
| **Chunk Recall@5** | 40.00% | 40.00% | 0.00% |
| **Chunk MRR@5** | 30.00% | 30.00% | 0.00% |
| **Chunk Recall@10** | 40.00% | 40.00% | 0.00% |
| **Chunk MRR@10** | 30.00% | 30.00% | 0.00% |

## 5. Performance by Category

| Category | Queries | Recall@5 | MRR@5 | nDCG@5 |
| :--- | :---: | :---: | :---: | :---: |
| `cs.LG` | 5 | 70.00% | 80.00% | 78.35% |
| `cs.CL` | 6 | 83.33% | 83.33% | 83.33% |
| `cs.CV` | 2 | 50.00% | 50.00% | 50.00% |
| `biomedical` | 1 | 0.00% | 0.00% | 0.00% |
| `cooking` | 1 | 0.00% | 0.00% | 0.00% |

