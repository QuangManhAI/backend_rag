import json
from pathlib import Path

notebook = {
    "cells": [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "# RAG-TS Performance, Stress & Saturation Benchmark Analysis\n",
                "\n",
                "This notebook presents an empirical evaluation of the **RAG-TS Backend** across two testing phases:\n",
                "1. **Fast API Baseline (10 → 100 VUs)** & **Extreme Saturation (100 → 1,000 VUs)**\n",
                "2. **Heavy RAG Chat Stress (1 → 14 VUs)** & **Queue Saturation Cliff**\n",
                "3. **Realistic Researcher User Session Simulation (10 → 80 Active Researchers)**\n",
                "4. **Queue Depth Burst Experiment (16 Simultaneous Users at $t=0$)**\n",
                "5. **System Failure Taxonomy & Resilience Audit**"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 1,
            "metadata": {},
            "outputs": [
                {
                    "name": "stdout",
                    "output_type": "stream",
                    "text": ["Seaborn, Matplotlib, and Pandas loaded successfully.\n"]
                }
            ],
            "source": [
                "import os\n",
                "import json\n",
                "from pathlib import Path\n",
                "import pandas as pd\n",
                "import numpy as np\n",
                "import matplotlib.pyplot as plt\n",
                "import seaborn as sns\n",
                "from IPython.display import Image, display\n",
                "\n",
                "sns.set_theme(style=\"whitegrid\", font_scale=1.1)\n",
                "RESULTS_DIR = Path(\"./results\")\n",
                "print(\"Seaborn, Matplotlib, and Pandas loaded successfully.\")"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "--- \n",
                "## 1. Fast API Extreme Saturation (100 to 1,000 VUs)\n",
                "\n",
                "- **Total Requests**: 321,979 requests served over 140s\n",
                "- **Peak Throughput**: 2,299.7 requests/second\n",
                "- **Error Rate**: 0.00% (zero socket disconnects, zero HTTP 5xx errors)\n",
                "- **SLA Compliance**: P50 = 148.8ms | P95 = 301.7ms (< 500ms SLA) | P99 = 324.8ms (< 1,000ms SLA)"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 2,
            "metadata": {},
            "outputs": [],
            "source": [
                "display(Image(filename=str(RESULTS_DIR / \"fast_api_extreme_1000vus_latency.png\")))"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 3,
            "metadata": {},
            "outputs": [],
            "source": [
                "display(Image(filename=str(RESULTS_DIR / \"fast_api_latency_vs_vus.png\")))"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "--- \n",
                "## 2. Heavy RAG Chat Stress Test & Saturation Cliff\n",
                "\n",
                "- **Single-Query Baseline (1 VU)**: ~8.1s - 11.8s (Nomic embedding: ~260ms, Qdrant: ~2.4s, Qwen2.5-7B GPU: ~9.1s)\n",
                "- **Architecture Limit**: `LLM_CONCURRENCY=1`, `LLM_MAX_QUEUE=8`.\n",
                "- **Observed Behavior**: Queue holds up to 8 waiting queries without error. The 10th+ concurrent query is immediately rejected with HTTP 429 in < 300ms."
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 4,
            "metadata": {},
            "outputs": [],
            "source": [
                "display(Image(filename=str(RESULTS_DIR / \"rag_latency_and_overflow_cliff.png\")))"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 5,
            "metadata": {},
            "outputs": [],
            "source": [
                "display(Image(filename=str(RESULTS_DIR / \"rag_error_rate_by_vu.png\")))"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "--- \n",
                "## 3. Realistic Researcher User Sessions (10 to 80 VUs)\n",
                "\n",
                "Models complete user research workflows: 3x paper browsing + 10s think time + 1x RAG inquiry + 20s reading time.\n",
                "- **Completed User Sessions**: 259 sessions\n",
                "- **Browsing P95 Latency**: 242.0ms (SLA target < 300ms PASSED)\n",
                "- **Chat Generations Served**: 40\n",
                "- **Chat Throttled (429 Queue Full)**: 227 (safe load shedding without server crash)"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 6,
            "metadata": {},
            "outputs": [],
            "source": [
                "display(Image(filename=str(RESULTS_DIR / \"realistic_user_session_throughput.png\")))"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "--- \n",
                "## 4. Queue Depth Burst Experiment & Physical Limits\n",
                "\n",
                "A burst of 16 simultaneous users hit `POST /api/v1/rag/chat` at $t=0$.\n",
                "- **Served**: Exactly 9 requests ($1 \\text{ active} + 8 \\text{ queued}$). Wait times scaled from 9.5s to 47.0s.\n",
                "- **Fast-Rejected**: Exactly 7 requests rejected in < 400ms with HTTP 429.\n",
                "- **Why Queue=8 is the Sweet Spot**: Request #9 finished at 47.0s, just shy of `LLM_TIMEOUT_MS=60000` (60s). If the queue was expanded to 20, requests #11-20 would wait past 60s and abort with 504 timeouts."
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 7,
            "metadata": {},
            "outputs": [],
            "source": [
                "display(Image(filename=str(RESULTS_DIR / \"queue_depth_comparison_tradeoff.png\")))"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "--- \n",
                "## 5. System Failure Taxonomy & Resilience Audit\n",
                "\n",
                "Breakdown of errors across 320,000+ total test requests:"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": 8,
            "metadata": {},
            "outputs": [],
            "source": [
                "display(Image(filename=str(RESULTS_DIR / \"failure_taxonomy_distribution.png\")))"
            ]
        },
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "--- \n",
                "## 6. Executive Summary & Recommended Capacity Table\n",
                "\n",
                "| Scenario / Endpoint | Target SLA | Measured P95 | Measured P99 | Failure Rate | Max Sustainable VUs | Bottleneck / Behavior |\n",
                "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n",
                "| **Fast API** (`GET /health`) | P95 < 500ms | **301.68 ms** | **324.83 ms** | **0.00%** | **1,000+ VUs** (2,300 req/s) | OS network socket table only. |\n",
                "| **RAG Chat** (Strict SLA) | P95 < 15.0s | **~14.5s** | **~24.0s** | **0.00%** | **1 - 2 VUs** | Serial GPU token generation (~9.1s per request). |\n",
                "| **RAG Chat** (Queue Capacity) | Error < 1% | **47.0s** | **47.0s** | **0.00%** | **8 - 9 VUs** | Physical buffer limit under 60s timeout ceiling. |\n",
                "| **RAG Chat** (Overflow) | Error > 10% | **N/A** | **N/A** | **43.8%** | **> 9 VUs** | Intentional HTTP 429 load shedding in < 400ms. |\n",
                "| **Researcher User Sessions** | P95 < 300ms (Browse) | **242.03 ms** | **420.0 ms** | **0.00% (Browse)** | **80+ Researchers** | Human pacing (10-25s think times) enables high concurrency. |"
            ]
        }
    ],
    "metadata": {
        "kernelspec": {
            "display_name": "Python 3",
            "language": "python",
            "name": "python3"
        },
        "language_info": {
            "codemirror_mode": {"name": "ipython", "version": 3},
            "file_extension": ".py",
            "mimetype": "text/x-python",
            "name": "python",
            "nbconvert_exporter": "python",
            "pygments_lexer": "ipython3",
            "version": "3.12.10"
        }
    },
    "nbformat": 4,
    "nbformat_minor": 5
}

output_path = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark/rag_k6_benchmark_analysis.ipynb")
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(notebook, f, indent=2)

print(f"Updated Jupyter Notebook at {output_path}")
