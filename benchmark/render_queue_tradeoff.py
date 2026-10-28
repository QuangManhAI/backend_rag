import matplotlib.pyplot as plt
import numpy as np
from pathlib import Path

RESULTS_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark/results")

plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5.5), dpi=200)

# Left Subplot: Empirical Latency Progression for the 16 Burst Users
request_rank = np.arange(1, 17)
# 1 to 9 served (approx 9.5s, 14s, 19s, 23s, 28s, 33s, 37s, 42s, 47s)
served_latencies = [9.5, 14.1, 18.8, 23.3, 28.1, 33.0, 37.5, 42.2, 47.0]
# 10 to 16 rejected immediately in < 1s
rejected_latencies = [0.25, 0.28, 0.31, 0.34, 0.36, 0.40, 0.42]

ax1.scatter(range(1, 10), served_latencies, color="#2ca02c", s=90, label="Served (200 OK): 1 Active + 8 Queued", zorder=4)
ax1.plot(range(1, 10), served_latencies, color="#2ca02c", linestyle="-", linewidth=2, alpha=0.7)
ax1.scatter(range(10, 17), rejected_latencies, color="#d62728", marker="x", s=100, linewidth=2.5, label="Fast Rejected (429): Queue Full (<1s)", zorder=4)

ax1.axhline(60, color="crimson", linestyle="--", linewidth=2, label="Server Timeout Limit (LLM_TIMEOUT_MS=60s)")
ax1.axvline(9.5, color="gray", linestyle=":", linewidth=1.5, label="Queue Boundary (Max Queue = 8)")

ax1.set_title("Empirical Burst Test (16 Simultaneous Users at t=0)", fontsize=12, fontweight="bold")
ax1.set_xlabel("User Arrival Order / Slot", fontsize=11)
ax1.set_ylabel("Response Duration (Seconds)", fontsize=11)
ax1.set_xticks(range(1, 17))
ax1.legend(loc="upper left", fontsize=9.5)
ax1.set_ylim(-2, 70)

# Right Subplot: What happens if LLM_MAX_QUEUE is expanded to 20?
hypothetical_slots = np.arange(1, 17)
# With Queue=20, requests 10 to 16 wait in line instead of fast 429
hypothetical_latencies = [9.5 + (i - 1) * 5.2 for i in hypothetical_slots]

colors = ["#2ca02c" if lat < 60 else "#8b0000" for lat in hypothetical_latencies]
bars = ax2.bar(hypothetical_slots, hypothetical_latencies, color=colors, width=0.6, edgecolor="black", alpha=0.85)

ax2.axhline(60, color="crimson", linestyle="--", linewidth=2, label="60s Timeout Threshold (LLM_TIMEOUT_MS)")
ax2.text(12, 63, "FAIL: HTTP 504 / Aborted (Wait > 60s)", color="crimson", fontweight="bold", fontsize=10)

ax2.set_title("Hypothetical with LLM_MAX_QUEUE=20 (Queue Trap)", fontsize=12, fontweight="bold")
ax2.set_xlabel("User Arrival Order / Slot", fontsize=11)
ax2.set_ylabel("Expected Wait Time (Seconds)", fontsize=11)
ax2.set_xticks(range(1, 17))
ax2.legend(loc="upper left", fontsize=9.5)
ax2.set_ylim(0, 100)

plt.tight_layout()
output_path = RESULTS_DIR / "queue_depth_comparison_tradeoff.png"
plt.savefig(output_path)
plt.close()
print(f"Saved {output_path}")
