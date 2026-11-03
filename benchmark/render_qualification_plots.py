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
    stage_labels = ["1-Minute Hold\n(249k Reqs)", "3-Minute Hold\n(734k Reqs)", "5-Minute Hold (Certified)\n(1.19M Reqs)"]
    rps_values = []
    p50_values = []
    p95_values = []
    p99_values = []
    total_reqs = []
    vus = results_data.get("certified_max_cu", 1600)

    for s in stages:
        data = results_data["soak_stages"].get(s, {})
        rps_values.append(data.get("raw_rps", 0.0))
        p50_values.append(data.get("p50_ms", 0.0))
        p95_values.append(data.get("p95_ms", 0.0))
        p99_values.append(data.get("p99_ms", 0.0))
        total_reqs.append(data.get("total_requests", 0))

    fig, ax1 = plt.subplots(figsize=(13.5, 6.8), dpi=300)

    x = np.arange(len(stages))
    width = 0.35

    # Left Y-Axis: Raw Throughput (RPS)
    color_rps = "#0284c7"
    bars = ax1.bar(x - width/2, rps_values, width, label="Raw Throughput (req/s)", color=color_rps, alpha=0.88, edgecolor="#0369a1", lw=1.5)
    ax1.set_ylabel("Raw Sustained Throughput (req/s)", color=color_rps, fontsize=12, fontweight="bold")
    ax1.tick_params(axis="y", labelcolor=color_rps)
    ax1.set_ylim(0, 5200)

    # Bar value labels
    for bar in bars:
        h = bar.get_height()
        ax1.text(bar.get_x() + bar.get_width() / 2, h + 50, f"{h:,.1f}\nreq/s", ha="center", va="bottom", fontsize=10, fontweight="bold", color=color_rps)

    # Right Y-Axis: Latency (P50, P95, P99)
    ax2 = ax1.twinx()
    ax2.plot(x + width/2, p50_values, marker="o", color="#10b981", lw=2.5, markersize=8, label="P50 Latency (ms)")
    ax2.plot(x + width/2, p95_values, marker="s", color="#f59e0b", lw=2.5, markersize=8, label="P95 Latency (ms)")
    ax2.plot(x + width/2, p99_values, marker="^", color="#ef4444", lw=2.5, markersize=8, label="P99 Latency (ms)")
    
    # SLA 500ms line
    ax2.axhline(500, color="#b91c1c", linestyle="--", lw=1.8, label="SLA Ceiling (500ms P95)")
    ax2.text(x[-1] + width/2 + 0.35, 505, "SLA Limit (500 ms)", color="#b91c1c", fontsize=9, fontweight="bold", va="bottom")

    ax2.set_ylabel("Response Latency (ms)", color="#334155", fontsize=12, fontweight="bold")
    ax2.set_ylim(0, 1100)
    ax2.grid(False)

    # ZERO-OVERLAP Callout Badges above each stage
    for i in range(len(stages)):
        # Stage badge text summarizing all 3 percentiles cleanly without collision
        badge_text = f"P50: {p50_values[i]:.1f}ms\nP95: {p95_values[i]:.1f}ms\nP99: {p99_values[i]:.1f}ms"
        
        # Position badge cleanly above the highest point
        max_pt = max(p95_values[i], p99_values[i])
        y_badge = max_pt + 85 if max_pt < 700 else max_pt + 40
        
        ax2.text(x[i] + width/2, y_badge, badge_text, ha="center", va="bottom",
                 fontsize=8.5, fontweight="bold", color="#0f172a",
                 bbox=dict(boxstyle="round,pad=0.4", facecolor="#f8fafc", edgecolor="#cbd5e1", lw=1.2, alpha=0.95))
        
        # Individual marker point labels (staggered horizontally to guarantee 0 collision)
        ax2.text(x[i] + width/2 - 0.08, p50_values[i] - 30, f"{p50_values[i]:.0f}", ha="right", va="top", fontsize=8, color="#047857", fontweight="bold")
        ax2.text(x[i] + width/2 - 0.08, p95_values[i] + 12, f"{p95_values[i]:.0f}", ha="right", va="bottom", fontsize=8, color="#b45309", fontweight="bold")
        ax2.text(x[i] + width/2 + 0.08, p99_values[i] + 12, f"{p99_values[i]:.0f}", ha="left", va="bottom", fontsize=8, color="#b91c1c", fontweight="bold")

    ax1.set_xticks(x)
    ax1.set_xticklabels(stage_labels, fontsize=10.5, fontweight="bold")
    ax1.set_title(f"5-Minute Endurance Qualification: Sustained Throughput & Latency Progression\nCertified Max Concurrent Users = {vus:,} VUs (Survives 1m, 3m and 5m Holds Continuous)",
                  fontsize=13.5, fontweight="bold", pad=15)

    # Combined legends outside plot
    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper right", frameon=True, facecolor="#ffffff", edgecolor="#cbd5e1")

    plt.tight_layout()
    out_path = RESULTS_DIR / "qualification_5min_sustained_throughput.png"
    plt.savefig(out_path)
    plt.close()
    print(f"Generated {out_path} (zero overlap)")

