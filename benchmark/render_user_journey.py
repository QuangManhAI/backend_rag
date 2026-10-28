import matplotlib.pyplot as plt
import matplotlib.patches as patches
from pathlib import Path

RESULTS_DIR = Path(__file__).resolve().parent / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

plt.style.use("seaborn-v0_8-whitegrid" if "seaborn-v0_8-whitegrid" in plt.style.available else "default")
plt.rcParams["font.sans-serif"] = ["Segoe UI", "DejaVu Sans", "Helvetica", "Arial"]
plt.rcParams["axes.edgecolor"] = "#cbd5e1"
plt.rcParams["axes.linewidth"] = 1.2

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(15, 7.5), gridspec_kw={"height_ratios": [1.2, 1.4]}, dpi=300)

# ----------------- Subplot 1: Single Researcher Journey Sequence -----------------
ax1.set_xlim(-1, 62)
ax1.set_ylim(-0.5, 3.5)
ax1.axis("off")

ax1.text(-0.5, 3.2, "Phase A: Realistic Single Researcher Journey (55s Timeline)", fontsize=13, fontweight="bold", color="#0f172a")
ax1.text(-0.5, 2.7, "Repeated browsing actions interleaved with human think/read time, culminating in one deep LLM query.", fontsize=10, color="#64748b")

# Journey Steps: (x_start, duration, label, sublabel, color, text_color, y_offset, height)
steps = [
    (0, 0.5, "1. Health & Docs", "GET /api/health (120ms)", "#38bdf8", "#0369a1", 0.5, 0.9),
    (0.5, 7.5, "Think Time", "Reading document list (7.5s)", "#f1f5f9", "#64748b", 0.5, 0.9),
    (8.0, 0.6, "2. Search Docs", "GET /api/documents (240ms)", "#38bdf8", "#0369a1", 0.5, 0.9),
    (8.6, 6.4, "Think Time", "Reviewing abstracts (6.4s)", "#f1f5f9", "#64748b", 0.5, 0.9),
    (15.0, 0.5, "3. Select Doc", "GET /api/docs/:id (180ms)", "#38bdf8", "#0369a1", 0.5, 0.9),
    (15.5, 6.5, "Think Time", "Composing question (6.5s)", "#f1f5f9", "#64748b", 0.5, 0.9),
    (22.0, 18.0, "4. RAG Chat Inquiry", "POST /api/chat (Queue + 4x Batch LLM ~18s)", "#a855f7", "#ffffff", 0.35, 1.2),
    (40.0, 15.0, "Reading & Analysis", "Reading generated medical summary (15s)", "#dcfce7", "#15803d", 0.5, 0.9),
]

for x, dur, lbl, sublbl, bg, fg, y, h in steps:
    # Draw block
    rect = patches.FancyBboxPatch((x, y), dur, h, boxstyle="round,pad=0.08,rounding_size=0.15",
                                  facecolor=bg, edgecolor="#94a3b8" if bg == "#f1f5f9" else bg, linewidth=1.2)
    ax1.add_patch(rect)
    
    # Text
    cx = x + dur / 2
    cy = y + h / 2
    if dur > 1.5:
        ax1.text(cx, cy + 0.18, lbl, ha="center", va="center", fontsize=9.5, fontweight="bold", color=fg)
        ax1.text(cx, cy - 0.22, sublbl, ha="center", va="center", fontsize=7.5, color=fg)
    else:
        # Narrow callout
        ax1.text(cx, cy + 0.8, lbl, ha="center", va="bottom", fontsize=8.5, fontweight="bold", color="#0284c7")
        ax1.annotate("", xy=(cx, y + h), xytext=(cx, cy + 0.75),
                     arrowprops=dict(arrowstyle="->", color="#0284c7", lw=1.2))

# Timeline ticks
ax1.plot([0, 56], [0.1, 0.1], color="#cbd5e1", lw=2)
for tick in [0, 10, 20, 30, 40, 50, 55]:
    ax1.plot([tick, tick], [0.0, 0.2], color="#94a3b8", lw=1.5)
    ax1.text(tick, -0.25, f"{tick}s", ha="center", va="top", fontsize=8.5, color="#64748b")

