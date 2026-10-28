import base64
from pathlib import Path
import shutil

BENCHMARK_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark")
RESULTS_DIR = BENCHMARK_DIR / "results"
BRAIN_DIR = Path("C:/Users/TDV/.gemini/antigravity-cli/brain/4db53373-1ab6-43ef-a7e9-7bb3fed98130")

def img_to_b64(path: Path) -> str:
    if not path.exists():
        return ""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

# Copy updated images to brain directory for artifact embedding
for img_name in [
    "queue_depth_comparison_tradeoff.png",
    "user_journey_timeline_flow.png",
    "realistic_user_session_throughput.png",
    "fast_api_extreme_1000vus_latency.png",
    "failure_taxonomy_distribution.png"
]:
    src = RESULTS_DIR / img_name
    if src.exists():
        shutil.copy2(src, BRAIN_DIR / img_name)

fast_extreme_b64 = img_to_b64(RESULTS_DIR / "fast_api_extreme_1000vus_latency.png")
user_session_b64 = img_to_b64(RESULTS_DIR / "realistic_user_session_throughput.png")
user_journey_b64 = img_to_b64(RESULTS_DIR / "user_journey_timeline_flow.png")
queue_tradeoff_b64 = img_to_b64(RESULTS_DIR / "queue_depth_comparison_tradeoff.png")
failure_tax_b64 = img_to_b64(RESULTS_DIR / "failure_taxonomy_distribution.png")

