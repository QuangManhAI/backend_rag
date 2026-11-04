import json
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np

BENCHMARK_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark")
RESULTS_DIR = BENCHMARK_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
BRAIN_DIR = Path("C:/Users/TDV/.gemini/antigravity-cli/brain/4db53373-1ab6-43ef-a7e9-7bb3fed98130")

plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")
plt.rcParams["font.sans-serif"] = ["Segoe UI", "DejaVu Sans", "Helvetica", "Arial"]
plt.rcParams["axes.edgecolor"] = "#cbd5e1"
plt.rcParams["axes.linewidth"] = 1.2

def load_summary():
    summary_path = RESULTS_DIR / "auth_1000cu_summary.json"
    if not summary_path.exists():
        print(f"Summary file not found: {summary_path}")
        return None
    with open(summary_path, "r", encoding="utf-8") as f:
        return json.load(f)

def render_plots():
    summary = load_summary()
    if not summary:
        return

    metrics = summary.get("metrics", {})

    # 1. Latency Breakdown & SLA Compliance Plot
    fig, ax = plt.subplots(figsize=(12, 6.5), dpi=300)

    categories = [
        "GET /auth/me\n(50% Traffic - DB Read)",
        "GET /chat-sessions\n(40% Traffic - Pagination)",
        "PATCH /auth/me\n(10% Traffic - DB Write)",
        "Overall Authenticated\n(All Requests)"
    ]

    metric_keys = [
        "auth_me_duration",
        "sessions_list_duration",
        "profile_patch_duration",
        "http_req_duration"
    ]

    p50_list, p90_list, p95_list, p99_list = [], [], [], []

    for k in metric_keys:
        m = metrics.get(k, {}).get("values", {})
        p50_list.append(m.get("med", 0.0))
        p90_list.append(m.get("p(90)", 0.0))
        p95_list.append(m.get("p(95)", 0.0))
        p99_list.append(m.get("p(99)", m.get("max", 0.0)))

    x = np.arange(len(categories))
    width = 0.2

    b1 = ax.bar(x - 1.5 * width, p50_list, width, label="P50 (Median)", color="#10b981", alpha=0.9, edgecolor="#047857")
    b2 = ax.bar(x - 0.5 * width, p90_list, width, label="P90 Latency", color="#3b82f6", alpha=0.9, edgecolor="#1d4ed8")
    b3 = ax.bar(x + 0.5 * width, p95_list, width, label="P95 Latency", color="#f59e0b", alpha=0.9, edgecolor="#b45309")
    b4 = ax.bar(x + 1.5 * width, p99_list, width, label="P99 Latency", color="#8b5cf6", alpha=0.9, edgecolor="#6d28d9")

    # SLA Threshold lines
    ax.axhline(500, color="#ef4444", linestyle="--", linewidth=1.8, label="P95 SLA Limit (< 500 ms)")
    ax.axhline(1000, color="#b91c1c", linestyle=":", linewidth=2.0, label="P99 SLA Limit (< 1,000 ms)")

    ax.set_ylabel("Latency (milliseconds)", fontsize=12, fontweight="bold", color="#1e293b")
    ax.set_title("Authenticated Endpoints Latency & SLA Compliance (1,000 CUs Peak)", fontsize=14, fontweight="bold", pad=15)
    ax.set_xticks(x)
    ax.set_xticklabels(categories, fontsize=10, fontweight="bold")
    ax.legend(loc="upper left", frameon=True, framealpha=0.95, facecolor="#ffffff", edgecolor="#cbd5e1")
    
    max_val = max(max(p99_list) if p99_list else 1000, 1100)
    ax.set_ylim(0, max_val * 1.15)

    # Add value annotations on P95 and P99 bars
    for bar in b3:
        h = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2, h + 15, f"{h:.1f}ms", ha="center", va="bottom", fontsize=8.5, fontweight="bold", color="#b45309")
    for bar in b4:
        h = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2, h + 15, f"{h:.1f}ms", ha="center", va="bottom", fontsize=8.5, fontweight="bold", color="#6d28d9")

    out_p1 = RESULTS_DIR / "auth_1000cu_latency_percentiles.png"
    plt.tight_layout()
    plt.savefig(out_p1, dpi=300)
    plt.close()
    print(f"Saved: {out_p1}")

    # 2. Executive Throughput & Capacity Bar Plot
    fig, ax1 = plt.subplots(figsize=(10, 5.5), dpi=300)
    
    req_total = metrics.get("http_reqs", {}).get("values", {}).get("count", 0)
    req_rate = metrics.get("http_reqs", {}).get("values", {}).get("rate", 0.0)
    failed_rate = metrics.get("http_req_failed", {}).get("values", {}).get("rate", 0.0) * 100

    labels = ["1,000 CU Authenticated DB", "1,600 CU Gateway (/health)"]
    throughput_vals = [req_rate, 3958.53]
    colors = ["#0284c7", "#64748b"]

    bars = ax1.bar(labels, throughput_vals, color=colors, width=0.45, alpha=0.9, edgecolor="#0f172a", lw=1.2)
    ax1.set_ylabel("Throughput (Requests / Second)", fontsize=11, fontweight="bold")
    ax1.set_title("Throughput Comparison: Authenticated DB CRUD vs. Stateless Gateway", fontsize=13, fontweight="bold", pad=12)
    ax1.set_ylim(0, 4800)

    for bar, val in zip(bars, throughput_vals):
        ax1.text(bar.get_x() + bar.get_width() / 2, val + 90, f"{val:,.1f} req/s", ha="center", va="bottom", fontsize=11, fontweight="bold", color="#0f172a")

    # Add informative badge text
    ax1.text(0, throughput_vals[0] / 2, f"Total: {req_total:,} Reqs\nErrors: {failed_rate:.2f}%\nJWT + Mongo Read/Write", ha="center", va="center", fontsize=10, color="#ffffff", fontweight="bold")
    ax1.text(1, throughput_vals[1] / 2, "Total: 1.18M Reqs\nErrors: 0.00%\nStateless Event Loop", ha="center", va="center", fontsize=10, color="#ffffff", fontweight="bold")

    out_p2 = RESULTS_DIR / "auth_1000cu_throughput_comparison.png"
    plt.tight_layout()
    plt.savefig(out_p2, dpi=300)
    plt.close()
    print(f"Saved: {out_p2}")

    # Copy to brain dir
    if BRAIN_DIR.exists():
        import shutil
        for f in [out_p1, out_p2]:
            if f.exists():
                shutil.copy2(f, BRAIN_DIR / f.name)

if __name__ == "__main__":
    render_plots()