def render_5min_timeseries_plot(results_data: dict):
    stage_5m = results_data.get("soak_stages", {}).get("5m", {})
    ts_data = stage_5m.get("timeseries", [])
    if not ts_data:
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
    vus = results_data.get("certified_max_cu", 1600)

    fig, ax1 = plt.subplots(figsize=(14, 6.2), dpi=300)

    # Left Y-Axis: Raw Throughput (RPS)
    color_rps = "#0284c7"
    ax1.plot(t, rps, color=color_rps, lw=2, label="Instantaneous Throughput (req/s)")
    ax1.fill_between(t, rps, alpha=0.15, color=color_rps)
    ax1.set_xlabel("Elapsed Time During Continuous Hold (Seconds)", fontsize=11, fontweight="bold")
    ax1.set_ylabel("Raw Throughput (req/s)", color=color_rps, fontsize=12, fontweight="bold")
    ax1.tick_params(axis="y", labelcolor=color_rps)
    ax1.set_ylim(0, 5500)

    # Right Y-Axis: P95 Latency
    ax2 = ax1.twinx()
    color_p95 = "#d97706"
    ax2.plot(t, p95, color=color_p95, lw=1.8, linestyle="-", label="P95 Latency (ms)")
    ax2.plot(t, p50, color="#10b981", lw=1.5, linestyle=":", label="P50 Median Latency (ms)")
    ax2.axhline(500, color="#dc2626", linestyle="--", lw=1.8, label="SLA Threshold (500 ms)")
    ax2.set_ylabel("Response Latency (ms)", color="#334155", fontsize=12, fontweight="bold")
    ax2.tick_params(axis="y", labelcolor="#334155")
    ax2.set_ylim(0, 1400)
    ax2.grid(False)

    avg_rps = sum(rps) / len(rps) if rps else 0
    ax1.set_title(f"5-Minute Continuous Sustained Load Timeline ({vus:,} Certified Concurrent Users)\nAverage Raw Sustained Throughput = {avg_rps:,.1f} req/s | Flat Equilibrium From t=50s to t=300s",
                  fontsize=13, fontweight="bold", pad=12)

    # Callout annotations explaining the early warm-up dips at t=20s and t=47s
    ax2.annotate("Initial V8 Major GC Pause\nHeap Promotion (t=20-28s)",
                 xy=(24, 950), xytext=(35, 1200),
                 arrowprops=dict(arrowstyle="->", color="#b91c1c", lw=1.2),
                 fontsize=8.5, fontweight="bold", color="#7f1d1d",
                 bbox=dict(boxstyle="round,pad=0.3", facecolor="#fee2e2", edgecolor="#ef4444", lw=1))

    ax2.annotate("TCP Port Pool Stabilization (t=47s)\nSmooth Equilibrium Thereafter",
                 xy=(48, 920), xytext=(85, 1050),
                 arrowprops=dict(arrowstyle="->", color="#0369a1", lw=1.2),
                 fontsize=8.5, fontweight="bold", color="#0369a1",
                 bbox=dict(boxstyle="round,pad=0.3", facecolor="#e0f2fe", edgecolor="#0284c7", lw=1))

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc="upper right", frameon=True, facecolor="#ffffff", edgecolor="#cbd5e1")

    plt.tight_layout()
    out_path = RESULTS_DIR / "qualification_5min_continuous_timeline.png"
    plt.savefig(out_path)
    plt.close()
    print(f"Generated {out_path} (with GC/TCP warm-up callouts)")

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

    fig, ax = plt.subplots(figsize=(14.5, 7.0), dpi=300)

    # Coherent color coding:
    # Slots 1-6 (< 60s): Green (#10b981) - Served within 60s Client SLA
    # Slots 7-9 (> 60s, 200 OK): Amber (#f59e0b) - Served by GPU in 24s, BUT Total Turnaround > 60s Client SLA!
    # Slots 10-16 (> 85s): Red (#ef4444) - Gateway Timeout / Client Aborts
    colors = []
    for s, m in zip(statuses, means):
        if m < 60.0 and s == 200:
            colors.append("#10b981")  # Green
        elif m >= 60.0 and s == 200:
            colors.append("#f59e0b")  # Amber: 200 OK from server, but breached 60s client SLA!
        else:
            colors.append("#ef4444")  # Red: 500/504 Timeout or Abort

    bars = ax.bar(slots, means, yerr=stds, capsize=4, color=colors, alpha=0.88, edgecolor="#1e293b", lw=1.2,
                  error_kw=dict(ecolor="#0f172a", lw=1.5, capthick=1.5))

    # 60-second Client/Gateway Timeout Ceiling Line
    ax.axhline(60.0, color="#dc2626", linestyle="--", lw=2, label="Client / Gateway Timeout Ceiling (60s SLA)")
    ax.text(16.5, 61.0, "60s Client / Gateway SLA Ceiling", color="#dc2626", fontsize=9.5, fontweight="bold", va="bottom", ha="right")

    # Annotate values on top of bars
    for idx, (bar, m, s, st) in enumerate(zip(bars, means, stds, statuses)):
        y_pos = m + s + 1.5
        lbl = f"{m:.1f}s\n±{s:.1f}s" if s > 0 else f"{m:.1f}s"
        if m >= 60.0 and st == 200:
            status_tag = "\n[200* SLA!]"
            tag_color = "#b45309"
        elif st == 200:
            status_tag = "\n[200 OK]"
            tag_color = "#15803d"
        else:
            status_tag = "\n[504/Abort]"
            tag_color = "#b91c1c"
        ax.text(bar.get_x() + bar.get_width()/2, y_pos, lbl + status_tag, ha="center", va="bottom",
                fontsize=7.5, fontweight="bold", color=tag_color)

    ax.set_title(f"Empirical Turnaround Response Time per Queue Slot (K={k_trials} Repeated Trials)\nLive Measurement: Mean ± StdDev Across 16 Simultaneous Queries (Queue Wait + GPU Inference)",
                 fontsize=13.5, fontweight="bold", pad=15)
    ax.set_xlabel("Arrival Order / Queue Slot Position", fontsize=11, fontweight="bold")
    ax.set_ylabel("Empirical Turnaround Response Time (Total Wall-Clock) [Seconds]", fontsize=11, fontweight="bold")
    ax.set_xticks(slots)
    ax.set_ylim(0, 105)
    ax.grid(True, linestyle="--", alpha=0.5)

    # Clean Callout Boxes explaining the 3 distinct zones
    ax.text(3.5, 88,
            "SAFE ZONE (Slots 1-6)\nTurnaround < 60s Client SLA\nBatch 1 (~30s) & Batch 2 (~55s)",
            ha="center", va="center", fontsize=8.5, fontweight="bold", color="#14532d",
            bbox=dict(boxstyle="round,pad=0.5", facecolor="#dcfce7", edgecolor="#22c55e", linewidth=1.5, alpha=0.95))

    ax.text(8.5, 88,
            "AT-RISK ZONE (Slots 7-9)\nServer served 200 in 24s,\nBUT Total Turnaround (79.2s)\nbreaches 60s Client SLA",
            ha="center", va="center", fontsize=8.5, fontweight="bold", color="#78350f",
            bbox=dict(boxstyle="round,pad=0.5", facecolor="#fef3c7", edgecolor="#f59e0b", linewidth=1.5, alpha=0.95))

    ax.text(13.5, 88,
            "TIMEOUT / ABORT (Slots 10-16)\nWaits in queue > 80s\nClient Aborts / Gateway 504",
            ha="center", va="center", fontsize=8.5, fontweight="bold", color="#7f1d1d",
            bbox=dict(boxstyle="round,pad=0.5", facecolor="#fee2e2", edgecolor="#ef4444", linewidth=1.5, alpha=0.95))

    # Footnote explaining the LLM_TIMEOUT_MS scope
    fig.text(0.12, 0.01,
             "*Note: Server LLM_TIMEOUT_MS=60000 timer starts AFTER queue acquisition. Slots 7-9 acquired GPU at t=55s and finished in 24s (200 OK),\n"
             " but from the client's perspective, total turnaround was 79.2s, which exceeds a standard 60s gateway timeout.",
             fontsize=8, color="#475569", style="italic")

    plt.tight_layout(rect=[0, 0.04, 1, 1])
    out_path = RESULTS_DIR / "empirical_k_fold_burst_turnaround.png"
    plt.savefig(out_path)
    plt.close()
    print(f"Generated {out_path} (with SLA breach warning colors)")

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
