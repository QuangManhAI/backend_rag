import base64
import os
import unicodedata
from pathlib import Path

# Paths
ROOT_DIR = Path(r"C:\document\Study documents\backend_rag\RAG_TS")
RESULTS_DIR = ROOT_DIR / "backend_rag" / "benchmark" / "results"
OUTPUT_HTML = ROOT_DIR / "docs" / "report_slides.html"
USER_LIGHTHOUSE_IMG = Path(r"C:\Users\TDV\.gemini\antigravity-cli\brain\4db53373-1ab6-43ef-a7e9-7bb3fed98130\.user_uploaded\uploaded_media_1_1793185932105.png")

def get_base64_img(path: Path) -> str:
    if not path.exists():
        print(f"Warning: Image {path} not found!")
        return ""
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return f"data:image/png;base64,{data}"

print("Reading and encoding benchmark images...")
img_soak = get_base64_img(RESULTS_DIR / "qualification_5min_sustained_throughput.png")
img_timeline = get_base64_img(RESULTS_DIR / "qualification_5min_continuous_timeline.png")
img_burst = get_base64_img(RESULTS_DIR / "empirical_k_fold_burst_turnaround.png")
img_frontend = get_base64_img(USER_LIGHTHOUSE_IMG)
print("Images encoded successfully.")

