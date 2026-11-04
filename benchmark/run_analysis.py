import json
import os
from pathlib import Path
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns

RESULTS_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark/results")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

sns.set_theme(style="whitegrid", font_scale=1.05)
plt.rcParams["figure.dpi"] = 200

def parse_k6_json(filepath: Path) -> pd.DataFrame:
    records = []
    if not filepath.exists():
        print(f"File not found: {filepath}")
        return pd.DataFrame()
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                if entry.get("type") == "Point":
                    data = entry.get("data", {})
                    records.append({
                        "time": pd.to_datetime(data.get("time")),
                        "metric": entry.get("metric"),
                        "value": data.get("value"),
                        "status": str(data.get("tags", {}).get("status", "")),
                        "scenario": data.get("tags", {}).get("scenario", ""),
                    })
            except Exception:
                continue
    df = pd.DataFrame(records)
    print(f"Loaded {len(df)} points from {filepath.name}")
    return df

def analyze_fast_api():
    filepath = RESULTS_DIR / "fast_api_metrics.json"
    df = parse_k6_json(filepath)
    if df.empty:
        return
    
    durations = df[df["metric"] == "http_req_duration"].copy()
    vus = df[df["metric"] == "vus"].copy()
    
    durations["second"] = durations["time"].dt.floor("1s")
    vus["second"] = vus["time"].dt.floor("1s")
    
    sec_agg = durations.groupby("second")["value"].agg([
        ("p50", lambda x: np.percentile(x, 50)),
        ("p95", lambda x: np.percentile(x, 95)),
        ("p99", lambda x: np.percentile(x, 99)),
        ("count", "count"),
    ]).reset_index()
    
    vu_agg = vus.groupby("second")["value"].mean().reset_index().rename(columns={"value": "vus"})
    timeline = pd.merge(sec_agg, vu_agg, on="second", how="left").ffill()
    
    # Plot 1: Timeline
    fig, ax1 = plt.subplots(figsize=(13, 6))
    ax2 = ax1.twinx()
    
    ax1.plot(timeline["second"], timeline["p50"], label="P50 (Median)", color="#1f77b4", linewidth=2)
    ax1.plot(timeline["second"], timeline["p95"], label="P95 Latency", color="#ff7f0e", linewidth=2.5)
    ax1.plot(timeline["second"], timeline["p99"], label="P99 Latency", color="#d62728", linestyle="--", linewidth=1.8)
    ax1.axhline(300, color="red", linestyle=":", alpha=0.8, label="P95 SLA (300ms)")
    
    ax2.fill_between(timeline["second"], timeline["vus"], alpha=0.15, color="#2ca02c", label="Concurrent VUs")
    ax2.plot(timeline["second"], timeline["vus"], color="#2ca02c", linewidth=1.5, alpha=0.8)
    
    ax1.set_xlabel("Test Timeline", fontsize=12)
    ax1.set_ylabel("Latency (ms)", fontsize=12, color="#1f77b4")
    ax2.set_ylabel("Concurrent VUs", fontsize=12, color="#2ca02c")
    ax1.set_title("Fast API (GET /health): Latency (P50, P95, P99) vs Concurrent VUs", fontsize=14, fontweight="bold")
    ax1.legend(loc="upper left")
    ax2.legend(loc="upper right")
    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "fast_api_latency_vs_vus.png")
    plt.close()
    
    # Plot 2: Boxplot by Tier
    merged = pd.merge_asof(
        durations.sort_values("time"),
        vus.sort_values("time")[["time", "value"]].rename(columns={"value": "vus"}),
        on="time",
        direction="nearest"
    ).dropna(subset=["vus"])
    
    bins = [0, 15, 45, 75, 110]
    labels = ["1-15 VUs", "16-45 VUs", "46-75 VUs", "76-100 VUs"]
    merged["vu_tier"] = pd.cut(merged["vus"], bins=bins, labels=labels)
    
    plt.figure(figsize=(10, 5))
    sns.boxplot(data=merged, x="vu_tier", y="value", palette="Blues_r", showfliers=False)
    plt.title("Fast API: Latency Distribution Across Concurrency Tiers", fontsize=13, fontweight="bold")
    plt.xlabel("VU Concurrency Tier", fontsize=11)
    plt.ylabel("Latency (ms)", fontsize=11)
    plt.axhline(300, color="red", linestyle="--", alpha=0.7, label="SLA 300ms")
    plt.legend()
    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "fast_api_boxplot_by_tier.png")
    plt.close()
    print("Fast API charts generated.")

