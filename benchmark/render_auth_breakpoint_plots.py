import json
import shutil
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({
    "figure.facecolor": "#0b0f19",
    "axes.facecolor": "#111827",
    "axes.edgecolor": "#374151",
    "axes.labelcolor": "#e5e7eb",
    "text.color": "#f3f4f6",
    "xtick.color": "#9ca3af",
    "ytick.color": "#9ca3af",
    "grid.color": "#1f2937",
    "font.sans-serif": ["Segoe UI", "DejaVu Sans", "Arial"],
    "font.size": 10,
})

BENCH_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark")
RESULTS_DIR = BENCH_DIR / "results"
BRAIN_DIR = Path("C:/Users/TDV/.gemini/antigravity-cli/brain/4db53373-1ab6-43ef-a7e9-7bb3fed98130")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def save_and_sync(fig, filename: str):
    out_path = RESULTS_DIR / filename
    fig.savefig(out_path, dpi=300, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    if BRAIN_DIR.exists():
        shutil.copy2(out_path, BRAIN_DIR / filename)
    print(f"Saved {out_path}")


def render_open_breakpoint_curve():
    # Stage A Open-Model Arrival Rate tiers (calibrated + 100..300 RPS)
    tiers = ["71 RPS\n(Calibrated)", "100 RPS\n(Tier 1)", "150 RPS\n(Tier 2)", "200 RPS\n(Tier 3)", "250 RPS\n(Tier 4)", "300 RPS\n(Tier 5)"]
    x = np.arange(len(tiers))

    p50 = [205.2, 211.1, 194.4, 345.7, 1130.0, 1990.0]
    p90 = [410.2, 446.4, 400.6, 1050.0, 2000.0, 2000.0]
    p95 = [470.7, 577.0, 514.4, 1310.0, 2000.0, 2050.0]
    p99_max = [647.4, 850.0, 918.2, 1740.0, 2230.0, 2300.0]

    fig, ax = plt.subplots(figsize=(10.5, 5.5))
    ax.grid(True, linestyle="--", alpha=0.6)

    ax.plot(x, p50, marker="o", linewidth=2.5, color="#10b981", label="P50 (Median)")
    ax.plot(x, p90, marker="s", linewidth=2.5, color="#0284c7", label="P90 Latency")
    ax.plot(x, p95, marker="^", linewidth=2.8, color="#f59e0b", label="P95 Latency")
    ax.plot(x, p99_max, marker="D", linewidth=2.5, color="#ef4444", label="P99 / Max Tail")

    # SLA reference lines
    ax.axhline(500, color="#f59e0b", linestyle=":", linewidth=1.8, label="SLA Target: P95 < 500 ms")
    ax.axhline(1000, color="#ef4444", linestyle="--", linewidth=1.8, label="SLA Target: P99 < 1,000 ms")
    ax.axhline(2000, color="#dc2626", linestyle="-.", linewidth=1.5, label="Client Timeout Cliff (2,000 ms)")

    # Highlight SLA-compliant zone
    ax.axvspan(-0.3, 2.2, color="#10b981", alpha=0.08, label="Zero-Error Operating Zone (0% Drop)")

    for i, val in enumerate(p95):
        ax.annotate(f"{val:.0f}ms", (x[i], p95[i]), textcoords="offset points", xytext=(0, 8),
                    ha="center", fontsize=8.5, fontweight="bold", color="#fbbf24")

    ax.set_xticks(x)
    ax.set_xticklabels(tiers, fontweight="bold")
    ax.set_ylabel("Response Latency (ms)", fontweight="bold")
    ax.set_title("Stage A: Open-Model Arrival-Rate Breakpoint Curve (6-Endpoint Production Mix, 15,000 Seeded Messages)",
                 fontsize=12, fontweight="bold", pad=14)
    ax.set_ylim(0, 2500)
    ax.legend(loc="upper left", framealpha=0.9, facecolor="#1f2937", edgecolor="#374151", ncol=2)

    save_and_sync(fig, "prod_open_breakpoint_curve.png")


def render_endpoint_breakdown():
    # Stage B 3-Minute Hold-Out (65 RPS / 100 CUs, 12,812 reqs, 0.00% errors)
    endpoints = [
        "GET /auth/me\n(15% Traffic)\n[1 WAN Query]",
        "PATCH /auth/me\n(5% Traffic)\n[1 WAN Write]",
        "PATCH /sessions/:id\n(10% Traffic)\n[1 WAN Write]",
        "GET /sessions?cursor|q\n(10% Traffic)\n[Page 2 / Regex]",
        "GET /sessions\n(30% Traffic)\n[Page 1, 10 items]",
        "GET /sessions/:id\n(30% Traffic)\n[2 Seq Queries]",
    ]
    p50 = [174.56, 180.10, 180.40, 188.32, 188.57, 408.09]
    avg = [293.29, 304.10, 305.08, 307.72, 306.38, 634.74]
    p95 = [581.03, 576.57, 587.17, 586.93, 595.96, 1210.0]

    x = np.arange(len(endpoints))
    width = 0.25

    fig, ax = plt.subplots(figsize=(12.5, 5.6))
    ax.grid(True, axis="y", linestyle="--", alpha=0.6)

    b1 = ax.bar(x - width, p50, width, label="P50 (Median)", color="#10b981", edgecolor="#059669")
    b2 = ax.bar(x, avg, width, label="Mean (Avg)", color="#0284c7", edgecolor="#0369a1")
    b3 = ax.bar(x + width, p95, width, label="P95 Tail", color="#f59e0b", edgecolor="#d97706")

    ax.axhline(500, color="#f59e0b", linestyle=":", linewidth=1.6, label="P95 Target (500 ms)")
    ax.axhline(1000, color="#ef4444", linestyle="--", linewidth=1.6, label="P99 Target (1,000 ms)")

    for bars, color in [(b1, "#6ee7b7"), (b2, "#7dd3fc"), (b3, "#fde68a")]:
        for bar in bars:
            h = bar.get_height()
            ax.annotate(f"{h:.0f}",
                        xy=(bar.get_x() + bar.get_width() / 2, h),
                        xytext=(0, 4), textcoords="offset points",
                        ha="center", va="bottom", fontsize=8, fontweight="bold", color=color)

    ax.set_xticks(x)
    ax.set_xticklabels(endpoints, fontweight="bold", fontsize=9)
    ax.set_ylabel("Latency (ms)", fontweight="bold")
    ax.set_title("Stage B: 6-Endpoint Latency Breakdown Under 3-Minute Hold-Out (65 RPS / 100 CUs, 0.00% Error Rate)",
                 fontsize=12, fontweight="bold", pad=14)
    ax.set_ylim(0, 1400)
    ax.legend(loc="upper left", framealpha=0.9, facecolor="#1f2937", edgecolor="#374151", ncol=3)

    save_and_sync(fig, "prod_endpoint_breakdown.png")


def render_telemetry_timeline():
    hold_path = RESULTS_DIR / "prod_server_telemetry.json"
    cryp_path = RESULTS_DIR / "prod_crypto_telemetry.json"

    with open(hold_path, "r", encoding="utf-8") as f:
        hold_samples = json.load(f)["samples"]
    with open(cryp_path, "r", encoding="utf-8") as f:
        cryp_samples = json.load(f)["samples"]

    t_hold = [s["elapsedSec"] for s in hold_samples]
    cpu_hold = [s["node"]["cpuPctSingleCoreEquiv"] for s in hold_samples]
    ram_hold = [s["node"]["workingSetMB"] for s in hold_samples]

    t_cryp = [s["elapsedSec"] for s in cryp_samples]
    cpu_cryp = [s["node"]["cpuPctSingleCoreEquiv"] for s in cryp_samples]
    ram_cryp = [s["node"]["workingSetMB"] for s in cryp_samples]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13.5, 5.4))
    fig.subplots_adjust(wspace=0.36)

    # Left: Stage B 3-Minute Holdout Telemetry (I/O-Bound)
    ax1.grid(True, linestyle="--", alpha=0.6)
    l1 = ax1.plot(t_hold, cpu_hold, color="#0284c7", linewidth=2.2, label="Node.js CPU % (1-Core Equiv)")
    ax1.set_xlabel("Elapsed Time (seconds)", fontweight="bold")
    ax1.set_ylabel("CPU Utilization (% of 1 Core)", color="#38bdf8", fontweight="bold")
    ax1.set_ylim(0, 350)
    ax1.set_title("Stage B (3-Min CRUD Hold-Out):\nI/O-Bound (Avg 30.1% CPU, Flat 2,062 MB RAM)", fontsize=11, fontweight="bold")

    ax1_r = ax1.twinx()
    l2 = ax1_r.plot(t_hold, ram_hold, color="#10b981", linewidth=2.2, linestyle="--", label="Working Set RAM (MB)")
    ax1_r.set_ylabel("Working Set RAM (MB)", color="#34d399", fontweight="bold")
    ax1_r.set_ylim(1800, 2600)

    lines1 = l1 + l2
    ax1.legend(lines1, [l.get_label() for l in lines1], loc="upper right", facecolor="#1f2937", edgecolor="#374151")

    # Right: Stage C Auth Crypto Telemetry (CPU/Threadpool-Bound Argon2id)
    ax2.grid(True, linestyle="--", alpha=0.6)
    l3 = ax2.plot(t_cryp, cpu_cryp, color="#f59e0b", linewidth=2.4, label="Node.js CPU % (Peak 310.2% / 3.1 Cores)")
    ax2.axhline(300, color="#ef4444", linestyle=":", linewidth=1.4, label="libuv Threadpool Saturation (~3-4 Cores)")
    ax2.set_xlabel("Elapsed Time (seconds)", fontweight="bold")
    ax2.set_ylabel("CPU Utilization (% of 1 Core)", color="#fbbf24", fontweight="bold")
    ax2.set_ylim(0, 350)
    ax2.set_title("Stage C (Argon2id Login Flood):\nCPU-Bound (Peak 310.2% CPU, GC Reclaim to 2,100 MB)", fontsize=11, fontweight="bold")

    ax2_r = ax2.twinx()
    l4 = ax2_r.plot(t_cryp, ram_cryp, color="#a855f7", linewidth=2.2, linestyle="--", label="Working Set RAM (Peak 2,352 MB)")
    ax2_r.set_ylabel("Working Set RAM (MB)", color="#c084fc", fontweight="bold")
    ax2_r.set_ylim(1800, 2600)

    lines2 = l3 + l4
    ax2.legend(lines2, [l.get_label() for l in lines2], loc="upper left", facecolor="#1f2937", edgecolor="#374151", fontsize=8.5)

    fig.suptitle("Server Telemetry Comparison: I/O-Bound Session Workload vs CPU-Bound Argon2id Crypto Flood",
                 fontsize=12.5, fontweight="bold", y=1.03)
    save_and_sync(fig, "prod_server_telemetry_timeline.png")


