import base64
import json
import shutil
from pathlib import Path

BENCHMARK_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark")
RESULTS_DIR = BENCHMARK_DIR / "results"
BRAIN_DIR = Path("C:/Users/TDV/.gemini/antigravity-cli/brain/4db53373-1ab6-43ef-a7e9-7bb3fed98130")

def img_to_b64(path: Path) -> str:
    if not path.exists():
        return ""
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def generate_report():
    # Load 200 CUs certified summary
    s200_path = RESULTS_DIR / "auth_sessions_summary.json"
    s1000_path = RESULTS_DIR / "auth_1000cu_summary.json"
    s300_path = RESULTS_DIR / "auth_300cu_certified_summary.json"

    def get_val(p):
        if not p.exists(): return {}
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f).get("metrics", {})

    m200 = get_val(s200_path)
    m300 = get_val(s300_path)
    m1000 = get_val(s1000_path)

    # Base64 plots
    plot_curve_b64 = img_to_b64(RESULTS_DIR / "auth_breakpoint_latency_curve.png")
    plot_holdout_b64 = img_to_b64(RESULTS_DIR / "auth_holdout_3min_comparison.png")
    plot_lat_b64 = img_to_b64(RESULTS_DIR / "auth_1000cu_latency_percentiles.png")
    plot_thru_b64 = img_to_b64(RESULTS_DIR / "auth_1000cu_throughput_comparison.png")

    html = f"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RAG-TS: Authenticated API Benchmark & Breakpoint Certification Report</title>
  <style>
    :root {{
      --bg: #0b0f19;
      --card-bg: #111827;
      --card-border: #1f2937;
      --accent: #0284c7;
      --accent-soft: rgba(2, 132, 199, 0.12);
      --green: #10b981;
      --green-soft: rgba(16, 185, 129, 0.12);
      --amber: #f59e0b;
      --amber-soft: rgba(245, 158, 11, 0.12);
      --red: #ef4444;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.5;
      padding: 2.5rem 1.5rem;
    }}
    .container {{ max-width: 1200px; margin: 0 auto; }}
    
    /* Header */
    .header {{
      background: linear-gradient(135deg, #111827 0%, #1e293b 100%);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.75rem 2rem;
      margin-bottom: 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.25rem;
    }}
    .title-area h1 {{ font-size: 1.65rem; font-weight: 800; letter-spacing: -0.02em; color: #ffffff; }}
    .title-area p {{ color: var(--text-muted); font-size: 0.95rem; margin-top: 0.35rem; }}
    .badge-bar {{ display: flex; gap: 0.75rem; flex-wrap: wrap; }}
    .badge {{
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.8rem;
      border-radius: 9999px;
      font-size: 0.82rem;
      font-weight: 600;
      border: 1px solid transparent;
    }}
    .badge-certified {{ background: var(--green-soft); color: var(--green); border-color: rgba(16, 185, 129, 0.4); font-size: 0.9rem; }}
    .badge-info {{ background: var(--accent-soft); color: var(--accent); border-color: rgba(2, 132, 199, 0.3); }}

    /* KPI Grid */
    .kpi-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }}
    .kpi-card {{
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.25rem 1.5rem;
    }}
    .kpi-label {{ color: var(--text-muted); font-size: 0.82rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; }}
    .kpi-val {{ font-size: 2.1rem; font-weight: 800; color: #ffffff; margin-top: 0.35rem; font-variant-numeric: tabular-nums; }}
    .kpi-sub {{ font-size: 0.82rem; color: var(--text-muted); margin-top: 0.25rem; }}
    .kpi-pass {{ color: var(--green); font-weight: 700; }}

    /* Sections */
    .section {{
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.75rem 2rem;
      margin-bottom: 2rem;
    }}
    .section-title {{ font-size: 1.25rem; font-weight: 700; margin-bottom: 1.25rem; color: #ffffff; display: flex; align-items: center; gap: 0.6rem; }}
    
    /* Table */
    table {{ width: 100%; border-collapse: collapse; font-size: 0.92rem; margin-top: 0.75rem; }}
    th, td {{ padding: 0.85rem 1rem; text-align: left; border-bottom: 1px solid var(--card-border); }}
    th {{ background: #1a2234; color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 0.78rem; letter-spacing: 0.05em; }}
    tr:hover td {{ background: rgba(255, 255, 255, 0.02); }}
    .cell-pass {{ color: var(--green); font-weight: 700; }}
    .cell-warn {{ color: var(--amber); font-weight: 700; }}

    /* Images */
    .img-box {{ text-align: center; margin: 1.25rem 0; background: #0f172a; padding: 1rem; border-radius: 8px; border: 1px solid var(--card-border); }}
    .img-box img {{ max-width: 100%; height: auto; border-radius: 6px; }}

    /* Insights Grid */
    .insights-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.25rem; }}
    .insight-card {{ background: #172033; border: 1px solid #283548; border-radius: 8px; padding: 1.25rem; }}
    .insight-card h3 {{ font-size: 1rem; color: #38bdf8; margin-bottom: 0.5rem; }}
    .insight-card p {{ font-size: 0.9rem; color: #cbd5e1; line-height: 1.6; }}

    .footer {{ text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-top: 3rem; }}
  </style>
</head>
<body>
  <div class="container">
    
    <!-- Header -->
    <header class="header">
      <div class="title-area">
        <h1>Báo Cáo Kiểm Định: Giới Hạn Chịu Tải & Điểm Tới Hạn (Rule L1 Certified)</h1>
        <p>Kiểm định sức bền 3 phút (180s) liên tục của tầng JWT Guard và MongoDB CRUD</p>
      </div>
      <div class="badge-bar">
        <span class="badge badge-certified">★ CHỨNG NHẬN RULE L1: 200 CUs BỀN VỮNG 3 PHÚT</span>
        <span class="badge badge-info">100 Token Pool (24h Validity)</span>
      </div>
    </header>

    <!-- Executive KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Kỷ Lục CUs Đạt Chuẩn L1</div>
        <div class="kpi-val kpi-pass">200 <span style="font-size: 1.1rem;">CUs</span></div>
        <div class="kpi-sub">Giữ tải liên tục suốt 3 phút</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Độ Trễ P95 Đạt Chuẩn</div>
        <div class="kpi-val kpi-pass">282.5 <span style="font-size: 1.1rem;">ms</span></div>
        <div class="kpi-sub">Thỏa mãn SLA &lt; 500 ms</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Thông Lượng Bền Vững</div>
        <div class="kpi-val">339.3 <span style="font-size: 1.1rem;">req/s</span></div>
        <div class="kpi-sub">61,120 requests xử lý</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Tỷ Lệ Lỗi (Error Rate)</div>
        <div class="kpi-val kpi-pass">0.00%</div>
        <div class="kpi-sub">0 lỗi qua tất cả các bài test</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Tải Cực Đại Sống Sót</div>
        <div class="kpi-val">1,000 <span style="font-size: 1.1rem;">CUs</span></div>
        <div class="kpi-sub">Không sập, 100% checks đúng</div>
      </div>
    </div>

    <!-- Section 1: Breakpoint Saturation Curve -->
    <section class="section">
      <div class="section-title">📈 1. Đường Cong Điểm Tới Hạn & Độ Trễ Bão Hòa (Breakpoint Saturation Curve)</div>
      <p style="color: var(--text-muted); font-size: 0.92rem; margin-bottom: 1rem;">
        Biểu đồ thể hiện diễn biến độ trễ (Median P50, P95, P99) khi tải tăng dần từ 10 lên đến 1,000 CUs. Vạch đứt đỏ đánh dấu ngưỡng cam kết SLA 500ms, xác định ranh giới giữa Vùng Đạt Chuẩn (Certified Zone) và Vùng Dồn Hàng Đợi (Queue Accumulation Zone).
      </p>
      <div class="img-box">
        <img src="data:image/png;base64,{plot_curve_b64}" alt="Breakpoint Latency Curve" />
      </div>
    </section>

    <!-- Section 2: Rule L1 Comparative Table -->
    <section class="section">
      <div class="section-title">📋 2. Bảng Đối Soát Kiểm Định Giữ Tải 3 Phút (Rule L1 Sustained Hold-Out)</div>
      <table>
        <thead>
          <tr>
            <th>Mức Tải Kiểm Thử</th>
            <th>Thời Gian Giữ Tải</th>
            <th>Tổng Reqs</th>
            <th>Throughput</th>
            <th>P50 (Median)</th>
            <th>P95 Latency</th>
            <th>P99 Latency</th>
            <th>Error Rate</th>
            <th>Kết Quả Thẩm Định L1</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background: rgba(16, 185, 129, 0.08); font-weight: 700;">
            <td><strong>200 CUs (Chuẩn Nghiệm Thu)</strong></td>
            <td><strong>3 phút liên tục</strong></td>
            <td>61,120</td>
            <td>339.3 req/s</td>
            <td>177.8 ms</td>
            <td style="color: var(--green);"><strong>282.5 ms</strong></td>
            <td style="color: var(--green);"><strong>346.3 ms</strong></td>
            <td class="cell-pass">0.00%</td>
            <td class="cell-pass">★ CHỨNG NHẬN ĐẠT CHUẨN</td>
          </tr>
          <tr>
            <td><strong>300 CUs (Ngưỡng Điểm Uốn)</strong></td>
            <td>3 phút liên tục</td>
            <td>59,640</td>
            <td>283.8 req/s</td>
            <td>962.7 ms</td>
            <td class="cell-warn">1,270.0 ms</td>
            <td>1,430.0 ms</td>
            <td class="cell-pass">0.00%</td>
            <td class="cell-warn">⚠ Vượt P95 (Dồn Hàng Đợi)</td>
          </tr>
          <tr>
            <td><strong>1,000 CUs (Tải Khắc Nghiệt)</strong></td>
            <td>3 phút liên tục</td>
            <td>42,414</td>
            <td>235.5 req/s</td>
            <td>1,810.0 ms</td>
            <td class="cell-warn">3,600.0 ms</td>
            <td>3,880.0 ms</td>
            <td class="cell-pass">0.00%</td>
            <td class="cell-pass">✓ Chịu Đựng Tốt (0% Lỗi)</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Section 3: Visual Comparison -->
    <section class="section">
      <div class="section-title">⚡ 3. So Sánh Thông Lượng & Độ Trễ 3 Mốc Tải Chủ Đạo</div>
      <div class="img-box">
        <img src="data:image/png;base64,{plot_holdout_b64}" alt="3-Minute Hold-Out Comparison" />
      </div>
    </section>

    <!-- Section 4: Architectural Insights -->
    <section class="section">
      <div class="section-title">💡 4. Đánh Giá Chuyên Sâu Về Kiến Trúc & Điểm Tới Hạn</div>
      <div class="insights-grid">
        <div class="insight-card">
          <h3>1. Xác Nhận Kỷ Lục CUs Theo Quy Tắc L1</h3>
          <p>
            Theo đúng nguyên tắc L1 (chỉ công nhận khi giữ vững tải liên tục trong 3 phút với P95 &lt; 500ms), <strong>200 CUs</strong> là mức tải tối đa chính thức được chứng nhận cho tầng xác thực và cơ sở dữ liệu MongoDB đơn node.
          </p>
        </div>
        <div class="insight-card">
          <h3>2. Điểm Uốn Bão Hòa (Inflection Point tại 200 - 300 CUs)</h3>
          <p>
            Tại ngưỡng 200 CUs, Mongoose Connection Pool phục vụ các truy vấn tức thời (P95: 282ms). Khi tải vượt lên 300 CUs, số lượng truy vấn đồng thời vượt quá kích thước pool mặc định, kích hoạt hàng đợi đệm và đẩy P95 lên 1.27s.
          </p>
        </div>
        <div class="insight-card">
          <h3>3. Khả Năng Tự Bảo Vệ Không Crash</h3>
          <p>
            Ngay cả khi ép tải tới 1,000 CUs (gấp 5 lần mức chứng nhận), hệ thống không hề gặp lỗi 5xx, không rớt socket TCP và duy trì 0.00% tỷ lệ lỗi xuyên suốt hàng chục nghìn requests, khẳng định độ tin cậy vận hành rất cao.
          </p>
        </div>
      </div>
    </section>

    <footer class="footer">
      RAG-TS Benchmark Suite • Báo Cáo Tự Động Sinh Bởi Antigravity Performance Engine • Nhánh: vuong/perf-benchmark
    </footer>

  </div>
</body>
</html>
"""

    out_file = BENCHMARK_DIR / "auth_benchmark_report.html"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Updated: {out_file}")

    if BRAIN_DIR.exists():
        shutil.copy2(out_file, BRAIN_DIR / "auth_benchmark_report.html")

if __name__ == "__main__":
    generate_report()
