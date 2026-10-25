# RAG Runtime & Load Benchmark Report

**Generated At:** undefined  
**Target Base URL:** `http://localhost:3000`  
**Total Scenarios Evaluated:** 4  

## 1. Scenario Comparison Overview

| Scenario | Concurrency | Requests | Success % | Throughput | p50 Latency | p95 Latency | Mean TTFT |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Scenario-A-Smoke** | 1 | 3 | 100.0% | 3 req/s | 109.74 ms | 117.22 ms | 82.27 ms |
| **Scenario-B-Baseline** | 1 | 10 | 100.0% | 10 req/s | 115.54 ms | 124.17 ms | 82.49 ms |
| **Scenario-C-Concurrency-1** | 1 | 6 | 100.0% | 6 req/s | 114.53 ms | 120.89 ms | 83.73 ms |
| **Scenario-C-Concurrency-2** | 2 | 6 | 100.0% | 6 req/s | 111.62 ms | 121.88 ms | 81.62 ms |

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
| **Total Latency (Client E2E)** | 111.51 ms | 109.74 ms | 116.39 ms | 117.22 ms | 117.88 ms | 106.73 ms | 118.05 ms |
| **TTFT (Time to First Token)** | 82.27 ms | 80.51 ms | 87.73 ms | 88.64 ms | 89.36 ms | 76.77 ms | 89.54 ms |
| **Completion Time** | 111.51 ms | 109.74 ms | 116.39 ms | 117.22 ms | 117.88 ms | 106.73 ms | 118.05 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 16.67 ms | 10 ms | 25 ms | 5.67 ms | 29.33 ms | **111.67 ms** |

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
| **Total Latency (Client E2E)** | 115.52 ms | 115.54 ms | 123.97 ms | 124.17 ms | 124.33 ms | 106.96 ms | 124.37 ms |
| **TTFT (Time to First Token)** | 82.49 ms | 82.16 ms | 84.62 ms | 84.94 ms | 85.2 ms | 79.71 ms | 85.26 ms |
| **Completion Time** | 115.52 ms | 115.54 ms | 123.97 ms | 124.17 ms | 124.33 ms | 106.96 ms | 124.37 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 17.9 ms | 10.2 ms | 23.5 ms | 6.4 ms | 33.1 ms | **115.4 ms** |

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
| **Total Latency (Client E2E)** | 114.99 ms | 114.53 ms | 119.23 ms | 120.89 ms | 122.22 ms | 109.14 ms | 122.55 ms |
| **TTFT (Time to First Token)** | 83.73 ms | 83.8 ms | 88.54 ms | 88.81 ms | 89.03 ms | 78.72 ms | 89.09 ms |
| **Completion Time** | 114.99 ms | 114.53 ms | 119.23 ms | 120.89 ms | 122.22 ms | 109.14 ms | 122.55 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 18.17 ms | 9.83 ms | 24.67 ms | 6 ms | 31 ms | **115 ms** |

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
| **Total Latency (Client E2E)** | 113.18 ms | 111.62 ms | 121.14 ms | 121.88 ms | 122.47 ms | 103.9 ms | 122.62 ms |
| **TTFT (Time to First Token)** | 81.62 ms | 82.59 ms | 84.98 ms | 85.11 ms | 85.21 ms | 75.96 ms | 85.23 ms |
| **Completion Time** | 113.18 ms | 111.62 ms | 121.14 ms | 121.88 ms | 122.47 ms | 103.9 ms | 122.62 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 16.33 ms | 9.83 ms | 24.5 ms | 5.67 ms | 31.67 ms | **113.33 ms** |

---