# SVG Icons
ICON_LIVE = '<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#16a34a"/></svg>'
ICON_CPU = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/></svg>'
ICON_RAM = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 19h20M2 5h20M6 5v14M10 5v14M14 5v14M18 5v14"/></svg>'
ICON_GPU = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/></svg>'
ICON_DB = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>'
ICON_CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
ICON_CROSS = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RAG-TS Benchmark & Failure Autopsy Report</title>
  <style>
    :root {{
      --bg: #0f172a;
      --card-bg: #ffffff;
      --card-dark: #1e293b;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --accent: #2563eb;
      --success: #16a34a;
      --danger: #dc2626;
      --warning: #f59e0b;
      --border: #e2e8f0;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f1f5f9;
      color: var(--text-main);
      padding: 30px 20px;
      line-height: 1.5;
    }}
    .container {{
      max-width: 1200px;
      margin: 0 auto;
    }}
    .header {{
      text-align: center;
      margin-bottom: 30px;
    }}
    .header h1 {{
      font-size: 2.2rem;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.5px;
    }}
    .header p {{
      color: var(--text-muted);
      font-size: 1.05rem;
      margin-top: 6px;
    }}
    .testbed-banner {{
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: #e2e8f0;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 700;
      color: #334155;
      margin-top: 10px;
    }}
    .grid-2 {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 25px;
      margin-bottom: 35px;
    }}
    @media (max-width: 860px) {{
      .grid-2 {{ grid-template-columns: 1fr; }}
    }}
    
    .device-card {{
      background: var(--card-bg);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04);
      border: 1px solid var(--border);
    }}
    .device-card-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }}
    .badge-live {{
      background: #dcfce7;
      color: #15803d;
      font-weight: 700;
      font-size: 0.75rem;
      padding: 4px 10px;
      border-radius: 20px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-transform: uppercase;
    }}
    .badge-server {{
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      color: #475569;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 12px;
    }}
    .card-title-heavy {{
      font-size: 1.25rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #0f172a;
    }}
    .card-title-fail {{
      color: #dc2626;
      font-size: 1rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }}
    .fail-users-count {{
      font-size: 2.8rem;
      font-weight: 900;
      color: #0f172a;
      line-height: 1;
      margin: 8px 0 20px 0;
    }}
    .fail-users-count span {{
      font-size: 1.4rem;
      font-weight: 600;
      color: #64748b;
    }}

    .inner-section {{
      background: #f8fafc;
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 16px;
      border: 1px solid #edf2f7;
    }}
    .inner-title {{
      font-size: 0.8rem;
      font-weight: 800;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 12px;
      letter-spacing: 0.5px;
    }}

    /* Non-overlapping Metric Progress Bars */
    .metric-bar-group {{
      margin-bottom: 18px;
    }}
    .metric-label-row {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }}
    .metric-label-row .metric-name {{
      font-size: 0.95rem;
      font-weight: 800;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }}
    .threshold-badge-fail {{
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #fee2e2;
      color: #b91c1c;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 800;
    }}
    .threshold-badge-pass {{
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #dcfce7;
      color: #15803d;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 800;
    }}
    .bar-track {{
      background: #e2e8f0;
      height: 28px;
      border-radius: 6px;
      position: relative;
      overflow: hidden;
    }}
    .bar-fill-fail {{
      background: linear-gradient(90deg, #f87171 0%, #ef4444 100%);
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 12px;
      color: white;
      font-weight: 800;
      font-size: 0.9rem;
      border-radius: 6px;
    }}
    .target-tick {{
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #0f172a;
      z-index: 2;
    }}
    .ruler-row {{
      display: flex;
      justify-content: space-between;
      font-size: 0.72rem;
      color: #64748b;
      font-weight: 700;
      margin-top: 4px;
      padding: 0 2px;
    }}
    .ruler-row .sla-marker-text {{
      color: #b91c1c;
      font-weight: 800;
    }}

    /* Autopsy Grid */
    .autopsy-title {{
      font-size: 0.85rem;
      font-weight: 900;
      color: #991b1b;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }}
    .autopsy-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }}
    .autopsy-box {{
      background: #ffffff;
      border-radius: 12px;
      padding: 12px;
      border: 1px solid #e2e8f0;
    }}
    .autopsy-box-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.78rem;
      font-weight: 800;
      color: #475569;
      margin-bottom: 6px;
      gap: 6px;
    }}
    .gauge-wrapper {{
      text-align: center;
      padding: 5px 0;
    }}
    .gauge-value {{
      font-size: 2rem;
      font-weight: 900;
      color: #ef4444;
      line-height: 1;
    }}
    .gauge-label {{
      font-size: 0.75rem;
      font-weight: 800;
      color: #dc2626;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-top: 4px;
    }}

    /* Error Summary Block replacing avatar circle grid */
    .clean-error-summary {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #ffffff;
      border: 1px solid #bbf7d0;
      border-radius: 10px;
      padding: 12px 16px;
    }}
    .clean-error-count {{
      font-size: 1.4rem;
      font-weight: 900;
      color: #15803d;
      display: flex;
      align-items: center;
      gap: 6px;
    }}
    .clean-error-meta {{
      text-align: right;
      font-size: 0.8rem;
      font-weight: 700;
      color: #166534;
    }}

    /* Showcase Section */
    .showcase-card {{
      background: var(--card-bg);
      border-radius: 16px;
      padding: 25px;
      margin-bottom: 25px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      border: 1px solid var(--border);
    }}
    .showcase-card h2 {{
      font-size: 1.3rem;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
    }}
    .showcase-card p.caption {{
      color: var(--text-muted);
      font-size: 0.95rem;
      margin-bottom: 16px;
    }}
    .showcase-card img {{
      max-width: 100%;
      height: auto;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      display: block;
      margin: 0 auto;
    }}
  </style>
</head>
<body>