# ----------------- Subplot 2: Multi-User Concurrency Multiplexing -----------------
ax2.set_xlim(-1, 62)
ax2.set_ylim(-0.5, 4.5)
ax2.axis("off")

ax2.text(-0.5, 4.2, "Phase B: System Workload Multiplexing Across 80 Concurrent Researchers", fontsize=13, fontweight="bold", color="#0f172a")
ax2.text(-0.5, 3.7, "Node.js instantly absorbs high-rate browsing requests, while GPU Concurrency Controller queues chats safely.", fontsize=10, color="#64748b")

# Layer 1: Fast Browsing Traffic (Node.js Async Event Loop)
rect_fast = patches.FancyBboxPatch((0, 2.0), 56, 1.2, boxstyle="round,pad=0.08,rounding_size=0.2",
                                   facecolor="#f0f9ff", edgecolor="#0284c7", linewidth=1.5)
ax2.add_patch(rect_fast)
ax2.text(2, 2.8, "FAST BROWSING LAYER (Node.js I/O Event Loop)", fontsize=10, fontweight="bold", color="#0369a1")
ax2.text(2, 2.3, "P50 = 74ms  |  P95 = 242ms  |  100% Availability  |  Zero Queuing for Browsing / Health", fontsize=9, color="#0284c7")
ax2.text(48, 2.6, "1,240 req/min\nAbsorbed Instantly", ha="center", va="center", fontsize=8.5, fontweight="bold", color="#0369a1",
         bbox=dict(boxstyle="round,pad=0.3", facecolor="#bae6fd", edgecolor="#0284c7", lw=1))

# Layer 2: GPU Concurrency Gatekeeper
rect_gpu = patches.FancyBboxPatch((0, 0.2), 56, 1.4, boxstyle="round,pad=0.08,rounding_size=0.2",
                                  facecolor="#faf5ff", edgecolor="#9333ea", linewidth=1.5)
ax2.add_patch(rect_gpu)
ax2.text(2, 1.25, "RAG LLM LAYER (RTX 4060 GPU - Concurrency Controller)", fontsize=10, fontweight="bold", color="#6b21a8")
ax2.text(2, 0.75, "4 Parallel Inference Slots + 16-Request Active Queue Buffer  |  Safe Throttling (Zero HTTP 500s)", fontsize=9, color="#7e22ce")

# Visual Slots inside GPU Layer
slot_x = 35.0
for i in range(4):
    s_rect = patches.FancyBboxPatch((slot_x + i * 2.5, 0.45), 2.2, 0.8, boxstyle="round,pad=0.04",
                                    facecolor="#c084fc", edgecolor="#7e22ce", lw=1)
    ax2.add_patch(s_rect)
    ax2.text(slot_x + i * 2.5 + 1.1, 0.85, f"GPU #{i+1}", ha="center", va="center", fontsize=7.5, fontweight="bold", color="#ffffff")

# Visual Queue Buffer
for q in range(6):
    q_rect = patches.FancyBboxPatch((slot_x + 11.5 + q * 1.3, 0.55), 1.0, 0.6, boxstyle="round,pad=0.03",
                                    facecolor="#e9d5ff", edgecolor="#a855f7", lw=1)
    ax2.add_patch(q_rect)
    ax2.text(slot_x + 11.5 + q * 1.3 + 0.5, 0.85, f"Q{q+1}", ha="center", va="center", fontsize=7, color="#581c87")

ax2.text(slot_x + 5.0, 1.35, "Active Parallel Slots (4x)", ha="center", fontsize=8, fontweight="bold", color="#6b21a8")
ax2.text(slot_x + 15.5, 1.35, "Queue Buffer (16 max)", ha="center", fontsize=8, fontweight="bold", color="#6b21a8")

plt.tight_layout(pad=2.0)
output_path = RESULTS_DIR / "user_journey_timeline_flow.png"
plt.savefig(output_path)
plt.close()
print(f"Generated {output_path}")
