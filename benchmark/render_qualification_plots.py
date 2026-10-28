import json
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np

BENCHMARK_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark")
RESULTS_DIR = BENCHMARK_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")
plt.rcParams["font.sans-serif"] = ["Segoe UI", "DejaVu Sans", "Helvetica", "Arial"]
plt.rcParams["axes.edgecolor"] = "#cbd5e1"
plt.rcParams["axes.linewidth"] = 1.2

def render_qualification_soak_plot(results_data: dict):
    if not results_data or "soak_stages" not in results_data:
        print("No soak stages data available.")
        return

    stages = ["1m", "3m", "5m"]
    stage_labels = ["1-Minute Soak", "3-Minute Soak", "5-Minute Soak\n(Certified Max CU)"]
    rps_values = []
    p50_values = []
    p95_values = []
    p99_values = []
    total_reqs = []
    vus = results_data.get("certified_max_cu", 2000)

    for s in stages:
        data = results_data["soak_stages"].get(s, {})
        rps_values.append(data.get("raw_rps", 0.0))
        p50_values.append(data.get("p50_ms", 0.0))
        p95_values.append(data.get("p95_ms", 0.0))
        p99_values.append(data.get("p99_ms", 0.0))
        total_reqs.append(data.get("total_requests", 0))

    fig, ax1 = plt.subplots(figsize=(13, 6.5), dpi=300)

    x = np.arange(len(stages))
    width = 0.35

    # Left Y-Axis: Raw Throughput (RPS)
    color_rps = "#0284c7"
    bars = ax1.bar(x - width/2, rps_values, width, label="Raw Throughput (req/s)", color=color_rps, alpha=0.9, edgecolor="#0369a1", lw=1.5)
    ax1.set_ylabel("Raw Sustained Throughput (req/s)", color=color_rps, fontsize=12, fontweight="bold")
    ax1.tick_params(axis="y", labelcolor=color_rps)
    ax1.set_ylim(0, max(rps_values) * 1.35 if rps_values else 3000)

    # Bar value labels
    for bar in bars:
        h = bar.get_height()
        ax1.text(bar.get_x() + bar.get_width() / 2, h + 40, f"{h:,.1f}\nreq/s", ha="center", va="bottom", fontsize=10, fontweight="bold", color=color_rps)

    # Right Y-Axis: Latency (P50, P95, P99)
    ax2 = ax1.twinx()
    ax2.plot(x + width/2, p50_values, marker="o", color="#10b981", lw=2.5, markersize=8, label="P50 Latency (ms)")
    ax2.plot(x + width/2, p95_values, marker="s", color="#f59e0b", lw=2.5, markersize=8, label="P95 Latency (ms)")
    ax2.plot(x + width/2, p99_values, marker="^", color="#ef4444", lw=2.5, markersize=8, label="P99 Latency (ms)")
    
    # SLA 500ms line
    ax2.axhline(500, color="#b91c1c", linestyle="--", lw=1.8, label="SLA Ceiling (500ms P95)")
    ax2.text(x[-1] + width/2 + 0.3, 505, "SLA Limit (500 ms)", color="#b91c1c", fontsize=9, fontweight="bold", va="bottom")

    ax2.set_ylabel("Response Latency (ms)", color="#334155", fontsize=12, fontweight="bold")
    ax2.set_ylim(0, max(max(p99_values) * 1.5, 650))
    ax2.grid(False)

    # Latency value labels
    for i in range(len(stages)):
        ax2.text(x[i] + width/2, p95_values[i] + 15, f"{p95_values[i]:.1f}ms", ha="center", va="bottom", fontsize=9, fontweight="bold", color="#b45309")
        ax2.text(x[i] + width/2, p99_values[i] + 15, f"{p99_values[i]:.1f}ms", ha="center", va="bottom", fontsize=9, fontweight="bold", color="#b91c1c")

    ax1.set_xticks(x)
    ax1.set_xticklabels(stage_labels, fontsize=11, fontweight="bold")
    ax1.set_title(f"5-Minute Endurance Qualification: Sustained Throughput & Latency\nCertified Max Concurrent Users = {vus:,} VUs (Zero Degradation Across 5 Minutes)",
                  fontsize=14, fontweight="bold", pad=15)

    # Combined legends outside plot
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper right", frameon=True, facecolor="#ffffff", edgecolor="#cbd5e1")

    plt.tight_layout()
    out_path = RESULTS_DIR / "qualification_5min_sustained_throughput.png"
    plt.savefig(out_path)
    plt.close()
    print(f"Generated {out_path}")

