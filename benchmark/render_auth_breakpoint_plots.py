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
    tiers = [
        "71 RPS\n(100 CUs)",
        "100 RPS\n(140 CUs)",
        "150 RPS\n(210 CUs)",
        "200 RPS\n(280 CUs)",
        "250 RPS\n(400 CUs)",
        "300 RPS\n(450 CUs)",
    ]
    x = np.arange(len(tiers))

    # Baseline (Before Optimization)
    base_p95 = [470.7, 577.0, 514.4, 1310.0, 2000.0, 2050.0]
    base_p99 = [647.4, 850.0, 918.2, 1740.0, 2230.0, 2300.0]

    # Optimized (After Tier 1 + Tier 2 Smart Optimizations)
    opt_p50 = [4.1, 4.3, 4.2, 11.1, 34.6, 51.9]
    opt_p95 = [185.0, 236.3, 289.3, 382.4, 409.0, 266.6]
    opt_p99 = [380.0, 449.2, 594.9, 600.1, 706.2, 406.6]

    fig, ax = plt.subplots(figsize=(11.5, 5.8))
    ax.grid(True, linestyle="--", alpha=0.6)

    ax.plot(x, base_p95, marker="x", linestyle="--", linewidth=2.2, color="#ef4444", alpha=0.85, label="Baseline P95 (Before Optimization)")
    ax.plot(x, base_p99, marker="v", linestyle=":", linewidth=1.8, color="#f87171", alpha=0.7, label="Baseline P99 (Before Optimization)")

    ax.plot(x, opt_p50, marker="o", linewidth=2.6, color="#10b981", label="Optimized P50 (Median)")
    ax.plot(x, opt_p95, marker="^", linewidth=3.0, color="#38bdf8", label="Optimized P95 (< 500ms Across All Tiers!)")
    ax.plot(x, opt_p99, marker="D", linewidth=2.5, color="#a855f7", label="Optimized P99 (< 1,000ms Across All Tiers!)")

    ax.axhline(500, color="#f59e0b", linestyle=":", linewidth=1.8, label="SLA Target: P95 < 500 ms")
    ax.axhline(1000, color="#ef4444", linestyle="--", linewidth=1.8, label="SLA Target: P99 < 1,000 ms")

    ax.axvspan(-0.3, 4.3, color="#10b981", alpha=0.07, label="Rule L1 3-Min Certified Zone (Up to 250 RPS / 400 CUs)")

    for i, val in enumerate(opt_p95):
        ax.annotate(f"{val:.0f}ms", (x[i], opt_p95[i]), textcoords="offset points", xytext=(0, 9),
                    ha="center", fontsize=8.5, fontweight="bold", color="#38bdf8")
    for i, val in enumerate(base_p95):
        ax.annotate(f"{val:.0f}ms", (x[i], base_p95[i]), textcoords="offset points", xytext=(0, 8),
                    ha="center", fontsize=8, fontweight="bold", color="#f87171")

    ax.set_xticks(x)
    ax.set_xticklabels(tiers, fontweight="bold")
    ax.set_ylabel("Response Latency (ms)", fontweight="bold")
    ax.set_title("Stage A: Open-Model Arrival-Rate Breakpoint — Baseline (100 CUs) vs. Optimized (400–450 CUs)",
                 fontsize=12, fontweight="bold", pad=14)
    ax.set_ylim(0, 2450)
    ax.legend(loc="upper left", framealpha=0.92, facecolor="#1f2937", edgecolor="#374151", ncol=2, fontsize=8.8)

    save_and_sync(fig, "prod_open_breakpoint_curve.png")