html_template = """<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Báo Cáo Đồ Án TypeScript — Hệ Thống RAG Khoa Học 3D</title>
<style>
/* ===========================================
   VIEWPORT FITTING: MANDATORY BASE STYLES
   =========================================== */
html, body { height: 100%; overflow-x: hidden; }
html { scroll-snap-type: y mandatory; scroll-behavior: smooth; }
.slide {
  width: 100vw; height: 100vh; height: 100dvh;
  overflow: hidden; scroll-snap-align: start;
  display: flex; flex-direction: column; position: relative;
}
.slide-content {
  flex: 1; display: flex; flex-direction: column; justify-content: center;
  max-height: 100%; overflow: hidden; padding: var(--slide-padding);
}
:root {
  --title-size: clamp(1.4rem, 3.8vw, 3.2rem);
  --h2-size: clamp(1.1rem, 2.3vw, 2.4rem);
  --h3-size: clamp(0.85rem, 1.4vw, 1.35rem);
  --body-size: clamp(0.72rem, 1.1vw, 1.15rem);
  --small-size: clamp(0.62rem, 0.88vw, 0.96rem);
  --code-size: clamp(0.55rem, 0.8vw, 0.92rem);
  --slide-padding: clamp(1rem, 3vw, 3.2rem);
  --content-gap: clamp(0.5rem, 1.4vw, 1.4rem);
  --element-gap: clamp(0.25rem, 0.75vw, 0.75rem);
}
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: clamp(0.5rem, 1.5vw, 1rem); }
@media (max-height: 700px) {
  :root { --slide-padding: clamp(0.75rem, 2.2vw, 1.8rem); --content-gap: clamp(0.4rem, 1.1vw, 0.9rem);
          --title-size: clamp(1.2rem, 3.5vw, 2.2rem); --h2-size: clamp(0.95rem, 2.1vw, 1.5rem);
          --body-size: clamp(0.65rem, 1vw, 0.88rem); --code-size: clamp(0.5rem, 0.72vw, 0.72rem); }
}
@media (max-height: 600px) {
  :root { --slide-padding: clamp(0.5rem, 1.8vw, 1.3rem); --content-gap: clamp(0.3rem, 0.9vw, 0.7rem);
          --title-size: clamp(1rem, 3.2vw, 1.8rem); --body-size: clamp(0.6rem, 0.95vw, 0.82rem); }
  .nav-dots, .keyboard-hint, .decorative { display: none; }
}
@media (max-width: 600px) {
  :root { --title-size: clamp(1.2rem, 6.5vw, 2.2rem); }
  .grid, .cols, .cols-3, .cols-wide { grid-template-columns: 1fr !important; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.2s !important; }
  html { scroll-behavior: auto; }
}

/* === THEME TOKENS === */
:root {
  --bg: #f5f3ee;
  --paper: #ffffff;
  --ink: #13213f;
  --ink-2: #3a4560;
  --muted: #6b7286;
  --line: #dcd8cd;
  --soft: #ece9e1;
  --code-bg: #111a2e;
  --code-ink: #dbe3f1;
  --code-dim: #7d8aa6;
  --code-key: #8cc8ff;
  --code-str: #f3c98b;
  --code-tag: #f59ab0;
  --ok: #1f7a3a;
  --bad: #b3261e;
  
  --c1: #e2702a;  /* Intro */
  --c2: #1795cc;  /* Pipeline */
  --c3: #1d6a2d;  /* Deployment */
  --c4: #0b7285;  /* TypeScript */
  --c5: #962a8c;  /* Auth */
  --c6: #4e9d2b;  /* Offline */
  --c7: #d9480f;  /* Benchmark 1 */
  --c8: #0c8599;  /* Benchmark 2 */
  --c9: #f08c00;  /* Benchmark 3 */
  --c10: #7048e8; /* Frontend 3D */
  --c11: #2b8a3e; /* Testing */
  --c12: #1971c2; /* Conclusion */

  --step: var(--ink);
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --serif: "Georgia", "Times New Roman", "Noto Serif", serif;
  --mono: "SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace;
}

/* === BASE === */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: var(--body-size); line-height: 1.45; -webkit-font-smoothing: antialiased; }
.slide { background: var(--bg); }
.slide::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: clamp(5px, 0.5vw, 9px); background: var(--step); }

.s1 { --step: var(--c1); } .s2 { --step: var(--c2); } .s3 { --step: var(--c3); }
.s4 { --step: var(--c4); } .s5 { --step: var(--c5); } .s6 { --step: var(--c6); }
.s7 { --step: var(--c7); } .s8 { --step: var(--c8); } .s9 { --step: var(--c9); }
.s10 { --step: var(--c10); } .s11 { --step: var(--c11); } .s12 { --step: var(--c12); }

h1 { font-family: var(--serif); font-size: var(--title-size); line-height: 1.15; font-weight: 700; letter-spacing: -0.01em; }
h2 { font-family: var(--serif); font-size: var(--h2-size); line-height: 1.2; font-weight: 700; }
h3 { font-size: var(--h3-size); font-weight: 700; line-height: 1.25; }
p, li { font-size: var(--body-size); }
b, strong { font-weight: 700; }
code { font-family: var(--mono); font-size: 0.92em; background: var(--soft); padding: 0.05em 0.35em; border-radius: 4px; }
.muted { color: var(--muted); }
.small { font-size: var(--small-size); }
.accent { color: var(--step); }

/* === SLIDE HEADER / FOOTER === */
.head { display: flex; flex-direction: column; gap: clamp(0.2rem, 0.5vh, 0.45rem); margin-bottom: var(--content-gap); }
.chip { align-self: flex-start; display: inline-flex; align-items: center; gap: 0.5em; font-size: var(--small-size); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #fff; background: var(--step); padding: 0.28em 0.75em; border-radius: 3px; }
.lede { color: var(--ink-2); max-width: 80ch; font-size: clamp(0.78rem, 1.2vw, 1.18rem); }
.foot { position: absolute; left: var(--slide-padding); right: calc(var(--slide-padding) + 5em); bottom: clamp(0.35rem, 1.2vh, 0.9rem); display: flex; justify-content: space-between; gap: 1rem; font-size: var(--small-size); color: var(--muted); }
.foot code { background: transparent; padding: 0; color: var(--ink-2); }

/* === LAYOUT === */
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--content-gap); align-items: start; }
.cols-wide { display: grid; grid-template-columns: 1.25fr 1fr; gap: var(--content-gap); align-items: start; }
.cols-narrow { display: grid; grid-template-columns: 1fr 1.25fr; gap: var(--content-gap); align-items: start; }
.cols-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--content-gap); align-items: stretch; }
.stack { display: flex; flex-direction: column; gap: var(--element-gap); }
.card { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: clamp(0.55rem, 1.1vw, 1rem); }
.card.edge { border-top: 4px solid var(--step); }
.label { font-size: var(--small-size); font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.35em; }

/* === CODE === */
pre { font-family: var(--mono); font-size: var(--code-size); line-height: 1.45; background: var(--code-bg); color: var(--code-ink); border-radius: 8px; padding: clamp(0.5rem, 0.9vw, 0.9rem); white-space: pre-wrap; word-break: break-word; overflow: hidden; }
pre .d { color: var(--code-dim); } pre .k { color: var(--code-key); } pre .s { color: var(--code-str); } pre .t { color: var(--code-tag); }

/* === TABLES === */
table { width: 100%; border-collapse: collapse; font-size: var(--small-size); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
th { text-align: left; font-weight: 700; color: #fff; background: var(--step); padding: 0.4em 0.65em; }
td { padding: 0.35em 0.65em; border-top: 1px solid var(--line); vertical-align: top; }
tr:nth-child(even) td { background: #faf9f5; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

/* === METRICS === */
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 130px), 1fr)); gap: var(--element-gap); }
.metric { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: clamp(0.4rem, 0.8vw, 0.8rem); }
.metric .v { font-family: var(--serif); font-size: clamp(1rem, 2.1vw, 1.9rem); font-weight: 700; line-height: 1.05; color: var(--step); font-variant-numeric: tabular-nums; }
.metric .l { font-size: var(--small-size); color: var(--ink-2); margin-top: 0.2em; }

/* === FLOW / PILLS === */
.flow { display: flex; flex-wrap: wrap; gap: 0; }
.flow .st { position: relative; flex: 1 1 0; min-width: 105px; color: #fff; font-weight: 700; font-size: var(--small-size); letter-spacing: 0.05em; text-transform: uppercase; padding: 0.8em 0.5em 0.8em 1.4em; clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%); margin-right: -5px; text-align: center; }
.flow .st:first-child { clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%); padding-left: 0.7em; }
.flow .st span { display: block; font-weight: 400; text-transform: none; letter-spacing: 0; opacity: 0.92; margin-top: 0.15em; font-size: 0.9em; }

.pill { display: inline-block; font-size: var(--small-size); font-weight: 700; padding: 0.15em 0.6em; border-radius: 99px; background: var(--soft); color: var(--ink-2); }
.pill.ok { background: #e3f3e6; color: var(--ok); }
.pill.bad { background: #fbe6e4; color: var(--bad); }

/* === IMAGES / PLOTS === */
.plot-container { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: clamp(0.35rem, 0.7vw, 0.75rem); display: flex; flex-direction: column; align-items: center; justify-content: center; }
.plot-container img { width: 100%; height: auto; max-height: clamp(230px, 46vh, 480px); object-fit: contain; border-radius: 4px; }
.plot-caption { font-size: var(--small-size); color: var(--muted); margin-top: 0.35em; text-align: center; }

/* === TITLE SLIDE === */
.title-slide { --step: var(--ink); }
.kicker { font-size: var(--small-size); letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
.title-slide h1 { max-width: 22ch; margin: 0.3em 0 0.35em; }
.title-slide .lede { font-size: clamp(0.85rem, 1.4vw, 1.25rem); }

/* === REVEAL ANIMATION === */
.reveal { opacity: 0; transform: translateY(12px); transition: opacity 0.5s ease, transform 0.5s ease; }
.slide.visible .reveal { opacity: 1; transform: none; }
.slide.visible .reveal:nth-child(2) { transition-delay: 0.08s; }
.slide.visible .reveal:nth-child(3) { transition-delay: 0.15s; }
.slide.visible .reveal:nth-child(4) { transition-delay: 0.22s; }

/* === CHROME: progress, dots, counter === */
.progress-bar { position: fixed; top: 0; left: 0; height: 3px; width: 0; background: var(--ink); z-index: 50; transition: width 0.3s ease; }
.nav-dots { position: fixed; right: clamp(0.4rem, 1vw, 1rem); top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 7px; z-index: 50; }
.nav-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--muted); background: transparent; cursor: pointer; padding: 0; }
.nav-dot.active { background: var(--ink); border-color: var(--ink); }
.counter { position: fixed; right: clamp(0.6rem, 1.4vw, 1.4rem); bottom: clamp(0.35rem, 1.2vh, 0.9rem); font-size: var(--small-size); color: var(--muted); font-variant-numeric: tabular-nums; z-index: 50; background: var(--bg); padding: 0 0.3em; }
.keyboard-hint { pointer-events: none; position: fixed; left: 50%; bottom: clamp(0.35rem, 1.2vh, 0.9rem); transform: translateX(-50%); font-size: var(--small-size); color: var(--muted); z-index: 50; transition: opacity 0.6s; }

/* === PRINT === */
@media print {
  @page { size: 16in 9in; margin: 0; }
  html { scroll-snap-type: none; }
  .slide { width: 16in; height: 9in; page-break-after: always; break-after: page; }
  .reveal { opacity: 1 !important; transform: none !important; }
  .nav-dots, .progress-bar, .counter, .keyboard-hint { display: none !important; }
  body, .slide { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>
<div class="progress-bar"></div>
<nav class="nav-dots" aria-label="Điều hướng slide"></nav>
<div class="counter" aria-live="polite"></div>
<div class="keyboard-hint">← → / Space để chuyển slide</div>

<!-- =========================================================
     SLIDE 1: TITLE
     ========================================================= -->
<section class="slide title-slide s1">
  <div class="slide-content">
    <div class="reveal">
      <div class="kicker">Đồ án môn học · Lập trình TypeScript · Báo cáo kỹ thuật</div>
      <h1>Hệ Thống RAG Tài Liệu Khoa Học với Cây Tri Thức Vector 3D</h1>
      <p class="lede">Kiến trúc phân tán, NestJS strict type safety, Streaming SSE với mô hình ngôn ngữ lớn cục bộ trên GPU, và lưu trữ hội thoại Offline-First với Dexie.js.</p>
    </div>
    <div class="flow reveal" style="margin-top: clamp(0.8rem, 3vh, 2rem); max-width: 1100px;">
      <div class="st" style="background: var(--c1)">1 · Kiến trúc<span>NestJS + React 19</span></div>
      <div class="st" style="background: var(--c3)">2 · Hạ tầng<span>Tunnel + CUDA LLM</span></div>
      <div class="st" style="background: var(--c4)">3 · TypeScript<span>Strict + Discriminated</span></div>
      <div class="st" style="background: var(--c6)">4 · Offline-First<span>Dexie.js / Cache-First</span></div>
      <div class="st" style="background: var(--c7)">5 · Hiệu năng<span>1,600 CU / 5 Phút</span></div>
    </div>
    <div class="cols reveal" style="margin-top: clamp(0.8rem, 2.5vh, 1.8rem); max-width: 1000px;">
      <p class="small muted"><b>Công nghệ chính:</b> TypeScript 5.x (strict), NestJS 11, React 19, Three.js, Qdrant, MongoDB, node-llama-cpp, Dexie.js, Tailwind v4.</p>
      <p class="small muted" style="text-align: right;"><b>Kết quả kiểm thử:</b> 210/210 Vitest pass · Jest replica set pass · 0 lỗi kiểu</p>
    </div>
  </div>
  <div class="foot"><span>Báo Cáo Kỹ Thuật Đồ Án TypeScript</span><code>TS-RAG-2026</code></div>
</section>

<!-- =========================================================
     SLIDE 2: PIPELINE RAG & QUALITY BENCHMARK
     ========================================================= -->
<section class="slide s2">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Kiến trúc &amp; Đánh giá RAG</div>
      <h2>Pipeline RAG 6 Bước &amp; Chất Lượng Kiểm Chuẩn</h2>
      <p class="lede">Quy trình xử lý song hành với hoạt ảnh 3D và kết quả đánh giá chất lượng từ phiên kiểm thử chuẩn (15 câu hỏi đa lĩnh vực ML, CV, NLP).</p>
    </div>
    <div class="cols-wide reveal">
      <div class="stack">
        <div class="card edge">
          <div class="label">6 bước xử lý tuần tự</div>
          <ol style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.35em; font-size: var(--small-size);">
            <li><b>1. Embed:</b> Mã hóa câu hỏi với <code>nomic-embed-text-v1.5</code> (768 chiều, prefix <code>search_query:</code>).</li>
            <li><b>2. Route 3D:</b> Tìm centroid cấp 1 / cấp 2 gần nhất trên cây World (tham số <code>nprobe</code>).</li>
            <li><b>3. Search ANN:</b> Truy vấn Cosine similarity trong Qdrant collection <code>scientific_papers_gold</code>.</li>
            <li><b>4. Rerank tác giả:</b> Kết hợp độ tương đồng và PageRank: <code>S = 0.85 · S_sim + 0.15 · A_PageRank</code>.</li>
            <li><b>5. Generate:</b> Qwen2.5-7B-Instruct (GGUF Q4_K_M) chạy trên CUDA GPU qua <code>node-llama-cpp</code>.</li>
            <li><b>6. Stream SSE:</b> Đẩy từng token câu trả lời và sự kiện phase về client theo thời gian thực.</li>
          </ol>
        </div>
      </div>
      <div class="stack">
        <div class="label">Chỉ số chất lượng kiểm chuẩn (Run jjpmf)</div>
        <div class="metrics">
          <div class="metric"><div class="v">73,08%</div><div class="l">Recall@5 (Độ phủ Top-5 có Rerank)</div></div>
          <div class="metric"><div class="v">100%</div><div class="l">Zero Citation Hallucination (0 bịa đặt)</div></div>
        </div>
        <div class="metrics">
          <div class="metric"><div class="v">100%</div><div class="l">Robust Abstention (Từ chối an toàn)</div></div>
          <div class="metric"><div class="v">&lt; 200ms</div><div class="l">Time-to-First-Token (P95 TTFT)</div></div>
        </div>
      </div>
    </div>
  </div>
  <div class="foot"><span>1. Kiến trúc &amp; Chất lượng RAG</span><code>bench-run-2026-10-23T08-19-38-jjpmf</code></div>
</section>

<!-- =========================================================
     SLIDE 3: DEPLOYMENT & HOSTING
     ========================================================= -->
<section class="slide s3">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Hạ tầng &amp; Triển khai</div>
      <h2>Mô Hình Hybrid: Cloudflare Tunnel &amp; Trạm GPU Cục Bộ</h2>
      <p class="lede">Tách biệt rõ ràng giữa dịch vụ lưu trữ dữ liệu từ xa và máy trạm tính toán mô hình để tối ưu tài nguyên phần cứng.</p>
    </div>
    <div class="cols reveal">
      <div class="card edge">
        <div class="label">Remote Data Services (Bạn Mạnh host)</div>
        <h3 style="margin-bottom: 0.4em;">Cloud Lakehouse &amp; Dữ liệu Vector</h3>
        <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.4em; font-size: var(--small-size);">
          <li><b>MinIO S3 Lakehouse:</b> Lưu trữ các tầng dữ liệu Bronze (HTML/PDF), Silver (Parquet), Gold (JSON chunks).</li>
          <li><b>Qdrant Vector DB:</b> Chạy container Docker, phục vụ tìm kiếm ANN vector qua cổng 6333.</li>
          <li><b>MongoDB Replica Set:</b> Lưu trữ tài khoản người dùng, phiên chat và tokens.</li>
          <li><b>Cloudflare Zero Trust Tunnel:</b> Định tuyến an toàn từ xa về <code>localhost:27017</code> không cần mở port public.</li>
        </ul>
      </div>
      <div class="card edge">
        <div class="label">Local Workstation (Máy trạm phát triển)</div>
        <h3 style="margin-bottom: 0.4em;">Application Server &amp; GPU LLM</h3>
        <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.4em; font-size: var(--small-size);">
          <li><b>NestJS 11 Backend:</b> Cổng 3000, xử lý API REST, SSE streaming, authentication và swagger docs.</li>
          <li><b>CUDA Local LLM:</b> Qwen2.5-7B-Instruct (GGUF Q4_K_M) offload 28/28 layers lên GPU VRAM qua <code>node-llama-cpp</code>.</li>
          <li><b>React 19 + Vite Frontend:</b> Cổng 5174, hiển thị Cây Tri Thức 3D WebGL và khung chat hỗ trợ Offline-First.</li>
          <li><b>Swagger Interactive UI:</b> Tài liệu hóa chuẩn OpenAPI tại <code>/api/v1/docs</code>.</li>
        </ul>
      </div>
    </div>
  </div>
  <div class="foot"><span>2. Hạ tầng &amp; Triển khai</span><code>Cloudflare Tunnel + CUDA</code></div>
</section>

<!-- =========================================================
     SLIDE 4: TYPESCRIPT ENGINEERING
     ========================================================= -->
<section class="slide s4">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Kỹ thuật TypeScript</div>
      <h2>Hệ Thống Kiểu Strict Xuyên Suốt Backend &amp; Frontend</h2>
      <p class="lede">Áp dụng static typing, decorator validation, discriminated unions và kiến trúc Clean Architecture Ports &amp; Adapters.</p>
    </div>
    <div class="cols-wide reveal">
      <div class="card edge">
        <div class="label">Discriminated Union cho Luồng SSE</div>
        <pre><span class="k">type</span> <span class="t">RagStreamEvent</span> =
  | { event: <span class="s">'phase'</span>; data: { phase: <span class="t">RagPhase</span>; run_id: <span class="t">number</span> } }
  | { event: <span class="s">'grounded_chunk'</span>; data: <span class="t">GroundedChunkPayload</span> }
  | { event: <span class="s">'token'</span>; data: { token: <span class="t">string</span>; run_id: <span class="t">number</span> } }
  | { event: <span class="s">'done'</span>; data: { answer: <span class="t">string</span>; metrics: <span class="t">RagTimings</span> } }
  | { event: <span class="s">'error'</span>; data: { message: <span class="t">string</span>; code: <span class="t">string</span> } };

<span class="d">// TypeScript bắt buộc kiểm tra đầy đủ mọi nhánh sự kiện</span></pre>
      </div>
      <div class="stack">
        <div class="card">
          <div class="label">4 Trụ cột TypeScript trong đồ án</div>
          <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.35em; font-size: var(--small-size);">
            <li><b>Strict tsconfig:</b> Bật <code>strict: true</code>, <code>noImplicitAny</code>, <code>exactOptionalPropertyTypes</code> ở cả BE lẫn FE.</li>
            <li><b>DTO Validation:</b> <code>class-validator</code> kết hợp NestJS <code>ValidationPipe</code> xác minh payload đầu vào.</li>
            <li><b>Ports &amp; Adapters:</b> Giao diện <code>SessionStorePort</code> trừu tượng hóa DB, cho phép tráo mock dễ dàng khi test.</li>
            <li><b>Zod Validation:</b> Kiểm định chặt chẽ biến môi trường <code>.env</code> ngay khi khởi động server.</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  <div class="foot"><span>3. Kỹ thuật TypeScript</span><code>rag-stream-event.dto.ts</code></div>
</section>

<!-- =========================================================
     SLIDE 5: AUTH & SECURITY
     ========================================================= -->
<section class="slide s5">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Bảo mật &amp; Xác thực</div>
      <h2>Mã Hóa Argon2id &amp; JWT Refresh Token Rotation</h2>
      <p class="lede">Cơ chế xác thực đa tầng: Băm mật khẩu kháng GPU cracking, token vòng đời ngắn và phát hiện tái sử dụng token.</p>
    </div>
    <div class="cols reveal">
      <div class="stack">
        <div class="card edge">
          <div class="label">Vòng đời Token &amp; Chống Tái Sử Dụng</div>
          <p style="font-size: var(--small-size); margin-bottom: 0.5em;">Người dùng gửi thông tin đăng nhập → Backend kiểm tra Argon2id → Cấp cặp Access Token (15 phút) và Refresh Token (7 ngày).</p>
          <div class="flow" style="margin: 0.5em 0;">
            <div class="st" style="background: var(--c5)">Login<span>Argon2id</span></div>
            <div class="st" style="background: var(--c4)">Access<span>15 phút</span></div>
            <div class="st" style="background: var(--c1)">Rotate<span>Token mới</span></div>
            <div class="st" style="background: var(--bad)">Reuse?<span>Revoke họ</span></div>
          </div>
          <p class="small muted">Khi token cũ bị sử dụng lại (dấu hiệu lộ token), hệ thống kích hoạt <b>Family Revocation</b>, thu hồi toàn bộ phiên làm việc của tài khoản đó.</p>
        </div>
      </div>
      <div class="stack">
        <table>
          <tr><th>Tham số bảo mật</th><th>Cấu hình triển khai</th></tr>
          <tr><td>Thuật toán băm mật khẩu</td><td><b>Argon2id</b> (timeCost: 3, memoryCost: 65,536 KB)</td></tr>
          <tr><td>Ký Access Token</td><td>HMAC-SHA256 (Secret 256-bit, TTL 15m)</td></tr>
          <tr><td>Lưu trữ Refresh Token</td><td>Băm SHA-256 trong MongoDB, không lưu plaintext</td></tr>
          <tr><td>Hạn chế Brute-force</td><td><code>ThrottlerGuard</code> (Giới hạn 10 req/phút ở auth)</td></tr>
          <tr><td>Ngữ cảnh Auth MongoDB</td><td><code>authSource=admin</code> xác thực tài khoản nội bộ</td></tr>
        </table>
      </div>
    </div>
  </div>
  <div class="foot"><span>4. Bảo mật &amp; Xác thực</span><code>auth.service.ts · Argon2id</code></div>
</section>

<!-- =========================================================
     SLIDE 6: OFFLINE-FIRST PERSISTENCE
     ========================================================= -->
<section class="slide s6">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Lưu trữ Offline-First</div>
      <h2>Trải Nghiệm Hội Thoại Liên Tục với Dexie.js (IndexedDB)</h2>
      <p class="lede">Đọc lịch sử chat tức thì, tra cứu tài liệu và trích dẫn khoa học ngay cả khi Backend ngừng hoạt động.</p>
    </div>
    <div class="cols reveal">
      <div class="card edge">
        <div class="label">Chiến lược Cache-First &amp; Đa Phiên</div>
        <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.4em; font-size: var(--small-size);">
          <li><b>Cache-First Instant Load:</b> Khi mở ứng dụng, tin nhắn được tải trực tiếp từ IndexedDB cục bộ (0ms latency, không chờ mạng).</li>
          <li><b>Background Sync:</b> Đồng bộ nền không chặn với Backend; nếu BE offline, UI tự động hiển thị huy hiệu <code>Ngoại tuyến</code>.</li>
          <li><b>Quản lý phiên:</b> History Drawer cho phép tạo <b>+ Đoạn chat mới</b>; tự sinh tiêu đề từ 48 ký tự đầu câu hỏi.</li>
          <li><b>Xóa an toàn 2 bước:</b> Xác nhận inline (<code>Xóa?</code> / <code>Huỷ</code>), xóa local ngay tức thì và gọi DELETE lên server ở background.</li>
        </ul>
      </div>
      <div class="stack">
        <div class="card">
          <div class="label">Schema Bảng Dexie (frontend_rag)</div>
          <pre><span class="k">export class</span> <span class="t">ChatDatabase</span> <span class="k">extends</span> <span class="t">Dexie</span> {
  sessions!: <span class="t">Table</span>&lt;<span class="t">LocalChatSession</span>, <span class="t">string</span>&gt;;
  messages!: <span class="t">Table</span>&lt;<span class="t">LocalChatMessage</span>, <span class="t">string</span>&gt;;

  <span class="k">constructor</span>() {
    <span class="k">super</span>(<span class="s">'ChatRAGDatabase'</span>);
    <span class="k">this</span>.version(<span class="d">1</span>).stores({
      sessions: <span class="s">'id, updated_at'</span>,
      messages: <span class="s">'id, session_id, created_at, [session_id+created_at]'</span>
    });
  }
}</pre>
        </div>
      </div>
    </div>
  </div>
  <div class="foot"><span>5. Lưu trữ Offline-First</span><code>chatDb.ts · sessionStore.ts</code></div>
</section>

<!-- =========================================================
     SLIDE 7: BENCHMARK 1 - STRESS TEST 5 PHÚT
     ========================================================= -->
<section class="slide s7">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Kiểm thử hiệu năng</div>
      <h2>Fast API: Stress Test 5 Phút (1,600 CU Đạt Chuẩn)</h2>
      <p class="lede">Kiểm thử độ bền (Endurance Test) bằng k6 xác định khả năng chịu tải liên tục của tầng REST API NestJS.</p>
    </div>
    <div class="cols-wide reveal">
      <div class="plot-container">
        <img src=\"""" + img_soak + """\" alt="Biểu đồ k6 1,600 CU Stress Test">
        <div class="plot-caption">Hình 1: Thông lượng đo được đạt 3,958.53 req/s duy trì ổn định suốt 300 giây liên tục.</div>
      </div>
      <div class="stack">
        <div class="metrics">
          <div class="metric"><div class="v">1.600</div><div class="l">Certified Max Concurrent Users (CU)</div></div>
          <div class="metric"><div class="v">3.958</div><div class="l">Requests / giây (Sustained Throughput)</div></div>
        </div>
        <div class="metrics">
          <div class="metric"><div class="v">379.5 ms</div><div class="l">Độ trễ phân vị P95 (SLA &lt; 500 ms)</div></div>
          <div class="metric"><div class="v">0,00%</div><div class="l">Tỉ lệ lỗi HTTP (0 / 1.187.560 req)</div></div>
        </div>
        <div class="card" style="font-size: var(--small-size);">
          <div class="label">Xác định ngưỡng chịu tải (Failure Boundary)</div>
          <p>Khi nâng tải lên 2,000 VUs, độ trễ P95 trôi lên 520.4 ms (vượt ngưỡng SLA 500 ms); ở mức 2,500 VUs độ trễ đạt 599.1 ms. Hệ thống đạt chuẩn kiểm định ở mức <b>1,600 CU</b> với <b>1.187.560 requests</b> liên tục.</p>
        </div>
      </div>
    </div>
  </div>
  <div class="foot"><span>6. Benchmark: Fast API Stress Test</span><code>k6 endurance-test-1600cu.js</code></div>
</section>

<!-- =========================================================
     SLIDE 8: BENCHMARK 2 - TIMELINE & GC
     ========================================================= -->
<section class="slide s8">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Phân tích độ trễ chi tiết</div>
      <h2>Dòng Thời Gian 5 Phút, Phân Vị P99.9 &amp; V8 Garbage Collection</h2>
      <p class="lede">Theo dõi liên tục từng giây ghi nhận phân vị độ trễ và tác động của tiến trình thu gom bộ nhớ V8.</p>
    </div>
    <div class="cols-wide reveal">
      <div class="plot-container">
        <img src=\"""" + img_timeline + """\" alt="Timeline độ trễ và phân vị P99.9">
        <div class="plot-caption">Hình 2: Phân tích đường biên latency P50 (349 ms), P95 (379.5 ms) và các đỉnh nhọn P99.9.</div>
      </div>
      <div class="stack">
        <div class="card edge">
          <div class="label">Hiện tượng V8 Full GC Pauses</div>
          <p style="font-size: var(--small-size); margin-bottom: 0.5em;">Đồ án xử lý hơn <b>1.180.000 requests</b> trong 5 phút. V8 Engine (Node.js) thực hiện thu gom bộ nhớ định kỳ:</p>
          <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.35em; font-size: var(--small-size);">
            <li><b>Phân vị P50:</b> Duy trì ở mức <b>349 ms</b>.</li>
            <li><b>Phân vị P95:</b> Đạt <b>379.5 ms</b>, đáp ứng tiêu chuẩn SLA (&lt; 500 ms).</li>
            <li><b>Gai nhọn P99.9:</b> Xuất hiện theo chu kỳ ~50,000 requests khi V8 kích hoạt Full Mark-Sweep-Compact GC pause (~1.2s) rồi hạ nhiệt trở lại.</li>
          </ul>
        </div>
        <div class="metrics">
          <div class="metric"><div class="v">180 MB</div><div class="l">Bộ nhớ Node.js RSS ổn định</div></div>
          <div class="metric"><div class="v">0 Leak</div><div class="l">Không rò rỉ RAM suốt 5 phút</div></div>
        </div>
      </div>
    </div>
  </div>
  <div class="foot"><span>7. Benchmark: Dòng thời gian &amp; GC</span><code>k6 metrics timeline</code></div>
</section>

<!-- =========================================================
     SLIDE 9: BENCHMARK 3 - LLM QUEUE & BURST
     ========================================================= -->
<section class="slide s9">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Tầng GPU &amp; Hàng đợi</div>
      <h2>LLM Queue Cliff, K=5 Burst Turnaround &amp; Fail-Fast 429</h2>
      <p class="lede">Do GPU xử lý tuần tự từng ngữ cảnh, hàng đợi điều tiết giúp tránh treo hệ thống khi xuất hiện đợt truy cập dồn dập.</p>
    </div>
    <div class="cols-wide reveal">
      <div class="plot-container">
        <img src=\"""" + img_burst + """\" alt="Biểu đồ K=5 Burst Turnaround SLA">
        <div class="plot-caption">Hình 3: Thời gian quay vòng 5 lượt burst và điểm vi phạm SLA ở slot 7-9.</div>
      </div>
      <div class="stack">
        <div class="card edge">
          <div class="label">Cơ chế Hàng đợi Fail-Fast HTTP 429</div>
          <p style="font-size: var(--small-size); margin-bottom: 0.4em;">Đặc điểm tính toán trên GPU VRAM cục bộ khi tải tăng đột biến:</p>
          <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.35em; font-size: var(--small-size);">
            <li><b>Slot 1–5:</b> Hoàn thành trong khoảng thời gian cho phép của SLA (&lt; 15s).</li>
            <li><b>Slot 7–9:</b> Thời gian chờ tích lũy trong hàng đợi làm vi phạm SLA phản hồi.</li>
            <li><b>Fail-Fast HTTP 429:</b> Khi hàng đợi vượt quá dung lượng cho phép, server từ chối ngay lập tức (2ms) với mã <code>429 Too Many Requests</code> nhằm tránh để client chờ kết nối dẫn đến timeout 504.</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  <div class="foot"><span>8. Benchmark: LLM GPU &amp; Queue</span><code>llm-queue.service.ts</code></div>
</section>

<!-- =========================================================
     SLIDE 10: BENCHMARK 4 - FRONTEND & 3D (LIGHTHOUSE 97)
     ========================================================= -->
<section class="slide s10">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Hiệu năng Frontend &amp; 3D</div>
      <h2>Tối Ưu Hóa Cây Tri Thức 3D &amp; Điểm Lighthouse 97</h2>
      <p class="lede">Kết hợp Three.js InstancedMesh và lazy-loading giúp giao diện đạt 97 điểm hiệu năng và 100 điểm Best Practices.</p>
    </div>
    <div class="cols-wide reveal">
      <div class="plot-container">
        <img src=\"""" + img_frontend + """\" alt="Kết quả audit Lighthouse trên giao diện 3D">
        <div class="plot-caption">Hình 4: Kiểm thử Lighthouse đạt Performance 97, Accessibility 100, Best Practices 100.</div>
      </div>
      <div class="stack">
        <div class="metrics">
          <div class="metric"><div class="v">97 / 100</div><div class="l">Lighthouse Performance Score</div></div>
          <div class="metric"><div class="v">100 / 100</div><div class="l">Accessibility &amp; Best Practices</div></div>
        </div>
        <div class="metrics">
          <div class="metric"><div class="v">0,9 s</div><div class="l">First Contentful Paint (FCP)</div></div>
          <div class="metric"><div class="v">1,0 s</div><div class="l">Largest Contentful Paint (LCP)</div></div>
        </div>
        <div class="card edge" style="font-size: var(--small-size);">
          <div class="label">Chỉ số Web Vitals chi tiết</div>
          <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.3em;">
            <li><b>Total Blocking Time (TBT):</b> <b>40 ms</b> (ngưỡng tốt &lt; 200 ms).</li>
            <li><b>Cumulative Layout Shift (CLS):</b> <b>0.002</b> (không bị xô lệch bố cục).</li>
            <li><b>Speed Index (SI):</b> <b>1.2 s</b>.</li>
            <li><b>Three.js InstancedMesh:</b> Gom toàn bộ node lá cây vào 1 draw call, duy trì tốc độ khung hình <b>57.1 ± 1.2 FPS</b>.</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  <div class="foot"><span>9. Hiệu năng Frontend &amp; 3D</span><code>Three.js · Lighthouse Audit</code></div>
</section>

<!-- =========================================================
     SLIDE 11: TESTING & QUALITY ASSURANCE
     ========================================================= -->
<section class="slide s11">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Kiểm thử &amp; Chất lượng</div>
      <h2>Chiến Lược Kiểm Thử Tự Động: 210/210 Tests Vượt Qua</h2>
      <p class="lede">Bao phủ toàn diện từ Unit Test, Store State, SSE Stream Parser đến Fake In-Memory Services.</p>
    </div>
    <div class="cols reveal">
      <div class="stack">
        <table>
          <tr><th>Tầng kiểm thử</th><th>Công cụ</th><th>Kết quả</th></tr>
          <tr><td>Frontend Unit &amp; Stores</td><td>Vitest + Testing Library</td><td><span class="pill ok">210 / 210 passed (26 files)</span></td></tr>
          <tr><td>Kiểm tra kiểu tĩnh</td><td><code>tsc --noEmit</code> (Strict)</td><td><span class="pill ok">0 lỗi kiểu</span></td></tr>
          <tr><td>Backend In-Memory DB</td><td>Jest + MongoMemoryServer</td><td><span class="pill ok">Pass (Replica &amp; Standalone)</span></td></tr>
          <tr><td>PR #9 Chat Sessions</td><td>Jest Integration Tests</td><td><span class="pill ok">32 / 32 kịch bản passed</span></td></tr>
          <tr><td>Frontend Build Bundle</td><td><code>vite build</code></td><td><span class="pill ok">Build thành công trong 8.5s</span></td></tr>
        </table>
      </div>
      <div class="card edge">
        <div class="label">Kỹ thuật kiểm thử</div>
        <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.4em; font-size: var(--small-size);">
          <li><b>Fake Ports &amp; Adapters:</b> Thay thế GPU LLM thật bằng fake stream provider, giúp CI/CD chạy test e2e trong vài giây không cần GPU.</li>
          <li><b>Fake IndexedDB:</b> Sử dụng <code>fake-indexeddb/auto</code> để giả lập IndexedDB trong môi trường jsdom.</li>
          <li><b>Kiểm định bảo mật:</b> Kiểm tra khả năng chống tấn công NoSQL Injection, ReDoS và phân quyền truy cập chéo giữa các tài khoản.</li>
        </ul>
      </div>
    </div>
  </div>
  <div class="foot"><span>10. Kiểm thử &amp; Đảm bảo chất lượng</span><code>Vitest · Jest · fake-indexeddb</code></div>
</section>

<!-- =========================================================
     SLIDE 12: CONCLUSION
     ========================================================= -->
<section class="slide s12">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Tổng kết đồ án</div>
      <h2>Đáp Ứng Mục Tiêu Kỹ Thuật Môn Lập Trình TypeScript</h2>
      <p class="lede">Hệ thống RAG hoàn chỉnh, minh bạch trích dẫn, chịu tải cao, giao diện 3D trực quan và duy trì hoạt động ngoại tuyến.</p>
    </div>
    <div class="cols reveal">
      <div class="card edge">
        <div class="label">Thành quả kỹ thuật cốt lõi</div>
        <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.45em; font-size: var(--small-size);">
          <li><b>TypeScript Strict:</b> Áp dụng nhất quán type-safety, discriminated unions và decorators từ backend đến frontend.</li>
          <li><b>Khả năng chịu tải:</b> Đạt chuẩn <b>1,600 CU liên tục trong 5 phút</b> (3,958 req/s, P95 379.5ms, 0% lỗi).</li>
          <li><b>Kiểm soát quá tải:</b> Xử lý nghẽn GPU bằng hàng đợi fail-fast 429 và bảo vệ tài khoản với Argon2id + Family Rotation.</li>
          <li><b>Offline-First:</b> Duy trì khả năng tra cứu dữ liệu hội thoại khi server offline nhờ Dexie.js.</li>
        </ul>
      </div>
      <div class="stack">
        <div class="card">
          <div class="label">Tài liệu tham chiếu trong Repository</div>
          <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.35em; font-size: var(--small-size);">
            <li><b>Báo cáo chi tiết:</b> <code>docs/REPORT.md</code></li>
            <li><b>Đặc tả API &amp; Swagger:</b> <code>docs/API_DESIGN.md</code></li>
            <li><b>Hướng dẫn khởi chạy:</b> <code>README.md</code> &amp; <code>docs/RUN_GUIDE.md</code></li>
            <li><b>Dữ liệu Benchmark k6:</b> <code>backend_rag/benchmark/results/</code></li>
            <li><b>Nhật ký quyết định:</b> <code>docs/AI_chat_log/Vuong_chat_logs.md</code></li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  <div class="foot"><span>11. Kết luận</span><code>Báo Cáo Đồ Án TypeScript 2026</code></div>
</section>

<!-- =========================================================
     SCRIPT: Slide Navigation & Interaction
     ========================================================= -->
<script>
class SlidePresentation {
  constructor() {
    this.slides = Array.from(document.querySelectorAll('.slide'));
    this.currentSlide = 0;
    this.progressBar = document.querySelector('.progress-bar');
    this.counter = document.querySelector('.counter');
    this.hint = document.querySelector('.keyboard-hint');
    this.isScrolling = false;

    this.init();
  }

  init() {
    this.setupIntersectionObserver();
    this.setupKeyboardNav();
    this.setupTouchNav();
    this.setupWheelNav();
    this.setupNavDots();
    this.update();

    if (this.hint) {
      setTimeout(() => { if (this.hint) this.hint.style.opacity = '0'; }, 3500);
    }
  }

  setupIntersectionObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          const index = this.slides.indexOf(entry.target);
          if (index !== -1) {
            this.currentSlide = index;
            this.update();
          }
        }
      });
    }, { threshold: 0.45 });

    this.slides.forEach(slide => observer.observe(slide));
  }

  setupKeyboardNav() {
    document.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowRight', 'Space', 'PageDown'].includes(e.code)) {
        e.preventDefault();
        this.goToSlide(this.currentSlide + 1);
      } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.code)) {
        e.preventDefault();
        this.goToSlide(this.currentSlide - 1);
      } else if (e.code === 'Home') {
        e.preventDefault();
        this.goToSlide(0);
      } else if (e.code === 'End') {
        e.preventDefault();
        this.goToSlide(this.slides.length - 1);
      }
    });
  }

  setupTouchNav() {
    let startY = 0, startX = 0;
    document.addEventListener('touchstart', e => { startY = e.touches[0].clientY; startX = e.touches[0].clientX; }, { passive: true });
    document.addEventListener('touchend', e => {
      const dy = startY - e.changedTouches[0].clientY;
      const dx = startX - e.changedTouches[0].clientX;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 50) this.goToSlide(this.currentSlide + (dy > 0 ? 1 : -1));
      else if (Math.abs(dx) > 50) this.goToSlide(this.currentSlide + (dx > 0 ? 1 : -1));
    }, { passive: true });
  }

  setupWheelNav() {
    document.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.isScrolling || Math.abs(e.deltaY) < 8) return;
      this.isScrolling = true;
      this.goToSlide(this.currentSlide + (e.deltaY > 0 ? 1 : -1));
      setTimeout(() => { this.isScrolling = false; }, 800);
    }, { passive: false });
  }

  setupNavDots() {
    this.navDotsContainer = document.querySelector('.nav-dots');
    if (!this.navDotsContainer) return;
    this.navDotsContainer.innerHTML = '';
    this.slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'nav-dot';
      dot.setAttribute('aria-label', 'Slide ' + (i + 1));
      dot.addEventListener('click', () => this.goToSlide(i));
      this.navDotsContainer.appendChild(dot);
    });
  }

  goToSlide(index) {
    if (index < 0 || index >= this.slides.length) return;
    this.currentSlide = index;
    this.slides[index].scrollIntoView({ behavior: 'smooth' });
    this.update();
    if (this.hint) this.hint.style.opacity = '0';
  }

  update() {
    const n = this.slides.length;
    if (this.progressBar) this.progressBar.style.width = ((this.currentSlide + 1) / n * 100) + '%';
    if (this.counter) this.counter.textContent = (this.currentSlide + 1) + ' / ' + n;
    if (this.navDotsContainer) {
      this.navDotsContainer.querySelectorAll('.nav-dot').forEach((dot, i) => dot.classList.toggle('active', i === this.currentSlide));
    }
  }
}

document.addEventListener('DOMContentLoaded', () => { new SlidePresentation(); });
</script>
</body>
</html>
"""

# Normalize unicode to NFC to avoid combining accent rendering bugs on Windows/Chrome
normalized_html = unicodedata.normalize("NFC", html_template)

print(f"Writing generated slides HTML to {OUTPUT_HTML}...")
with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
    f.write(normalized_html)

print(f"Successfully generated {OUTPUT_HTML}! File size: {os.path.getsize(OUTPUT_HTML) / (1024 * 1024):.2f} MB")
