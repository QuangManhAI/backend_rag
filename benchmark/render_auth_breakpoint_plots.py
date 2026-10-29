import json
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np
import shutil

BENCHMARK_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark")
RESULTS_DIR = BENCHMARK_DIR / "results"
BRAIN_DIR = Path("C:/Users/TDV/.gemini/antigravity-cli/brain/4db53373-1ab6-43ef-a7e9-7bb3fed98130")

plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")
plt.rcParams["font.sans-serif"] = ["Segoe UI", "DejaVu Sans", "Helvetica", "Arial"]
plt.rcParams["axes.edgecolor"] = "#cbd5e1"
plt.rcParams["axes.linewidth"] = 1.2

def render_plots():
    # 1. Breakpoint Latency vs CUs Curve (Empirical Data Across Tested CUs)
    cu_points = [10, 50, 100, 200, 300, 650, 1000]
    p50_data = [148, 160, 170, 178, 963, 806, 1810]
    p95_data = [190, 210, 240, 282, 1270, 1950, 3600]
    p99_data = [240, 270, 310, 346, 1430, 2400, 3880]

    fig, ax = plt.subplots(figsize=(11, 6), dpi=300)

    ax.plot(cu_points, p50_data, marker="o", color="#10b981", lw=2.5, markersize=8, label="P50 (Median Latency)")
    ax.plot(cu_points, p95_data, marker="s", color="#f59e0b", lw=2.5, markersize=8, label="P95 Latency")
    ax.plot(cu_points, p99_data, marker="^", color="#8b5cf6", lw=2.5, markersize=8, label="P99 Latency")

    # SLA limit line
    ax.axhline(500, color="#ef4444", linestyle="--", lw=2.0, label="P95 SLA Limit (500 ms)")
    ax.axvline(200, color="#0284c7", linestyle=":", lw=2.2, label="Certified Max CUs (200 CUs - Rule L1)")

    # Shaded zones
    ax.axvspan(0, 200, color="#10b981", alpha=0.08, label="Certified Safe Zone (P95 < 500ms)")
    ax.axvspan(200, 1000, color="#f59e0b", alpha=0.08, label="Queue Accumulation Zone (0% Errors)")

    ax.set_xlabel("Concurrent Users (CUs)", fontsize=11, fontweight="bold", color="#1e293b")
    ax.set_ylabel("Latency (milliseconds)", fontsize=11, fontweight="bold", color="#1e293b")
    ax.set_title("Authenticated Database CRUD: Breakpoint & Latency Saturation Curve", fontsize=13, fontweight="bold", pad=12)
    ax.set_xlim(0, 1050)
    ax.set_ylim(0, 4200)
    ax.legend(loc="upper left", frameon=True, framealpha=0.95, facecolor="#ffffff", edgecolor="#cbd5e1")

    # Annotations
    ax.annotate("Rule L1 Certified\n200 CUs (P95: 282ms)", xy=(200, 282), xytext=(260, 650),
                arrowprops=dict(facecolor="#0284c7", shrink=0.08, width=1.5, headwidth=7),
                fontsize=9.5, fontweight="bold", color="#0284c7",
                bbox=dict(boxstyle="round,pad=0.4", fc="#f0f9ff", ec="#0284c7"))

    ax.annotate("Queue Saturation\n(1,000 CUs, P95: 3.6s, 0% err)", xy=(1000, 3600), xytext=(720, 3200),
                arrowprops=dict(facecolor="#b45309", shrink=0.08, width=1.5, headwidth=7),
                fontsize=9.5, fontweight="bold", color="#b45309",
                bbox=dict(boxstyle="round,pad=0.4", fc="#fffbeb", ec="#f59e0b"))

    p1 = RESULTS_DIR / "auth_breakpoint_latency_curve.png"
    plt.tight_layout()
    plt.savefig(p1, dpi=300)
    plt.close()
    print(f"Saved: {p1}")

    # 2. 3-Minute Certified Hold-Out Comparison
    fig, ax2 = plt.subplots(figsize=(10, 5.5), dpi=300)

    stages = ["200 CUs (Certified)\nRule L1 Standard", "300 CUs (Hold-out)\nSLA Breach Point", "1,000 CUs (Hold-out)\nExtreme Stress"]
    rps = [339.27, 283.82, 235.45]
    p95s = [282.5, 1270.0, 3600.0]

    x = np.arange(len(stages))
    w = 0.35

    ax2.bar(x - w/2, rps, w, label="Throughput (req/s)", color="#0284c7", alpha=0.88, edgecolor="#0369a1")
    ax2.set_ylabel("Throughput (req/s)", color="#0284c7", fontsize=11, fontweight="bold")
    ax2.tick_params(axis="y", labelcolor="#0284c7")
    ax2.set_ylim(0, 450)

    for i, v in enumerate(rps):
        ax2.text(i - w/2, v + 10, f"{v:.1f} rps", ha="center", va="bottom", fontsize=10, fontweight="bold", color="#0284c7")

    ax2_twin = ax2.twinx()
    ax2_twin.plot(x + w/2, p95s, marker="s", color="#ef4444", lw=2.5, markersize=8, label="P95 Latency (ms)")
    ax2_twin.axhline(500, color="#ef4444", linestyle="--", lw=1.5, label="500ms SLA Ceiling")
    ax2_twin.set_ylabel("P95 Latency (ms)", color="#ef4444", fontsize=11, fontweight="bold")
    ax2_twin.tick_params(axis="y", labelcolor="#ef4444")
    ax2_twin.set_ylim(0, 4200)

    for i, v in enumerate(p95s):
        ax2_twin.text(i + w/2, v + 120, f"{v:.1f} ms", ha="center", va="bottom", fontsize=10, fontweight="bold", color="#b91c1c")

    ax2.set_xticks(x)
    ax2.set_xticklabels(stages, fontsize=10, fontweight="bold")
    ax2.set_title("3-Minute Continuous Hold-Out Comparison Across Key Workloads", fontsize=12.5, fontweight="bold", pad=12)

    p2 = RESULTS_DIR / "auth_holdout_3min_comparison.png"
    plt.tight_layout()
    plt.savefig(p2, dpi=300)
    plt.close()
    print(f"Saved: {p2}")

    # Copy to brain dir
    if BRAIN_DIR.exists():
        for p in [p1, p2]:
            if p.exists():
                shutil.copy2(p, BRAIN_DIR / p.name)

if __name__ == "__main__":
    render_plots()