def render_auth_crypto_isolation():
    ops = [
        "GET /api/v1/auth/me\n(Event Loop Probe during Flood)",
        "POST /api/v1/auth/refresh\n(SHA-256 Consume + Token Rotation)",
        "POST /api/v1/auth/login\n(Argon2id Verify + 4 WAN Queries)",
    ]
    p50 = [177.65, 707.19, 2730.0]
    avg = [319.99, 1300.0, 2840.0]
    p95 = [566.10, 2260.0, 5000.0]

    x = np.arange(len(ops))
    width = 0.25

    fig, ax = plt.subplots(figsize=(9.5, 5.0))
    ax.grid(True, axis="y", linestyle="--", alpha=0.6)

    b1 = ax.bar(x - width, p50, width, label="P50 (Median)", color="#10b981")
    b2 = ax.bar(x, avg, width, label="Mean (Avg)", color="#0284c7")
    b3 = ax.bar(x + width, p95, width, label="P95 Latency", color="#f59e0b")

    for bars, color in [(b1, "#6ee7b7"), (b2, "#7dd3fc"), (b3, "#fde68a")]:
        for bar in bars:
            h = bar.get_height()
            ax.annotate(f"{h:.0f}ms",
                        xy=(bar.get_x() + bar.get_width() / 2, h),
                        xytext=(0, 4), textcoords="offset points",
                        ha="center", va="bottom", fontsize=8.5, fontweight="bold", color=color)

    ax.set_xticks(x)
    ax.set_xticklabels(ops, fontweight="bold")
    ax.set_ylabel("Latency (ms)", fontweight="bold")
    ax.set_title("Stage C: Auth Crypto & Event Loop Isolation Under 50 Concurrent Logins",
                 fontsize=12, fontweight="bold", pad=14)
    ax.set_ylim(0, 5600)
    ax.legend(loc="upper left", facecolor="#1f2937", edgecolor="#374151")

    save_and_sync(fig, "prod_auth_crypto_isolation.png")


if __name__ == "__main__":
    render_open_breakpoint_curve()
    render_endpoint_breakdown()
    render_telemetry_timeline()
    render_auth_crypto_isolation()
    print("All 4 production charts rendered and synced.")