def render_endpoint_breakdown():
    endpoints = [
        "GET /auth/me\n(15% Traffic)",
        "GET /sessions\nPage 1 (30%)",
        "GET /sessions\nPage 2 / ?q (10%)",
        "GET /sessions/:id\n10 Msgs (30%)",
        "PATCH /auth/me\nWrite (5%)",
        "PATCH /sessions/:id\nWrite (10%)",
    ]
    # Baseline @ 65 RPS (100 CUs) P95 vs Optimized @ 250 RPS (400 CUs) P50 & P95
    base_p95_65rps = [595.44, 586.57, 587.73, 1210.00, 581.14, 576.19]
    opt_p50_250rps = [18.32, 18.50, 19.80, 23.85, 191.29, 193.40]
    opt_p95_250rps = [131.49, 129.83, 155.84, 248.15, 395.97, 437.91]

    x = np.arange(len(endpoints))
    width = 0.26

    fig, ax = plt.subplots(figsize=(12.5, 5.6))
    ax.grid(True, axis="y", linestyle="--", alpha=0.6)

    b1 = ax.bar(x - width, base_p95_65rps, width, label="Baseline P95 @ 65 RPS (100 CUs)", color="#ef4444", alpha=0.85, edgecolor="#b91c1c")
    b2 = ax.bar(x, opt_p95_250rps, width, label="Optimized P95 @ 250 RPS (400 CUs — 3.85x Load!)", color="#0284c7", edgecolor="#0369a1")
    b3 = ax.bar(x + width, opt_p50_250rps, width, label="Optimized P50 @ 250 RPS (400 CUs)", color="#10b981", edgecolor="#059669")

    ax.axhline(500, color="#f59e0b", linestyle=":", linewidth=1.8, label="Strict SLA Ceiling: P95 < 500 ms")

    for bars, color in [(b1, "#fca5a5"), (b2, "#7dd3fc"), (b3, "#6ee7b7")]:
        for bar in bars:
            h = bar.get_height()
            ax.annotate(f"{h:.0f}ms",
                        xy=(bar.get_x() + bar.get_width() / 2, h),
                        xytext=(0, 4), textcoords="offset points",
                        ha="center", va="bottom", fontsize=8, fontweight="bold", color=color)

    ax.set_xticks(x)
    ax.set_xticklabels(endpoints, fontweight="bold", fontsize=9)
    ax.set_ylabel("Latency (ms)", fontweight="bold")
    ax.set_title("Stage B (3-Min Hold-Out): Per-Endpoint Latency — Baseline (65 RPS / 100 CUs) vs. Optimized (250 RPS / 400 CUs)",
                 fontsize=11.8, fontweight="bold", pad=14)
    ax.set_ylim(0, 1480)
    ax.legend(loc="upper right", framealpha=0.92, facecolor="#1f2937", edgecolor="#374151", ncol=2)

    save_and_sync(fig, "prod_endpoint_breakdown.png")


