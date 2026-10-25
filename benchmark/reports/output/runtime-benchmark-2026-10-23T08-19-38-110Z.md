# RAG Runtime & Load Benchmark Report

**Generated At:** undefined  
**Target Base URL:** `http://localhost:3000`  
**Total Scenarios Evaluated:** 4  

## 1. Scenario Comparison Overview

| Scenario | Concurrency | Requests | Success % | Throughput | p50 Latency | p95 Latency | Mean TTFT |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Scenario-A-Smoke** | 1 | 3 | 100.0% | 3 req/s | 112.1 ms | 120.33 ms | 80.98 ms |
| **Scenario-B-Baseline** | 1 | 10 | 100.0% | 10 req/s | 117.23 ms | 123.08 ms | 84.31 ms |
| **Scenario-C-Concurrency-1** | 1 | 6 | 100.0% | 6 req/s | 113.37 ms | 119.97 ms | 82.4 ms |
| **Scenario-C-Concurrency-2** | 2 | 6 | 100.0% | 6 req/s | 117.79 ms | 121.49 ms | 82.49 ms |

## 2. Detailed Scenario Breakdown

### Scenario-A-Smoke

- **Execution Time:** 0 ms (Warm-up: undefined ms)
- **Total Requests:** 3 (Success: 3, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 3 completed req/s (3 success req/s)
- **HTTP Status Breakdown:** `200`: 3

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 114.88 ms | 112.1 ms | 119.41 ms | 120.33 ms | 121.06 ms | 111.31 ms | 121.24 ms |
| **TTFT (Time to First Token)** | 80.98 ms | 81.67 ms | 82.13 ms | 82.19 ms | 82.24 ms | 79.03 ms | 82.25 ms |
| **Completion Time** | 114.88 ms | 112.1 ms | 119.41 ms | 120.33 ms | 121.06 ms | 111.31 ms | 121.24 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 17 ms | 9.33 ms | 24 ms | 6 ms | 33.67 ms | **114.67 ms** |

---

### Scenario-B-Baseline

- **Execution Time:** 0 ms (Warm-up: undefined ms)
- **Total Requests:** 10 (Success: 10, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 10 completed req/s (10 success req/s)
- **HTTP Status Breakdown:** `200`: 10

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 117.08 ms | 117.23 ms | 122.71 ms | 123.08 ms | 123.37 ms | 109.92 ms | 123.44 ms |
| **TTFT (Time to First Token)** | 84.31 ms | 84.06 ms | 86.84 ms | 87.89 ms | 88.74 ms | 81.52 ms | 88.95 ms |
| **Completion Time** | 117.08 ms | 117.23 ms | 122.71 ms | 123.08 ms | 123.37 ms | 109.92 ms | 123.44 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 17.8 ms | 9.7 ms | 25.7 ms | 6.2 ms | 32.9 ms | **117.1 ms** |

---

### Scenario-C-Concurrency-1

- **Execution Time:** 0 ms (Warm-up: undefined ms)
- **Total Requests:** 6 (Success: 6, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 6 completed req/s (6 success req/s)
- **HTTP Status Breakdown:** `200`: 6

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 113.11 ms | 113.37 ms | 119.32 ms | 119.97 ms | 120.48 ms | 103.74 ms | 120.61 ms |
| **TTFT (Time to First Token)** | 82.4 ms | 82.63 ms | 85.64 ms | 85.96 ms | 86.21 ms | 78.11 ms | 86.27 ms |
| **Completion Time** | 113.11 ms | 113.37 ms | 119.32 ms | 119.97 ms | 120.48 ms | 103.74 ms | 120.61 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 18.17 ms | 9.17 ms | 24.17 ms | 5.83 ms | 30.83 ms | **113.33 ms** |

---

### Scenario-C-Concurrency-2

- **Execution Time:** 0 ms (Warm-up: undefined ms)
- **Total Requests:** 6 (Success: 6, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 6 completed req/s (6 success req/s)
- **HTTP Status Breakdown:** `200`: 6

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 117.68 ms | 117.79 ms | 120.93 ms | 121.49 ms | 121.94 ms | 113.54 ms | 122.05 ms |
| **TTFT (Time to First Token)** | 82.49 ms | 82.25 ms | 86.37 ms | 87.15 ms | 87.77 ms | 78.15 ms | 87.93 ms |
| **Completion Time** | 117.68 ms | 117.79 ms | 120.93 ms | 121.49 ms | 121.94 ms | 113.54 ms | 122.05 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 17 ms | 9.17 ms | 25 ms | 6.17 ms | 35.17 ms | **117.83 ms** |

---