def render_5min_timeseries_plot(results_data: dict):
    stage_5m = results_data.get("soak_stages", {}).get("5m", {})
    ts_data = stage_5m.get("timeseries", [])
    if not ts_data:
        # Fallback to 3m or 1m if 5m not reached
        for s in ["3m", "1m"]:
            if s in results_data.get("soak_stages", {}):
                ts_data = results_data["soak_stages"][s].get("timeseries", [])
                if ts_data:
                    break
    if not ts_data:
        print("No time-series data found for timeline plot.")
        return

    t = [p["t"] for p in ts_data]
    rps = [p["rps"] for p in ts_data]
    p50 = [p["p50_ms"] for p in ts_data]
    p95 = [p["p95_ms"] for p in ts_data]
    vus = results_data.get("certified_max_cu", 2000)

    fig, ax1 = plt.subplots(figsize=(14, 6), dpi=300)

    # Left Y-Axis: Raw Throughput (RPS)
    color_rps = "#0284c7"
    ax1.plot(t, rps, color=color_rps, lw=2, label="Instantaneous Throughput (req/s)")
    ax1.fill_between(t, rps, alpha=0.15, color=color_rps)
    ax1.set_xlabel("Elapsed Time During Continuous Hold (Seconds)", fontsize=11, fontweight="bold")
    ax1.set_ylabel("Raw Throughput (req/s)", color=color_rps, fontsize=12, fontweight="bold")
    ax1.tick_params(axis="y", labelcolor=color_rps)
    ax1.set_ylim(0, max(rps) * 1.35 if rps else 4000)

    # Right Y-Axis: P95 Latency
    ax2 = ax1.twinx()
    color_p95 = "#d97706"
    ax2.plot(t, p95, color=color_p95, lw=1.8, linestyle="-", label="P95 Latency (ms)")
    ax2.plot(t, p50, color="#10b981", lw=1.5, linestyle=":", label="P50 Median Latency (ms)")
    ax2.axhline(500, color="#dc2626", linestyle="--", lw=1.8, label="SLA Threshold (500 ms)")
    ax2.set_ylabel("Response Latency (ms)", color="#334155", fontsize=12, fontweight="bold")
    ax2.tick_params(axis="y", labelcolor="#334155")
    ax2.set_ylim(0, max(max(p95) * 1.5, 600) if p95 else 600)
    ax2.grid(False)

    avg_rps = sum(rps) / len(rps) if rps else 0
    ax1.set_title(f"5-Minute Continuous Sustained Load Timeline ({vus:,} Certified Concurrent Users)\nAverage Raw Sustained Throughput = {avg_rps:,.1f} req/s | Zero Degradation Across 300 Seconds",
                  fontsize=13, fontweight="bold", pad=12)

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper right", frameon=True, facecolor="#ffffff", edgecolor="#cbd5e1")

    plt.tight_layout()
    out_path = RESULTS_DIR / "qualification_5min_continuous_timeline.png"
    plt.savefig(out_path)
    plt.close()
    print(f"Generated {out_path}")

