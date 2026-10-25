# RAG Runtime & Load Benchmark Report

**Generated At:** 2026-10-23T07:45:23.222Z  
**Target Base URL:** `http://localhost:3000`  
**Total Scenarios Evaluated:** 10  

## 1. Scenario Comparison Overview

| Scenario | Concurrency | Requests | Success % | Throughput | p50 Latency | p95 Latency | Mean TTFT |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Scenario-A-Smoke** | 1 | 3 | 100.0% | 10.79 req/s | 91.81 ms | 94.08 ms | 50.76 ms |
| **Scenario-B-Baseline** | 1 | 10 | 100.0% | 10.44 req/s | 91.53 ms | 115.26 ms | 49.99 ms |
| **Scenario-C-Concurrency-1** | 1 | 6 | 100.0% | 10.91 req/s | 91.66 ms | 94.05 ms | 49.26 ms |
| **Scenario-C-Concurrency-2** | 2 | 6 | 100.0% | 11.26 req/s | 176.3 ms | 183.52 ms | 124.43 ms |
| **Scenario-C-Concurrency-4** | 4 | 12 | 100.0% | 10.83 req/s | 366.41 ms | 374.85 ms | 280.39 ms |
| **Scenario-C-Concurrency-8** | 8 | 24 | 100.0% | 10.71 req/s | 741.45 ms | 758.12 ms | 595.26 ms |
| **Scenario-D-Cache-Miss** | 1 | 5 | 100.0% | 10.73 req/s | 92.99 ms | 99.11 ms | 50.85 ms |
| **Scenario-D-Cache-Hit** | 1 | 5 | 100.0% | 10.68 req/s | 91.68 ms | 99.61 ms | 51.48 ms |
| **Scenario-E-Sustained** | 2 | 20 | 100.0% | 10.76 req/s | 183.33 ms | 191.73 ms | 139.31 ms |
| **Scenario-F-Failure-Handling** | 1 | 3 | 0.0% | 3 req/s | 0.01 ms | 0.01 ms | N/A |

## 2. Detailed Scenario Breakdown

### Scenario-A-Smoke

*Quick smoke test verifying API connectivity and response format*  