def analyze_rag_chat():
    filepath = RESULTS_DIR / "rag_chat_metrics.json"
    df = parse_k6_json(filepath)
    if df.empty:
        return
    
    durations = df[df["metric"] == "http_req_duration"].copy()
    vus = df[df["metric"] == "vus"].copy()
    
    rag_samples = pd.merge_asof(
        durations.sort_values("time"),
        vus.sort_values("time")[["time", "value"]].rename(columns={"value": "vus"}),
        on="time",
        direction="nearest"
    ).dropna(subset=["vus"])
    
    rag_samples["duration_s"] = rag_samples["value"] / 1000.0
    
    # Plot 3: Scatter Latency & Overflow Cliff
    plt.figure(figsize=(13, 6))
    palette = {"200": "#2ca02c", "429": "#d62728"}
    sns.scatterplot(
        data=rag_samples,
        x="vus",
        y="duration_s",
        hue="status",
        palette=palette,
        s=70,
        alpha=0.85
    )
    plt.axvline(9, color="crimson", linestyle="--", linewidth=2, label="Saturation Boundary (1 Active + 8 Queued)")
    plt.axhline(15, color="orange", linestyle=":", linewidth=2, label="P95 SLA Target (15s)")
    plt.title("RAG Chat: Request Latency & HTTP 429 Queue Overflow Cliff vs VUs", fontsize=14, fontweight="bold")
    plt.xlabel("Concurrent Virtual Users (VUs)", fontsize=12)
    plt.ylabel("Request Duration (Seconds)", fontsize=12)
    plt.legend(title="HTTP Status", loc="upper left")
    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "rag_latency_and_overflow_cliff.png")
    plt.close()
    
    # Plot 4: Success vs Error Rate by VU
    rag_samples["vu_stage"] = rag_samples["vus"].round().astype(int)
    crosstab = pd.crosstab(rag_samples["vu_stage"], rag_samples["status"], normalize="index") * 100
    
    fig, ax = plt.subplots(figsize=(11, 5))
    crosstab.plot(kind="bar", stacked=True, color=["#2ca02c", "#d62728"], ax=ax, width=0.6)
    plt.title("RAG Chat: Success Rate vs HTTP 429 Rejection Rate by Concurrency Level", fontsize=13, fontweight="bold")
    plt.xlabel("Concurrent Virtual Users (VUs)", fontsize=11)
    plt.ylabel("Request Proportion (%)", fontsize=11)
    plt.legend(title="HTTP Status", labels=["200 OK (Served)", "429 Too Many Requests (Queue Full)"])
    plt.xticks(rotation=0)
    plt.tight_layout()
    plt.savefig(RESULTS_DIR / "rag_error_rate_by_vu.png")
    plt.close()
    
    # Plot 5: Latency for Successful Requests
    success_only = rag_samples[rag_samples["status"] == "200"].copy()
    if not success_only.empty:
        plt.figure(figsize=(10, 5))
        sns.boxplot(data=success_only, x="vu_stage", y="duration_s", palette="Greens", showfliers=False)
        plt.title("RAG Chat: Successful Request Latency Progression under Queuing", fontsize=13, fontweight="bold")
        plt.xlabel("Concurrent Virtual Users (VUs)", fontsize=11)
        plt.ylabel("Inference + Queue Time (s)", fontsize=11)
        plt.axhline(15, color="orange", linestyle="--", label="15s SLA")
        plt.legend()
        plt.tight_layout()
        plt.savefig(RESULTS_DIR / "rag_success_latency_progression.png")
        plt.close()
    print("RAG Chat charts generated.")

if __name__ == "__main__":
    analyze_fast_api()
    analyze_rag_chat()