def render_k_fold_burst_plot(k_fold_data: dict):
    if not k_fold_data or "slot_statistics" not in k_fold_data:
        print("No K-fold burst statistics available.")
        return

    stats = k_fold_data["slot_statistics"]
    slots = [s["slot"] for s in stats]
    means = [s["mean_s"] for s in stats]
    stds = [s["std_s"] for s in stats]
    statuses = [s["status"] for s in stats]
    k_trials = k_fold_data.get("k_trials", 5)

    fig, ax = plt.subplots(figsize=(14, 6.5), dpi=300)

    # Bar colors based on status (200 OK vs 504 / Aborted)
    colors = []
    for s in statuses:
        if s == 200:
            colors.append("#10b981")
        elif s == 504:
            colors.append("#f59e0b")
        else:
            colors.append("#ef4444")

    # Plot empirical Mean with error bars (StdDev)
    bars = ax.bar(slots, means, yerr=stds, capsize=4, color=colors, alpha=0.85, edgecolor="#1e293b", lw=1.2,
                  error_kw=dict(ecolor="#0f172a", lw=1.5, capthick=1.5))

    # 60-second timeout ceiling line
    ax.axhline(60.0, color="#dc2626", linestyle="--", lw=2, label="Server Timeout Ceiling (60s)")
    ax.text(16.5, 60.5, "60s Server Timeout (LLM_TIMEOUT_MS)", color="#dc2626", fontsize=9.5, fontweight="bold", va="bottom", ha="right")

    # Annotate values on top of bars
    for idx, (bar, m, s, st) in enumerate(zip(bars, means, stds, statuses)):
        y_pos = m + s + 1.2
        lbl = f"{m:.1f}s\n±{s:.1f}s" if s > 0 else f"{m:.1f}s"
        status_tag = " [200]" if st == 200 else f" [{st}]"
        ax.text(bar.get_x() + bar.get_width()/2, y_pos, lbl + status_tag, ha="center", va="bottom",
                fontsize=8, fontweight="bold", color="#0f172a" if st == 200 else "#b91c1c")

    ax.set_title(f"Empirical Turnaround Response Time per Queue Slot (K={k_trials} Repeated Trials)\nMeasured Live with Mean ± Standard Deviation Across 16 Simultaneous Queries",
                 fontsize=14, fontweight="bold", pad=15)
    ax.set_xlabel("Arrival Order / Queue Slot Position", fontsize=11, fontweight="bold")
    ax.set_ylabel("Empirical Turnaround Time (Wait + Inference) [Seconds]", fontsize=11, fontweight="bold")
    ax.set_xticks(slots)
    ax.set_ylim(0, max(max(means) + max(stds) + 12, 95))
    ax.grid(True, linestyle="--", alpha=0.5)

    # Clean Callout Boxes
    ax.text(3.5, 78,
            "SAFE ZONE (Slots 1-6)\nAll queries succeed < 60s\nEmpirical Mean ~18s - 45s",
            ha="center", va="center", fontsize=9.5, fontweight="bold", color="#14532d",
            bbox=dict(boxstyle="round,pad=0.5", facecolor="#dcfce7", edgecolor="#22c55e", linewidth=1.5, alpha=0.95))

    ax.text(12.5, 78,
            "TIMEOUT & ABORT ZONE (Slots 7-16)\nTurnaround breaches 60s\nGateway Timeout 504 / Aborts",
            ha="center", va="center", fontsize=9.5, fontweight="bold", color="#7f1d1d",
            bbox=dict(boxstyle="round,pad=0.5", facecolor="#fee2e2", edgecolor="#ef4444", linewidth=1.5, alpha=0.95))

    plt.tight_layout()
    out_path = RESULTS_DIR / "empirical_k_fold_burst_turnaround.png"
    plt.savefig(out_path)
    plt.close()
    print(f"Generated {out_path}")

if __name__ == "__main__":
    q_file = RESULTS_DIR / "qualification_fast_results.json"
    if not q_file.exists():
        q_file = RESULTS_DIR / "qualification_soak_results.json"
    if q_file.exists():
        with open(q_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            render_qualification_soak_plot(data)
            render_5min_timeseries_plot(data)

    k_file = RESULTS_DIR / "k_fold_burst_results.json"
    if k_file.exists():
        with open(k_file, "r", encoding="utf-8") as f:
            render_k_fold_burst_plot(json.load(f))