- **Execution Time:** 278 ms (Warm-up: 0 ms)
- **Total Requests:** 3 (Success: 3, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 10.79 completed req/s (10.79 success req/s)
- **HTTP Status Breakdown:** `200`: 3

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 92.59 ms | 91.81 ms | 93.83 ms | 94.08 ms | 94.28 ms | 91.62 ms | 94.33 ms |
| **TTFT (Time to First Token)** | 50.76 ms | 49.86 ms | 52.16 ms | 52.45 ms | 52.68 ms | 49.67 ms | 52.74 ms |
| **Completion Time** | 92.59 ms | 91.81 ms | 93.83 ms | 94.08 ms | 94.28 ms | 91.62 ms | 94.33 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 25 ms | 2 ms | 15 ms | 3 ms | 35 ms | **80 ms** |

#### Process Resource Utilization

- **Start RSS:** 398.88 MB | **Peak RSS:** 399.04 MB | **Delta RSS:** +0.16 MB
- **Start Heap:** 242.86 MB | **Peak Heap:** 243.31 MB | **Delta Heap:** +0.45 MB
- **Total CPU Time (Process):** 0 ms

---

### Scenario-B-Baseline

*Low-concurrency baseline measurement with separate warm-up*  

- **Execution Time:** 958 ms (Warm-up: 182 ms)
- **Total Requests:** 10 (Success: 10, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 10.44 completed req/s (10.44 success req/s)
- **HTTP Status Breakdown:** `200`: 10

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 95.71 ms | 91.53 ms | 96.78 ms | 115.26 ms | 130.05 ms | 90.5 ms | 133.75 ms |
| **TTFT (Time to First Token)** | 49.99 ms | 50.01 ms | 50.69 ms | 50.97 ms | 51.19 ms | 48.72 ms | 51.24 ms |
| **Completion Time** | 95.71 ms | 91.53 ms | 96.78 ms | 115.26 ms | 130.05 ms | 90.5 ms | 133.75 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 25 ms | 2 ms | 15 ms | 3 ms | 35 ms | **80 ms** |

#### Process Resource Utilization

- **Start RSS:** 399.04 MB | **Peak RSS:** 399.11 MB | **Delta RSS:** +0.07 MB
- **Start Heap:** 243.04 MB | **Peak Heap:** 243.14 MB | **Delta Heap:** +0.1 MB
- **Total CPU Time (Process):** 0 ms

---

### Scenario-C-Concurrency-1

*Concurrency test at concurrency level 1*  

- **Execution Time:** 550 ms (Warm-up: 91 ms)
- **Total Requests:** 6 (Success: 6, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 10.91 completed req/s (10.91 success req/s)
- **HTTP Status Breakdown:** `200`: 6

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 91.64 ms | 91.66 ms | 93.3 ms | 94.05 ms | 94.65 ms | 88.34 ms | 94.8 ms |
| **TTFT (Time to First Token)** | 49.26 ms | 49.72 ms | 49.89 ms | 49.94 ms | 49.99 ms | 46.75 ms | 50 ms |
| **Completion Time** | 91.64 ms | 91.66 ms | 93.3 ms | 94.05 ms | 94.65 ms | 88.34 ms | 94.8 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 25 ms | 2 ms | 15 ms | 3 ms | 35 ms | **80 ms** |

#### Process Resource Utilization

- **Start RSS:** 399.11 MB | **Peak RSS:** 399.11 MB | **Delta RSS:** 0 MB
- **Start Heap:** 243.16 MB | **Peak Heap:** 243.21 MB | **Delta Heap:** +0.05 MB
- **Total CPU Time (Process):** 0 ms

---

### Scenario-C-Concurrency-2

*Concurrency test at concurrency level 2*  

- **Execution Time:** 533 ms (Warm-up: 93 ms)
- **Total Requests:** 6 (Success: 6, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 11.26 completed req/s (11.26 success req/s)
- **HTTP Status Breakdown:** `200`: 6

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 163.82 ms | 176.3 ms | 182.6 ms | 183.52 ms | 184.26 ms | 90.29 ms | 184.44 ms |
| **TTFT (Time to First Token)** | 124.43 ms | 140.22 ms | 141.51 ms | 141.6 ms | 141.68 ms | 47.98 ms | 141.7 ms |
| **Completion Time** | 163.82 ms | 176.3 ms | 182.6 ms | 183.52 ms | 184.26 ms | 90.29 ms | 184.44 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 25 ms | 2 ms | 15 ms | 3 ms | 35 ms | **80 ms** |

#### Process Resource Utilization

- **Start RSS:** 399.11 MB | **Peak RSS:** 399.11 MB | **Delta RSS:** 0 MB
- **Start Heap:** 243.23 MB | **Peak Heap:** 243.28 MB | **Delta Heap:** +0.05 MB
- **Total CPU Time (Process):** 0 ms

---

### Scenario-C-Concurrency-4

*Concurrency test at concurrency level 4*  

- **Execution Time:** 1108 ms (Warm-up: 90 ms)
- **Total Requests:** 12 (Success: 12, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 10.83 completed req/s (10.83 success req/s)
- **HTTP Status Breakdown:** `200`: 12

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 322.04 ms | 366.41 ms | 373.96 ms | 374.85 ms | 374.93 ms | 91.45 ms | 374.95 ms |
| **TTFT (Time to First Token)** | 280.39 ms | 324.81 ms | 332.39 ms | 333.18 ms | 333.2 ms | 49.71 ms | 333.21 ms |
| **Completion Time** | 322.04 ms | 366.41 ms | 373.96 ms | 374.85 ms | 374.93 ms | 91.45 ms | 374.95 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 25 ms | 2 ms | 15 ms | 3 ms | 35 ms | **80 ms** |

#### Process Resource Utilization

- **Start RSS:** 399.12 MB | **Peak RSS:** 399.12 MB | **Delta RSS:** 0 MB
- **Start Heap:** 243.3 MB | **Peak Heap:** 243.38 MB | **Delta Heap:** +0.08 MB
- **Total CPU Time (Process):** 0 ms

---

### Scenario-C-Concurrency-8

*Concurrency test at concurrency level 8*  

- **Execution Time:** 2241 ms (Warm-up: 91 ms)
- **Total Requests:** 24 (Success: 24, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 10.71 completed req/s (10.71 success req/s)
- **HTTP Status Breakdown:** `200`: 24

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 637.72 ms | 741.45 ms | 756.17 ms | 758.12 ms | 758.2 ms | 92.03 ms | 758.22 ms |
| **TTFT (Time to First Token)** | 595.26 ms | 699.71 ms | 714.01 ms | 716.6 ms | 716.62 ms | 49.85 ms | 716.62 ms |
| **Completion Time** | 637.72 ms | 741.45 ms | 756.17 ms | 758.12 ms | 758.2 ms | 92.03 ms | 758.22 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 25 ms | 2 ms | 15 ms | 3 ms | 35 ms | **80 ms** |

#### Process Resource Utilization

- **Start RSS:** 399.12 MB | **Peak RSS:** 399.12 MB | **Delta RSS:** 0 MB
- **Start Heap:** 243.4 MB | **Peak Heap:** 243.53 MB | **Delta Heap:** +0.13 MB
- **Total CPU Time (Process):** 0 ms

---

### Scenario-D-Cache-Miss

*Measures latency on distinct novel queries (LRU miss)*  

- **Execution Time:** 466 ms (Warm-up: 0 ms)
- **Total Requests:** 5 (Success: 5, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 10.73 completed req/s (10.73 success req/s)
- **HTTP Status Breakdown:** `200`: 5

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 93.12 ms | 92.99 ms | 99.02 ms | 99.11 ms | 99.17 ms | 83.3 ms | 99.19 ms |
| **TTFT (Time to First Token)** | 50.85 ms | 50.35 ms | 54.52 ms | 55.59 ms | 56.45 ms | 47.81 ms | 56.67 ms |
| **Completion Time** | 93.12 ms | 92.99 ms | 99.02 ms | 99.11 ms | 99.17 ms | 83.3 ms | 99.19 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 25 ms | 2 ms | 15 ms | 3 ms | 35 ms | **80 ms** |

#### Process Resource Utilization

- **Start RSS:** 399.12 MB | **Peak RSS:** 399.12 MB | **Delta RSS:** 0 MB
- **Start Heap:** 243.57 MB | **Peak Heap:** 243.59 MB | **Delta Heap:** +0.02 MB
- **Total CPU Time (Process):** 0 ms

---

### Scenario-D-Cache-Hit

*Measures latency on repeated queries with identical text (LRU hit)*  

- **Execution Time:** 468 ms (Warm-up: 91 ms)
- **Total Requests:** 5 (Success: 5, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 10.68 completed req/s (10.68 success req/s)
- **HTTP Status Breakdown:** `200`: 5

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 93.57 ms | 91.68 ms | 99.5 ms | 99.61 ms | 99.7 ms | 85.65 ms | 99.72 ms |
| **TTFT (Time to First Token)** | 51.48 ms | 49.98 ms | 54.85 ms | 56.39 ms | 57.62 ms | 49.28 ms | 57.93 ms |
| **Completion Time** | 93.57 ms | 91.68 ms | 99.5 ms | 99.61 ms | 99.7 ms | 85.65 ms | 99.72 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 25 ms | 2 ms | 15 ms | 3 ms | 35 ms | **80 ms** |

#### Process Resource Utilization

- **Start RSS:** 399.12 MB | **Peak RSS:** 399.12 MB | **Delta RSS:** 0 MB
- **Start Heap:** 243.61 MB | **Peak Heap:** 243.64 MB | **Delta Heap:** +0.03 MB
- **Total CPU Time (Process):** 15 ms

---

### Scenario-E-Sustained

*Sustained load monitoring latency stability and queue behavior*  

- **Execution Time:** 1858 ms (Warm-up: 189 ms)
- **Total Requests:** 20 (Success: 20, Failed: 0, Timeouts: 0)
- **Error Rate:** 0.00% | **Timeout Rate:** 0.00%
- **Throughput:** 10.76 completed req/s (10.76 success req/s)
- **HTTP Status Breakdown:** `200`: 20

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 181.15 ms | 183.33 ms | 191.7 ms | 191.73 ms | 191.83 ms | 91.56 ms | 191.85 ms |
| **TTFT (Time to First Token)** | 139.31 ms | 141.89 ms | 149.92 ms | 149.93 ms | 149.95 ms | 50.45 ms | 149.96 ms |
| **Completion Time** | 181.15 ms | 183.33 ms | 191.7 ms | 191.73 ms | 191.83 ms | 91.56 ms | 191.85 ms |

#### Internal Server Stage Timings (Mean)

| Embedding (`embed_ms`) | Routing (`route_ms`) | Search (`search_ms`) | Reranking (`rerank_ms`) | LLM Gen (`llm_ms`) | Server Total |
| :---: | :---: | :---: | :---: | :---: | :---: |
| 25 ms | 2 ms | 15 ms | 3 ms | 35 ms | **80 ms** |

#### Process Resource Utilization

- **Start RSS:** 399.12 MB | **Peak RSS:** 399.12 MB | **Delta RSS:** -121.44 MB
- **Start Heap:** 243.66 MB | **Peak Heap:** 243.68 MB | **Delta Heap:** -40.11 MB
- **Total CPU Time (Process):** 204 ms

---

### Scenario-F-Failure-Handling

*Tests resilience against invalid categories, rate limits, and short timeouts*  

- **Execution Time:** 0 ms (Warm-up: 0 ms)
- **Total Requests:** 3 (Success: 0, Failed: 3, Timeouts: 0)
- **Error Rate:** 100.00% | **Timeout Rate:** 0.00%
- **Throughput:** 3 completed req/s (0 success req/s)
- **HTTP Status Breakdown:** `400`: 3

#### Latency & Streaming Timings

| Timing Metric | Mean | p50 | p90 | p95 | p99 | Min | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Total Latency (Client E2E)** | 0.01 ms | 0.01 ms | 0.01 ms | 0.01 ms | 0.01 ms | 0.01 ms | 0.01 ms |
| **TTFT (Time to First Token)** | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |
| **Completion Time** | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |

#### Process Resource Utilization

- **Start RSS:** 277.68 MB | **Peak RSS:** 277.68 MB | **Delta RSS:** 0 MB
- **Start Heap:** 203.59 MB | **Peak Heap:** 203.6 MB | **Delta Heap:** +0.01 MB
- **Total CPU Time (Process):** 0 ms

---