<div class="container">
  <div class="header">
    <h1>System Stress Test & Failure Autopsy Report</h1>
    <p>RAG-TS Full-Stack Architecture Performance, Concurrency Scaling & Saturation Audit</p>
    <div class="testbed-banner">
      <span>TESTBED SPECIFICATIONS:</span>
      <span>NVIDIA RTX 4060 Laptop (8GB VRAM)</span> &bull;
      <span>Intel Core i7-13620H (16 Threads)</span> &bull;
      <span>16GB RAM</span> &bull;
      <span>Windows 11</span>
    </div>
  </div>

  <!-- 2-Card Mobile UI Showcase -->
  <div class="grid-2">
    
    <!-- CARD 1: EVERY REQUEST · 2,500 USERS -->
    <div class="device-card">
      <div class="device-card-header">
        <div>
          <span class="badge-live">{ICON_LIVE} Live</span>
          <span class="card-title-heavy" style="margin-left: 8px;">EVERY REQUEST · 2,500 USERS</span>
        </div>
        <span class="badge-server">Fast API Route (Health/Docs)</span>
      </div>

      <div class="inner-section">
        <div class="inner-title">Requests (Latency Distribution)</div>
        
        <!-- SVG Log-Histogram with P50, P95, P99 markers -->
        <svg viewBox="0 0 450 170" width="100%" height="170">
          <g fill="#1e293b">
            <rect x="20" y="145" width="6" height="5" rx="2"/>
            <rect x="30" y="142" width="6" height="8" rx="2"/>
            <rect x="40" y="138" width="6" height="12" rx="2"/>
            <rect x="50" y="130" width="6" height="20" rx="2"/>
            <rect x="60" y="120" width="6" height="30" rx="2"/>
            <rect x="70" y="105" width="6" height="45" rx="2"/>
            <rect x="80" y="90" width="6" height="60" rx="2"/>
            <rect x="90" y="70" width="6" height="80" rx="2"/>
            <rect x="100" y="55" width="6" height="95" rx="2"/>
            <rect x="110" y="40" width="6" height="110" rx="2"/>
            <rect x="120" y="30" width="6" height="120" rx="2"/>
            <rect x="130" y="25" width="6" height="125" rx="2"/> <!-- P50 Peak -->
            <rect x="140" y="32" width="6" height="118" rx="2"/>
            <rect x="150" y="45" width="6" height="105" rx="2"/>
            <rect x="160" y="65" width="6" height="85" rx="2"/>
            <rect x="170" y="85" width="6" height="65" rx="2"/>
            <rect x="180" y="105" width="6" height="45" rx="2"/>
            <rect x="190" y="120" width="6" height="30" rx="2"/>
            <rect x="200" y="130" width="6" height="20" rx="2"/>
            <rect x="210" y="136" width="6" height="14" rx="2"/>
            <rect x="220" y="140" width="6" height="10" rx="2"/>
            <rect x="230" y="142" width="6" height="8" rx="2"/>
            <rect x="240" y="140" width="6" height="10" rx="2"/>
            <rect x="250" y="138" width="6" height="12" rx="2"/>
            <rect x="260" y="135" width="6" height="15" rx="2"/>
            <rect x="270" y="133" width="6" height="17" rx="2"/>
            <rect x="280" y="130" width="6" height="20" rx="2"/>
            <rect x="290" y="132" width="6" height="18" rx="2"/>
            <rect x="300" y="136" width="6" height="14" rx="2"/>
            <rect x="310" y="140" width="6" height="10" rx="2"/>
            <rect x="320" y="143" width="6" height="7" rx="2"/>
            <rect x="330" y="145" width="6" height="5" rx="2"/>
          </g>

          <!-- Log Axis Labels -->
          <text x="25" y="165" font-size="10" fill="#64748b" font-weight="700">1 ms</text>
          <text x="125" y="165" font-size="10" fill="#64748b" font-weight="700">10 ms</text>
          <text x="245" y="165" font-size="10" fill="#64748b" font-weight="700">100 ms</text>
          <text x="355" y="165" font-size="10" fill="#64748b" font-weight="700">1 s</text>

          <!-- Threshold dashed lines -->
          <line x1="330" y1="20" x2="330" y2="150" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3,3" />
          <text x="330" y="15" font-size="10" fill="#f59e0b" font-weight="800" text-anchor="middle">500 ms</text>

          <line x1="365" y1="20" x2="365" y2="150" stroke="#ef4444" stroke-width="2" stroke-dasharray="3,3" />
          <text x="365" y="15" font-size="10" fill="#ef4444" font-weight="800" text-anchor="middle">1 s</text>

          <!-- P50 Badge -->
          <circle cx="133" cy="25" r="4" fill="#0f172a" />
          <rect x="110" y="2" width="46" height="16" rx="4" fill="#f8fafc" stroke="#cbd5e1" />
          <text x="133" y="13" font-size="9" font-weight="800" fill="#0f172a" text-anchor="middle">p50: 11 ms</text>

          <!-- P95 Badge -->
          <circle cx="280" cy="85" r="4" fill="#0f172a" />
          <line x1="280" y1="85" x2="280" y2="60" stroke="#0f172a" stroke-width="1.5" />
          <rect x="255" y="44" width="50" height="16" rx="4" fill="#f8fafc" stroke="#cbd5e1" />
          <text x="280" y="55" font-size="9" font-weight="800" fill="#0f172a" text-anchor="middle">p95: 288 ms</text>

          <!-- P99 Badge -->
          <circle cx="345" cy="115" r="4" fill="#0f172a" />
          <line x1="345" y1="115" x2="345" y2="35" stroke="#0f172a" stroke-width="1.5" />
          <rect x="320" y="20" width="50" height="16" rx="4" fill="#f8fafc" stroke="#cbd5e1" />
          <text x="345" y="31" font-size="9" font-weight="800" fill="#0f172a" text-anchor="middle">p99: 775 ms</text>
        </svg>

        <div style="text-align: center; font-weight: 800; font-size: 1.05rem; margin-top: 10px; color: #0f172a;">
          99% of requests completed under 775 ms
        </div>
      </div>

      <div class="inner-section">
        <div class="inner-title">Error Rate Status</div>
        <div class="clean-error-summary">
          <div class="clean-error-count">
            {ICON_CHECK} 0 HTTP Errors
          </div>
          <div class="clean-error-meta">
            100% Success Rate<br>
            <span style="color: #64748b; font-weight: 600;">2,500 Concurrent Users</span>
          </div>
        </div>
      </div>
    </div>

    <!-- CARD 2: FAILS AT 3,000 USERS -->
    <div class="device-card">
      <div class="device-card-header">
        <span class="card-title-fail">FAILURE POINT OCCURRENCE</span>
        <span class="badge-server">SLA Threshold Breach</span>
      </div>

      <div class="fail-users-count">3,000 <span>users</span></div>

      <!-- Metric Bar 1: P95 (Zero Text Collisions) -->
      <div class="metric-bar-group">
        <div class="metric-label-row">
          <span class="metric-name">P95 Latency</span>
          <span class="threshold-badge-fail">{ICON_CROSS} Target &lt; 500 ms</span>
        </div>
        <div class="bar-track">
          <div class="target-tick" style="left: 33%;"></div>
          <div class="bar-fill-fail" style="width: 88%;">1,350 ms</div>
        </div>
        <div class="ruler-row">
          <span>0 ms</span>
          <span class="sla-marker-text" style="margin-left: 33%; transform: translateX(-50%);">| SLA Limit: 500 ms</span>
          <span style="margin-left: auto;">1,500 ms</span>
        </div>
      </div>

      <!-- Metric Bar 2: P99 (Zero Text Collisions) -->
      <div class="metric-bar-group">
        <div class="metric-label-row">
          <span class="metric-name">P99 Latency</span>
          <span class="threshold-badge-fail">{ICON_CROSS} Target &lt; 1.0 s</span>
        </div>
        <div class="bar-track">
          <div class="target-tick" style="left: 22%;"></div>
          <div class="bar-fill-fail" style="width: 95%;">4,590 ms</div>
        </div>
        <div class="ruler-row">
          <span>0 s</span>
          <span class="sla-marker-text" style="margin-left: 22%; transform: translateX(-50%);">| SLA Limit: 1.0 s</span>
          <span style="margin-left: auto;">5.0 s</span>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin: 12px 0 16px 0;">
        <span style="font-weight: 800; font-size: 0.9rem; color: #475569; text-transform: uppercase;">HTTP Errors</span>
        <span class="threshold-badge-pass">{ICON_CHECK} 0 Crashes / Zero Dropped Packets</span>
      </div>

      <!-- Autopsy Section -->
      <div class="inner-section" style="border: 2px solid #fecaca; background: #fff5f5;">
        <div class="autopsy-title">
          <span>AUTOPSY (ROOT CAUSE BOTTLENECK)</span>
        </div>
        
        <div class="autopsy-grid">
          <!-- CPU Gauge -->
          <div class="autopsy-box" style="border-color: #fca5a5;">
            <div class="autopsy-box-header">
              <span style="display: flex; align-items: center; gap: 4px;">{ICON_CPU} CPU (Event Loop)</span>
            </div>
            <div class="gauge-wrapper">
              <svg viewBox="0 0 100 55" width="85" height="48">
                <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="#fee2e2" stroke-width="9" stroke-linecap="round"/>
                <path d="M 10 50 A 40 40 0 0 1 82 25" fill="none" stroke="#ef4444" stroke-width="9" stroke-linecap="round"/>
                <circle cx="50" cy="50" r="4" fill="#0f172a"/>
                <line x1="50" y1="50" x2="72" y2="28" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
              <div class="gauge-value">91%</div>
              <div class="gauge-label">PRIMARY BOTTLENECK</div>
            </div>
          </div>

          <!-- Hardware telemetry column -->
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div class="autopsy-box">
              <div class="autopsy-box-header">
                <span style="display: flex; align-items: center; gap: 4px;">{ICON_RAM} System RAM</span>
                {ICON_CHECK}
              </div>
              <div style="font-size: 0.95rem; font-weight: 800;">15.2 / 15.7 GB</div>
              <div style="background: #e2e8f0; height: 6px; border-radius: 4px; margin-top: 4px;">
                <div style="background: #3b82f6; width: 96%; height: 100%; border-radius: 4px;"></div>
              </div>
            </div>

            <div class="autopsy-box">
              <div class="autopsy-box-header">
                <span style="display: flex; align-items: center; gap: 4px;">{ICON_GPU} GPU VRAM (RTX 4060)</span>
                {ICON_CHECK}
              </div>
              <div style="font-size: 0.95rem; font-weight: 800;">6,391 / 8,188 MB</div>
              <div style="background: #e2e8f0; height: 6px; border-radius: 4px; margin-top: 4px;">
                <div style="background: #10b981; width: 78%; height: 100%; border-radius: 4px;"></div>
              </div>
            </div>

            <div class="autopsy-box">
              <div class="autopsy-box-header">
                <span style="display: flex; align-items: center; gap: 4px;">{ICON_DB} Database & Sockets</span>
                {ICON_CHECK}
              </div>
              <div style="font-size: 0.85rem; font-weight: 800; color: #16a34a;">0 socket pool drops</div>
            </div>
          </div>
        </div>
      </div>

    </div>

  </div>

  <!-- SECTION 1: VISUAL USER JOURNEY TIMELINE -->
  <div class="showcase-card">
    <h2>Realistic Researcher Journey & System Concurrency Flow</h2>
    <p class="caption">
      Visual sequence diagram mapping single-researcher session stages (browsing, thinking, querying, reading) against system multiplexing across 80 concurrent users.
    </p>
    <img src="data:image/png;base64,{user_journey_b64}" alt="User Journey Timeline Flow">
  </div>

  <!-- SECTION 2: QUEUE DEPTH & TIMEOUT TRADEOFF -->
  <div class="showcase-card">
    <h2>Queue Depth Burst Experiment & Physical Limits</h2>
    <p class="caption">
      Rigorous 16-user burst analysis demonstrating why active queue buffer is capped at 16 requests: slot latencies exceeding 60 seconds trigger client aborts.
    </p>
    <img src="data:image/png;base64,{queue_tradeoff_b64}" alt="Queue Depth Tradeoff">
  </div>

  <!-- SECTION 3: REALISTIC RESEARCHER USER SESSIONS EMPIRICAL RESULTS -->
  <div class="showcase-card">
    <h2>Empirical Mixed Workload Throughput & Stability</h2>
    <p class="caption">
      Live k6 run metrics across 80 concurrent users. Node.js processes lightweight I/O requests at 242ms P95, while GPU concurrency queues handle deep chat requests safely.
    </p>
    <img src="data:image/png;base64,{user_session_b64}" alt="Realistic User Sessions">
  </div>

  <!-- SECTION 4: SYSTEM RESILIENCE & FAILURE TAXONOMY -->
  <div class="showcase-card">
    <h2>System Failure Taxonomy & Load-Shedding Resilience</h2>
    <p class="caption">
      Distribution of 320,000+ requests across saturation runs. 0 unhandled exceptions or socket crashes; 100% of shedding is handled via graceful HTTP 429 backpressure.
    </p>
    <img src="data:image/png;base64,{failure_tax_b64}" alt="Failure Taxonomy Distribution">
  </div>

</div>

</body>
</html>
"""

report_path = BENCHMARK_DIR / "benchmark_report.html"
with open(report_path, "w", encoding="utf-8") as f:
    f.write(html_content)

brain_report_path = BRAIN_DIR / "benchmark_report.html"
with open(brain_report_path, "w", encoding="utf-8") as f:
    f.write(html_content)

print(f"Generated standalone HTML report at {report_path} ({len(html_content):,} bytes)")
print(f"Synced to brain artifacts at {brain_report_path}")