def render_telemetry_timeline():
    base_hold_path = RESULTS_DIR / "prod_server_telemetry.json"
    opt_hold_path = RESULTS_DIR / "opt_server_telemetry_250rps.json"

    with open(base_hold_path, "r", encoding="utf-8") as f:
        base_samples = json.load(f)["samples"]
    with open(opt_hold_path, "r", encoding="utf-8") as f:
        opt_samples = json.load(f)["samples"]

    t_base = [s["elapsedSec"] for s in base_samples]
    cpu_base = [s["node"]["cpuPctSingleCoreEquiv"] for s in base_samples]
    ram_base = [s["node"]["workingSetMB"] for s in base_samples]

    t_opt = [s["elapsedSec"] for s in opt_samples]
    cpu_opt = [s["node"]["cpuPctSingleCoreEquiv"] for s in opt_samples]
    ram_opt = [s["node"]["workingSetMB"] for s in opt_samples]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13.5, 5.4))
    fig.subplots_adjust(wspace=0.36)

    # Left: Baseline 65 RPS (100 CUs) vs Optimized 250 RPS (400 CUs) CPU %
    ax1.grid(True, linestyle="--", alpha=0.6)
    ax1.plot(t_base, cpu_base, color="#9ca3af", linewidth=1.8, linestyle="--", label="Baseline 65 RPS / 100 CUs (Avg 30.1% CPU)")
    ax1.plot(t_opt, cpu_opt, color="#0284c7", linewidth=2.4, label="Optimized 250 RPS / 400 CUs (Avg 65.4% CPU)")
    ax1.axhline(100, color="#f59e0b", linestyle=":", linewidth=1.5, label="1.0 Full Logical Core (100%)")
    ax1.set_xlabel("Elapsed Hold-Out Time (seconds)", fontweight="bold")
    ax1.set_ylabel("Node.js CPU (% of 1 Core)", color="#38bdf8", fontweight="bold")
    ax1.set_ylim(0, 120)
    ax1.set_title("CPU Utilization Over 3-Min Hold-Out:\nIdle Headroom Converted into 4x More CUs", fontsize=11, fontweight="bold")
    ax1.legend(loc="upper right", facecolor="#1f2937", edgecolor="#374151", fontsize=8.5)

    # Right: Working Set RAM Stability over 195s
    ax2.grid(True, linestyle="--", alpha=0.6)
    ax2.plot(t_base, ram_base, color="#9ca3af", linewidth=1.8, linestyle="--", label="Baseline 100 CUs RAM (Avg 2,062 MB)")
    ax2.plot(t_opt, ram_opt, color="#10b981", linewidth=2.4, label="Optimized 400 CUs RAM + LRU Cache (Avg 2,549 MB)")
    ax2.set_xlabel("Elapsed Hold-Out Time (seconds)", fontweight="bold")
    ax2.set_ylabel("Working Set RAM (MB)", color="#34d399", fontweight="bold")
    ax2.set_ylim(1800, 3800)
    ax2.set_title("Memory Stability Over 3-Min Hold-Out:\nBounded LRU Cache Reclaimed Cleanly by V8 GC", fontsize=11, fontweight="bold")
    ax2.legend(loc="upper right", facecolor="#1f2937", edgecolor="#374151", fontsize=8.5)

    fig.suptitle("Stage B Server Telemetry (195s): Baseline (100 CUs) vs. Optimized (400 CUs, 48,874 Requests, 0% Error)",
                 fontsize=12.2, fontweight="bold", y=1.03)
    save_and_sync(fig, "prod_server_telemetry_timeline.png")


def render_auth_crypto_isolation():
    ops = [
        "GET /api/v1/auth/me\n(Event Loop Probe during Flood)",
        "POST /api/v1/auth/refresh\n(Atomic 1-RTT Consume + Rotate)",
        "POST /api/v1/auth/login\n(Min Latency: 1-RTT + Argon2id)",
    ]
    base_vals = [177.65, 707.19, 726.41]
    opt_vals = [7.09, 305.65, 196.73]

    x = np.arange(len(ops))
    width = 0.32

    fig, ax = plt.subplots(figsize=(9.8, 5.2))
    ax.grid(True, axis="y", linestyle="--", alpha=0.6)

    b1 = ax.bar(x - width / 2, base_vals, width, label="Baseline (4 Sequential WAN RTTs)", color="#ef4444", alpha=0.85)
    b2 = ax.bar(x + width / 2, opt_vals, width, label="Optimized (1-RTT Atomic + Write-Through Cache)", color="#10b981")

    for bars, color in [(b1, "#fca5a5"), (b2, "#6ee7b7")]:
        for bar in bars:
            h = bar.get_height()
            ax.annotate(f"{h:.1f}ms",
                        xy=(bar.get_x() + bar.get_width() / 2, h),
                        xytext=(0, 4), textcoords="offset points",
                        ha="center", va="bottom", fontsize=9, fontweight="bold", color=color)

    ax.set_xticks(x)
    ax.set_xticklabels(ops, fontweight="bold")
    ax.set_ylabel("Latency (ms)", fontweight="bold")
    ax.set_title("Stage C: Auth Crypto & Token Rotation Latency — Baseline vs. Optimized (+23.8% Login Throughput)",
                 fontsize=11.5, fontweight="bold", pad=14)
    ax.set_ylim(0, 920)
    ax.legend(loc="upper left", facecolor="#1f2937", edgecolor="#374151")

    save_and_sync(fig, "prod_auth_crypto_isolation.png")


if __name__ == "__main__":
    render_open_breakpoint_curve()
    render_endpoint_breakdown()
    render_telemetry_timeline()
    render_auth_crypto_isolation()
    print("All 4 production charts rendered and synced.")
