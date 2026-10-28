import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

RESULTS_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark/results")

plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")
plt.rcParams["font.family"] = "sans-serif"
plt.rcParams["font.sans-serif"] = ["Segoe UI", "DejaVu Sans", "Arial"]

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 6.5), dpi=250)

# ----------------- SUBPLOT 1: Empirical Burst Test (Queue=8) -----------------
# 16 users hitting simultaneously at t=0
slots_served = np.arange(1, 10)
latencies_served = [9.5, 14.1, 18.8, 23.3, 28.1, 33.0, 37.5, 42.2, 47.0]

slots_rejected = np.arange(10, 17)
latencies_rejected = [0.25, 0.28, 0.31, 0.34, 0.36, 0.40, 0.42]

# Plot served line & points
l1 = ax1.plot(slots_served, latencies_served, color="#16a34a", linewidth=2.8, marker="o", markersize=8, label="Served (200 OK): 1 Active + 8 Queued")
# Plot rejected markers
l2 = ax1.scatter(slots_rejected, latencies_rejected, color="#dc2626", marker="x", s=110, linewidths=2.5, label="Fast-Rejected (429): Queue Full (< 0.4s)", zorder=5)

# Boundary and threshold lines
l3 = ax1.axhline(60, color="#b91c1c", linestyle="--", linewidth=2.0, label="60s Server Timeout Ceiling (LLM_TIMEOUT_MS)")
l4 = ax1.axvline(9.5, color="#64748b", linestyle=":", linewidth=2.0, label="Queue Boundary (Max Queue = 8)")

# Clear callout annotation for max served request (Request 9)
ax1.annotate(
    "Req #9: 47.0s\n(Safely under 60s timeout)",
    xy=(9, 47.0),
    xytext=(6.2, 53),
    arrowprops=dict(facecolor="#16a34a", edgecolor="#16a34a", shrink=0.08, width=1.5, headwidth=6),
    fontsize=9.5,
    fontweight="bold",
    color="#14532d",
    bbox=dict(boxstyle="round,pad=0.4", facecolor="#dcfce7", edgecolor="#86efac", alpha=0.95)
)

# Callout for fast rejected
ax1.annotate(
    "Surplus Rejection\nin ~300ms",
    xy=(13, 0.5),
    xytext=(10.8, 12),
    arrowprops=dict(facecolor="#dc2626", edgecolor="#dc2626", shrink=0.08, width=1.5, headwidth=6),
    fontsize=9.5,
    fontweight="bold",
    color="#7f1d1d",
    bbox=dict(boxstyle="round,pad=0.4", facecolor="#fee2e2", edgecolor="#fca5a5", alpha=0.95)
)

ax1.set_title("Empirical Burst Test (16 Simultaneous Users at t=0)\nConfigured: LLM_MAX_QUEUE=8", fontsize=13, fontweight="bold", pad=12)
ax1.set_xlabel("User Arrival Order / Slot Position", fontsize=11, fontweight="bold")
ax1.set_ylabel("Turnaround Response Time (Seconds)", fontsize=11, fontweight="bold")
ax1.set_xticks(range(1, 17))
ax1.set_ylim(-3, 70)
ax1.grid(True, linestyle="--", alpha=0.5)

# Place legend cleanly at the top of the subplot with ample room
ax1.legend(loc="upper left", bbox_to_anchor=(0.02, 0.98), frameon=True, facecolor="#ffffff", edgecolor="#cbd5e1", fontsize=9.5)


# ----------------- SUBPLOT 2: Hypothetical Trap with Queue=20 -----------------
hypo_slots = np.arange(1, 17)
# Linear wait time as queue deepens
hypo_latencies = [9.5 + (i - 1) * 5.2 for i in hypo_slots]

bar_colors = ["#16a34a" if lat < 60 else "#b91c1c" for lat in hypo_latencies]
bars = ax2.bar(hypo_slots, hypo_latencies, color=bar_colors, width=0.62, edgecolor="#1e293b", linewidth=1.0, alpha=0.88)

ax2.axhline(60, color="#b91c1c", linestyle="--", linewidth=2.0)

# Annotate each bar value above the bar
for idx, (slot, lat) in enumerate(zip(hypo_slots, hypo_latencies)):
    if lat < 60:
        ax2.text(slot, lat + 1.5, f"{lat:.1f}s", ha="center", va="bottom", fontsize=8.5, fontweight="bold", color="#14532d")
    else:
        ax2.text(slot, lat + 1.5, f"{lat:.1f}s", ha="center", va="bottom", fontsize=8.5, fontweight="bold", color="#7f1d1d")

# Clean warning card above the 60s line
ax2.text(
    13.5, 78,
    "CRITICAL FAILURE ZONE\nRequests #11-16 wait > 60s\n-> Client Aborts / HTTP 504",
    ha="center", va="center",
    fontsize=9.5, fontweight="bold", color="#7f1d1d",
    bbox=dict(boxstyle="round,pad=0.5", facecolor="#fee2e2", edgecolor="#ef4444", linewidth=1.5, alpha=0.95)
)

ax2.text(
    5.5, 78,
    "SAFE SERVED ZONE\nRequests #1-10 finish < 60s",
    ha="center", va="center",
    fontsize=9.5, fontweight="bold", color="#14532d",
    bbox=dict(boxstyle="round,pad=0.5", facecolor="#dcfce7", edgecolor="#22c55e", linewidth=1.5, alpha=0.95)
)

ax2.set_title("Hypothetical with LLM_MAX_QUEUE=20 (The Queue Trap)\nExceeding Server Timeout Ceiling Causes Cascading Aborts", fontsize=13, fontweight="bold", pad=12)
ax2.set_xlabel("User Arrival Order / Slot Position", fontsize=11, fontweight="bold")
ax2.set_ylabel("Expected Wait Time (Seconds)", fontsize=11, fontweight="bold")
ax2.set_xticks(range(1, 17))
ax2.set_ylim(0, 105)
ax2.grid(True, linestyle="--", alpha=0.5)

plt.tight_layout(pad=2.5)
output_path = RESULTS_DIR / "queue_depth_comparison_tradeoff.png"
plt.savefig(output_path)
plt.close()
print(f"Redesigned and saved {output_path}")
