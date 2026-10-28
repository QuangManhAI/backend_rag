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
  --h2-size: clamp(1.1rem, 2.3vw, 2.3rem);
  --h3-size: clamp(0.85rem, 1.35vw, 1.3rem);
  --body-size: clamp(0.72rem, 1.05vw, 1.1rem);
  --small-size: clamp(0.62rem, 0.85vw, 0.95rem);
  --code-size: clamp(0.55rem, 0.78vw, 0.9rem);
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
  --mono: "SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace;
}

/* === BASE (Use native Segoe UI for Vietnamese text without broken combining accents) === */
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: var(--body-size); line-height: 1.45; -webkit-font-smoothing: antialiased; }
.slide { background: var(--bg); }
.slide::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: clamp(5px, 0.5vw, 9px); background: var(--step); }

.s1 { --step: var(--c1); } .s2 { --step: var(--c2); } .s3 { --step: var(--c3); }
.s4 { --step: var(--c4); } .s5 { --step: var(--c5); } .s6 { --step: var(--c6); }
.s7 { --step: var(--c7); } .s8 { --step: var(--c8); } .s9 { --step: var(--c9); }
.s10 { --step: var(--c10); } .s11 { --step: var(--c11); } .s12 { --step: var(--c12); }

h1 { font-family: var(--sans); font-size: var(--title-size); line-height: 1.15; font-weight: 800; letter-spacing: -0.02em; }
h2 { font-family: var(--sans); font-size: var(--h2-size); line-height: 1.2; font-weight: 700; letter-spacing: -0.01em; }
h3 { font-family: var(--sans); font-size: var(--h3-size); font-weight: 700; line-height: 1.25; }
p, li { font-size: var(--body-size); }
b, strong { font-weight: 700; }
code { font-family: var(--mono); font-size: 0.92em; background: var(--soft); padding: 0.05em 0.35em; border-radius: 4px; }
.muted { color: var(--muted); }
.small { font-size: var(--small-size); }
.accent { color: var(--step); }

/* === SLIDE HEADER / FOOTER === */
.head { display: flex; flex-direction: column; gap: clamp(0.2rem, 0.5vh, 0.45rem); margin-bottom: var(--content-gap); }
.chip { align-self: flex-start; display: inline-flex; align-items: center; gap: 0.5em; font-size: var(--small-size); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #fff; background: var(--step); padding: 0.28em 0.75em; border-radius: 3px; }
.lede { color: var(--ink-2); max-width: 80ch; font-size: clamp(0.78rem, 1.2vw, 1.15rem); }
.foot { position: absolute; left: var(--slide-padding); right: calc(var(--slide-padding) + 5em); bottom: clamp(0.35rem, 1.2vh, 0.9rem); display: flex; justify-content: space-between; gap: 1rem; font-size: var(--small-size); color: var(--muted); }
.foot code { background: transparent; padding: 0; color: var(--ink-2); }

/* === LAYOUT === */
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--content-gap); align-items: start; }
.cols-wide { display: grid; grid-template-columns: 1.35fr 1fr; gap: var(--content-gap); align-items: start; }
.cols-narrow { display: grid; grid-template-columns: 1fr 1.35fr; gap: var(--content-gap); align-items: start; }
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
.metric .v { font-family: var(--sans); font-size: clamp(1rem, 2.1vw, 1.9rem); font-weight: 800; line-height: 1.05; color: var(--step); font-variant-numeric: tabular-nums; }
.metric .l { font-size: var(--small-size); color: var(--ink-2); margin-top: 0.2em; font-weight: 500; }

/* === FLOW / PILLS === */
.flow { display: flex; flex-wrap: wrap; gap: 0; }
.flow .st { position: relative; flex: 1 1 0; min-width: 105px; color: #fff; font-weight: 700; font-size: var(--small-size); letter-spacing: 0.05em; text-transform: uppercase; padding: 0.8em 0.5em 0.8em 1.4em; clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%); margin-right: -5px; text-align: center; }
.flow .st:first-child { clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%); padding-left: 0.7em; }
.flow .st span { display: block; font-weight: 400; text-transform: none; letter-spacing: 0; opacity: 0.92; margin-top: 0.15em; font-size: 0.9em; }

.pill { display: inline-block; font-size: var(--small-size); font-weight: 700; padding: 0.15em 0.6em; border-radius: 99px; background: var(--soft); color: var(--ink-2); }
.pill.ok { background: #e3f3e6; color: var(--ok); }
.pill.bad { background: #fbe6e4; color: var(--bad); }

/* === IMAGES / PLOTS / DIAGRAM CONTAINERS === */
.plot-container { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: clamp(0.35rem, 0.7vw, 0.75rem); display: flex; flex-direction: column; align-items: center; justify-content: center; }
.plot-container img { width: 100%; height: auto; max-height: clamp(230px, 46vh, 480px); object-fit: contain; border-radius: 4px; }
.plot-caption { font-size: var(--small-size); color: var(--muted); margin-top: 0.35em; text-align: center; }

.diagram-card { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: clamp(0.5rem, 1vw, 0.9rem); display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; }

/* === TITLE SLIDE === */
.title-slide { --step: var(--ink); }
.kicker { font-size: var(--small-size); letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
.title-slide h1 { max-width: 24ch; margin: 0.3em 0 0.35em; }
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
     SLIDE 2: PIPELINE RAG & QUALITY BENCHMARK (DIAGRAM)
     ========================================================= -->
<section class="slide s2">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Kiến trúc &amp; Đánh giá RAG</div>
      <h2>Pipeline RAG 6 Bước &amp; Chất Lượng Kiểm Chuẩn</h2>
      <p class="lede">Quy trình xử lý dữ liệu song hành với hoạt ảnh 3D và kết quả đánh giá chất lượng (15 câu hỏi khoa học đa lĩnh vực ML, CV, NLP).</p>
    </div>
    <div class="cols-wide reveal">
      <!-- Sơ đồ SVG Pipeline trực quan thay cho khối chữ -->
      <div class="diagram-card edge">
        <svg viewBox="0 0 520 235" width="100%" height="235" style="max-height: 44vh;">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#6b7286"/>
            </marker>
          </defs>
          <!-- Hàng trên: 1 -> 2 -> 3 -->
          <g transform="translate(10, 10)">
            <rect width="145" height="90" rx="6" fill="#f8fafc" stroke="#e2702a" stroke-width="1.8"/>
            <rect width="145" height="22" rx="6" fill="#e2702a"/>
            <rect y="14" width="145" height="8" fill="#e2702a"/>
            <text x="72" y="15" fill="#ffffff" font-size="10" font-weight="700" text-anchor="middle">1. NOMIC EMBED</text>
            <text x="72" y="44" fill="#13213f" font-size="10.5" font-weight="600" text-anchor="middle">search_query: text</text>
            <text x="72" y="63" fill="#6b7286" font-size="9.5" text-anchor="middle">Vector 768 chiều</text>
            <text x="72" y="80" fill="#1f7a3a" font-size="9.5" font-weight="700" text-anchor="middle">TTFT &lt; 200 ms</text>
          </g>
          <path d="M 157 55 L 180 55" stroke="#6b7286" stroke-width="2" marker-end="url(#arrow)"/>

          <g transform="translate(185, 10)">
            <rect width="145" height="90" rx="6" fill="#f8fafc" stroke="#1795cc" stroke-width="1.8"/>
            <rect width="145" height="22" rx="6" fill="#1795cc"/>
            <rect y="14" width="145" height="8" fill="#1795cc"/>
            <text x="72" y="15" fill="#ffffff" font-size="10" font-weight="700" text-anchor="middle">2. ROUTE 3D TREE</text>
            <text x="72" y="44" fill="#13213f" font-size="10.5" font-weight="600" text-anchor="middle">Centroid Cấp 1 &amp; 2</text>
            <text x="72" y="63" fill="#6b7286" font-size="9.5" text-anchor="middle">nprobe = 2 twigs</text>
            <text x="72" y="80" fill="#1795cc" font-size="9.5" font-weight="700" text-anchor="middle">Quả cầu bay 3D</text>
          </g>
          <path d="M 332 55 L 355 55" stroke="#6b7286" stroke-width="2" marker-end="url(#arrow)"/>

          <g transform="translate(360, 10)">
            <rect width="145" height="90" rx="6" fill="#f8fafc" stroke="#1d6a2d" stroke-width="1.8"/>
            <rect width="145" height="22" rx="6" fill="#1d6a2d"/>
            <rect y="14" width="145" height="8" fill="#1d6a2d"/>
            <text x="72" y="15" fill="#ffffff" font-size="10" font-weight="700" text-anchor="middle">3. QDRANT SEARCH</text>
            <text x="72" y="44" fill="#13213f" font-size="10.5" font-weight="600" text-anchor="middle">papers_gold (ANN)</text>
            <text x="72" y="63" fill="#6b7286" font-size="9.5" text-anchor="middle">Cosine similarity</text>
            <text x="72" y="80" fill="#1d6a2d" font-size="9.5" font-weight="700" text-anchor="middle">Recall@5: 73.08%</text>
          </g>

          <!-- U-turn arrow: 3 -> 4 -->
          <path d="M 432 102 L 432 126" stroke="#6b7286" stroke-width="2" marker-end="url(#arrow)"/>

          <!-- Hàng dưới: 6 <- 5 <- 4 -->
          <g transform="translate(360, 130)">
            <rect width="145" height="90" rx="6" fill="#f8fafc" stroke="#962a8c" stroke-width="1.8"/>
            <rect width="145" height="22" rx="6" fill="#962a8c"/>
            <rect y="14" width="145" height="8" fill="#962a8c"/>
            <text x="72" y="15" fill="#ffffff" font-size="10" font-weight="700" text-anchor="middle">4. MINING RERANK</text>
            <text x="72" y="44" fill="#13213f" font-size="10" font-weight="600" text-anchor="middle">0.85·Sim + 0.15·Rank</text>
            <text x="72" y="63" fill="#6b7286" font-size="9.5" text-anchor="middle">Tác giả &amp; trích dẫn</text>
            <text x="72" y="80" fill="#962a8c" font-size="9.5" font-weight="700" text-anchor="middle">Top-K Grounded</text>
          </g>
          <path d="M 358 175 L 335 175" stroke="#6b7286" stroke-width="2" marker-end="url(#arrow)"/>

          <g transform="translate(185, 130)">
            <rect width="145" height="90" rx="6" fill="#f8fafc" stroke="#d9480f" stroke-width="1.8"/>
            <rect width="145" height="22" rx="6" fill="#d9480f"/>
            <rect y="14" width="145" height="8" fill="#d9480f"/>
            <text x="72" y="15" fill="#ffffff" font-size="10" font-weight="700" text-anchor="middle">5. QWEN2.5-7B GPU</text>
            <text x="72" y="44" fill="#13213f" font-size="10.5" font-weight="600" text-anchor="middle">node-llama-cpp (CUDA)</text>
            <text x="72" y="63" fill="#6b7286" font-size="9.5" text-anchor="middle">GGUF Q4_K_M</text>
            <text x="72" y="80" fill="#1f7a3a" font-size="9.5" font-weight="700" text-anchor="middle">0% Bịa đặt nguồn</text>
          </g>
          <path d="M 183 175 L 160 175" stroke="#6b7286" stroke-width="2" marker-end="url(#arrow)"/>

          <g transform="translate(10, 130)">
            <rect width="145" height="90" rx="6" fill="#f8fafc" stroke="#7048e8" stroke-width="1.8"/>
            <rect width="145" height="22" rx="6" fill="#7048e8"/>
            <rect y="14" width="145" height="8" fill="#7048e8"/>
            <text x="72" y="15" fill="#ffffff" font-size="10" font-weight="700" text-anchor="middle">6. REALTIME SSE</text>
            <text x="72" y="44" fill="#13213f" font-size="10.5" font-weight="600" text-anchor="middle">text/event-stream</text>
            <text x="72" y="63" fill="#6b7286" font-size="9.5" text-anchor="middle">Stream từng token</text>
            <text x="72" y="80" fill="#7048e8" font-size="9.5" font-weight="700" text-anchor="middle">Đồng bộ UI 3D</text>
          </g>
        </svg>
      </div>

      <!-- Thẻ số đo kiểm chuẩn RAG -->
      <div class="stack">
        <div class="label">Chỉ số kiểm chuẩn chất lượng (Run jjpmf)</div>
        <div class="metrics">
          <div class="metric"><div class="v">73,08%</div><div class="l">Recall@5 (Độ phủ tài liệu Top-5)</div></div>
          <div class="metric"><div class="v">100%</div><div class="l">Zero Citation Hallucination</div></div>
        </div>
        <div class="metrics">
          <div class="metric"><div class="v">100%</div><div class="l">Robust Abstention (Từ chối chuẩn)</div></div>
          <div class="metric"><div class="v">&lt; 200 ms</div><div class="l">Time-to-First-Token (P95 TTFT)</div></div>
        </div>
        <div class="card" style="font-size: var(--small-size);">
          <div class="label">Đặc tính kỹ thuật cốt lõi</div>
          <p>Thuật toán <b>Mining Rerank</b> đưa các bài báo uy tín lên đầu. 100% trích dẫn <code>[Paper: id]</code> đều tồn tại thực sự trong ngữ cảnh truy xuất.</p>
        </div>
      </div>
    </div>
  </div>
  <div class="foot"><span>1. Kiến trúc &amp; Chất lượng RAG</span><code>bench-run-2026-10-23T08-19-38-jjpmf</code></div>
</section>

<!-- =========================================================
     SLIDE 3: DEPLOYMENT & HOSTING (DIAGRAM)
     ========================================================= -->
<section class="slide s3">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Hạ tầng &amp; Triển khai</div>
      <h2>Mô Hình Hybrid: Cloudflare Tunnel &amp; Trạm GPU Cục Bộ</h2>
      <p class="lede">Sơ đồ kết nối phân tán giữa máy chủ dữ liệu từ xa và máy trạm GPU cục bộ.</p>
    </div>
    <div class="cols-wide reveal">
      <!-- Sơ đồ kiến trúc hạ tầng SVG -->
      <div class="diagram-card edge">
        <svg viewBox="0 0 520 220" width="100%" height="220" style="max-height: 42vh;">
          <defs>
            <marker id="tunnel-arr-r" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#0b7285"/>
            </marker>
            <marker id="tunnel-arr-l" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 10 1 L 0 5 L 10 9 z" fill="#0b7285"/>
            </marker>
          </defs>

          <!-- Khối Remote -->
          <g transform="translate(10, 15)">
            <rect width="185" height="190" rx="8" fill="#f8fafc" stroke="#1d6a2d" stroke-width="2"/>
            <rect width="185" height="28" rx="8" fill="#1d6a2d"/>
            <rect y="18" width="185" height="10" fill="#1d6a2d"/>
            <text x="92" y="18" fill="#ffffff" font-size="10.5" font-weight="700" text-anchor="middle">REMOTE SERVICES (Host: Mạnh)</text>
            
            <g transform="translate(12, 38)">
              <rect width="160" height="42" rx="4" fill="#ffffff" stroke="#cbd5e1"/>
              <text x="10" y="18" font-size="10" font-weight="700" fill="#13213f">MinIO S3 Lakehouse</text>
              <text x="10" y="32" font-size="8.5" fill="#64748b">Bronze · Silver · Gold Chunks</text>
            </g>
            <g transform="translate(12, 88)">
              <rect width="160" height="42" rx="4" fill="#ffffff" stroke="#cbd5e1"/>
              <text x="10" y="18" font-size="10" font-weight="700" fill="#13213f">Qdrant Vector DB (Port 6333)</text>
              <text x="10" y="32" font-size="8.5" fill="#64748b">60,783 Vector nhúng Cosine</text>
            </g>
            <g transform="translate(12, 138)">
              <rect width="160" height="42" rx="4" fill="#ffffff" stroke="#cbd5e1"/>
              <text x="10" y="18" font-size="10" font-weight="700" fill="#13213f">MongoDB Replica Set</text>
              <text x="10" y="32" font-size="8.5" fill="#64748b">Users · Sessions · Messages</text>
            </g>
          </g>

          <!-- Đường hầm Cloudflare Tunnel ở giữa -->
          <g transform="translate(205, 75)">
            <rect width="110" height="70" rx="8" fill="#e6f7ff" stroke="#0b7285" stroke-width="2" stroke-dasharray="4,2"/>
            <text x="55" y="24" fill="#0b7285" font-size="9" font-weight="800" text-anchor="middle">CLOUDFLARE</text>
            <text x="55" y="38" fill="#0b7285" font-size="9" font-weight="800" text-anchor="middle">ZERO TRUST</text>
            <text x="55" y="54" fill="#13213f" font-size="8.5" font-weight="600" text-anchor="middle">TCP localhost:27017</text>
          </g>
          <line x1="195" y1="110" x2="203" y2="110" stroke="#0b7285" stroke-width="2"/>
          <line x1="317" y1="110" x2="323" y2="110" stroke="#0b7285" stroke-width="2"/>

          <!-- Khối Local Workstation -->
          <g transform="translate(325, 15)">
            <rect width="185" height="190" rx="8" fill="#f8fafc" stroke="#13213f" stroke-width="2"/>
            <rect width="185" height="28" rx="8" fill="#13213f"/>
            <rect y="18" width="185" height="10" fill="#13213f"/>
            <text x="92" y="18" fill="#ffffff" font-size="10.5" font-weight="700" text-anchor="middle">LOCAL GPU WORKSTATION</text>
            
            <g transform="translate(12, 38)">
              <rect width="160" height="42" rx="4" fill="#ffffff" stroke="#cbd5e1"/>
              <text x="10" y="18" font-size="10" font-weight="700" fill="#13213f">NestJS 11 Backend (3000)</text>
              <text x="10" y="32" font-size="8.5" fill="#64748b">REST API · SSE · Swagger UI</text>
            </g>
            <g transform="translate(12, 88)">
              <rect width="160" height="42" rx="4" fill="#ffffff" stroke="#cbd5e1"/>
              <text x="10" y="18" font-size="10" font-weight="700" fill="#13213f">CUDA Local LLM (RTX 4060)</text>
              <text x="10" y="32" font-size="8.5" fill="#64748b">Qwen2.5-7B (8GB VRAM)</text>
            </g>
            <g transform="translate(12, 138)">
              <rect width="160" height="42" rx="4" fill="#ffffff" stroke="#cbd5e1"/>
              <text x="10" y="18" font-size="10" font-weight="700" fill="#13213f">React 19 Frontend (5174)</text>
              <text x="10" y="32" font-size="8.5" fill="#64748b">Three.js 3D · Dexie Offline</text>
            </g>
          </g>
        </svg>
      </div>

      <div class="stack">
        <div class="card edge">
          <div class="label">Đặc tả kết nối hạ tầng</div>
          <ul style="padding-left: 1.2em; display: flex; flex-direction: column; gap: 0.4em; font-size: var(--small-size);">
            <li><b>Không mở cổng Public:</b> Cloudflare Zero Trust thiết lập đường truyền TCP mã hóa an toàn về port 27017 nội bộ.</li>
            <li><b>Tách biệt tải nặng:</b> Máy chủ từ xa chịu tải lưu trữ (S3/Vector/Mongo); máy trạm cục bộ tập trung 100% VRAM GPU cho mô hình ngôn ngữ lớn.</li>
            <li><b>Tài liệu hóa OpenAPI:</b> Tích hợp Swagger tương tác trực tiếp tại <code>/api/v1/docs</code>.</li>
          </ul>
        </div>
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
     SLIDE 5: AUTH & SECURITY (DIAGRAM)
     ========================================================= -->
<section class="slide s5">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Bảo mật &amp; Xác thực</div>
      <h2>Mã Hóa Argon2id &amp; JWT Refresh Token Rotation</h2>
      <p class="lede">Xác thực đa tầng: Băm mật khẩu kháng GPU cracking, token vòng đời ngắn và phát hiện tái sử dụng token.</p>
    </div>
    <div class="cols-wide reveal">
      <!-- Sơ đồ luồng Auth & Family Revocation SVG -->
      <div class="diagram-card edge">
        <svg viewBox="0 0 520 210" width="100%" height="210" style="max-height: 40vh;">
          <defs>
            <marker id="auth-arr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#962a8c"/>
            </marker>
          </defs>

          <!-- 3 Cột: Client, Auth Guard, Database -->
          <line x1="80" y1="35" x2="80" y2="200" stroke="#cbd5e1" stroke-dasharray="3,3"/>
          <line x1="260" y1="35" x2="260" y2="200" stroke="#cbd5e1" stroke-dasharray="3,3"/>
          <line x1="440" y1="35" x2="440" y2="200" stroke="#cbd5e1" stroke-dasharray="3,3"/>

          <rect x="35" y="10" width="90" height="25" rx="4" fill="#13213f"/>
          <text x="80" y="26" fill="#fff" font-size="10" font-weight="700" text-anchor="middle">CLIENT (Vite)</text>

          <rect x="205" y="10" width="110" height="25" rx="4" fill="#962a8c"/>
          <text x="260" y="26" fill="#fff" font-size="10" font-weight="700" text-anchor="middle">AUTH GUARD</text>

          <rect x="390" y="10" width="100" height="25" rx="4" fill="#1d6a2d"/>
          <text x="440" y="26" fill="#fff" font-size="10" font-weight="700" text-anchor="middle">MONGODB</text>

          <!-- Bước 1: Login -->
          <line x1="80" y1="55" x2="255" y2="55" stroke="#962a8c" stroke-width="1.6" marker-end="url(#auth-arr)"/>
          <text x="170" y="50" font-size="9" fill="#13213f" font-weight="600" text-anchor="middle">1. POST /auth/login</text>

          <line x1="260" y1="75" x2="435" y2="75" stroke="#1d6a2d" stroke-width="1.6" marker-end="url(#auth-arr)"/>
          <text x="350" y="70" font-size="9" fill="#1d6a2d" font-weight="600" text-anchor="middle">2. Verify Argon2id</text>

          <line x1="260" y1="95" x2="85" y2="95" stroke="#1f7a3a" stroke-width="1.6" marker-end="url(#auth-arr)"/>
          <text x="170" y="90" font-size="9" fill="#1f7a3a" font-weight="700" text-anchor="middle">Access (15m) + Refresh (7d)</text>

          <!-- Bước 2: Rotate -->
          <line x1="80" y1="125" x2="255" y2="125" stroke="#962a8c" stroke-width="1.6" marker-end="url(#auth-arr)"/>
          <text x="170" y="120" font-size="9" fill="#13213f" font-weight="600" text-anchor="middle">3. POST /auth/refresh</text>

          <line x1="260" y1="145" x2="85" y2="145" stroke="#1f7a3a" stroke-width="1.6" marker-end="url(#auth-arr)"/>
          <text x="170" y="140" font-size="9" fill="#1f7a3a" font-weight="600" text-anchor="middle">Cấp cặp Token mới (Rotate)</text>

          <!-- Bước 3: Reuse detection -->
          <rect x="180" y="160" width="160" height="32" rx="4" fill="#fee2e2" stroke="#b3261e" stroke-width="1.2"/>
          <text x="260" y="174" fill="#b3261e" font-size="9" font-weight="800" text-anchor="middle">REUSE TOKEN DETECTED</text>
          <text x="260" y="186" fill="#b3261e" font-size="8.5" text-anchor="middle">Thu hồi toàn bộ Token Family</text>
        </svg>
      </div>

      <div class="stack">
        <table>
          <tr><th>Tham số bảo mật</th><th>Cấu hình triển khai</th></tr>
          <tr><td>Thuật toán băm mật khẩu</td><td><b>Argon2id</b> (timeCost: 3, memoryCost: 64MB)</td></tr>
          <tr><td>Ký Access Token</td><td>HMAC-SHA256 (Secret 256-bit, TTL 15m)</td></tr>
          <tr><td>Lưu trữ Refresh Token</td><td>Băm SHA-256 trong MongoDB, không lưu thô</td></tr>
          <tr><td>Hạn chế Brute-force</td><td><code>ThrottlerGuard</code> (10 req/phút ở auth)</td></tr>
          <tr><td>Ngữ cảnh Auth MongoDB</td><td><code>authSource=admin</code> xác thực nội bộ</td></tr>
        </table>
      </div>
    </div>
  </div>
  <div class="foot"><span>4. Bảo mật &amp; Xác thực</span><code>auth.service.ts · Argon2id</code></div>
</section>

<!-- =========================================================
     SLIDE 6: OFFLINE-FIRST PERSISTENCE (DIAGRAM)
     ========================================================= -->
<section class="slide s6">
  <div class="slide-content">
    <div class="head reveal">
      <div class="chip">Lưu trữ Offline-First</div>
      <h2>Trải Nghiệm Hội Thoại Liên Tục với Dexie.js (IndexedDB)</h2>
      <p class="lede">Đọc lịch sử chat tức thì 0ms, tra cứu trích dẫn khoa học ngay cả khi Backend ngừng hoạt động.</p>
    </div>
    <div class="cols-wide reveal">
      <!-- Sơ đồ luồng Cache-First & Lazy Sync SVG -->
      <div class="diagram-card edge">
        <svg viewBox="0 0 520 210" width="100%" height="210" style="max-height: 40vh;">
          <defs>
            <marker id="dexie-arr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#4e9d2b"/>
            </marker>
          </defs>

          <!-- Hộp 1: Người dùng mở Web -->
          <g transform="translate(10, 20)">
            <rect width="135" height="75" rx="6" fill="#f8fafc" stroke="#13213f" stroke-width="1.8"/>
            <text x="67" y="25" fill="#13213f" font-size="10.5" font-weight="700" text-anchor="middle">1. MỞ ỨNG DỤNG</text>
            <text x="67" y="44" fill="#6b7286" font-size="9" text-anchor="middle">Kiểm tra phiên đăng nhập</text>
            <text x="67" y="60" fill="#13213f" font-size="9" font-weight="600" text-anchor="middle">Client Cache-First</text>
          </g>
          <path d="M 147 57 L 175 57" stroke="#4e9d2b" stroke-width="2" marker-end="url(#dexie-arr)"/>

          <!-- Hộp 2: Hydrate Dexie 0ms -->
          <g transform="translate(180, 20)">
            <rect width="160" height="75" rx="6" fill="#eef8ee" stroke="#4e9d2b" stroke-width="2"/>
            <text x="80" y="25" fill="#1d6a2d" font-size="10.5" font-weight="700" text-anchor="middle">2. DEXIE (INDEXEDDB)</text>
            <text x="80" y="44" fill="#13213f" font-size="9.5" font-weight="700" text-anchor="middle">Tải tức thì 0ms (Local)</text>
            <text x="80" y="60" fill="#6b7286" font-size="8.5" text-anchor="middle">Lịch sử · Trích dẫn · Timings</text>
          </g>

          <!-- Nhánh 3a: Backend Online -->
          <path d="M 342 45 L 368 35" stroke="#1f7a3a" stroke-width="1.8" marker-end="url(#dexie-arr)"/>
          <g transform="translate(370, 10)">
            <rect width="140" height="65" rx="6" fill="#f8fafc" stroke="#1f7a3a" stroke-width="1.8"/>
            <text x="70" y="20" fill="#1f7a3a" font-size="10" font-weight="700" text-anchor="middle">BACKEND LIVE (Online)</text>
            <text x="70" y="36" fill="#13213f" font-size="8.5" text-anchor="middle">GET /chat-sessions sync</text>
            <text x="70" y="50" fill="#64748b" font-size="8.5" text-anchor="middle">Lazy create on 1st prompt</text>
          </g>

          <!-- Nhánh 3b: Backend Offline -->
          <path d="M 342 70 L 368 85" stroke="#b3261e" stroke-width="1.8" marker-end="url(#dexie-arr)"/>
          <g transform="translate(370, 85)">
            <rect width="140" height="65" rx="6" fill="#fee2e2" stroke="#b3261e" stroke-width="1.8"/>
            <text x="70" y="20" fill="#b3261e" font-size="10" font-weight="700" text-anchor="middle">BACKEND DEAD (Offline)</text>
            <text x="70" y="36" fill="#13213f" font-size="8.5" text-anchor="middle">Huy hiệu "Ngoại tuyến"</text>
            <text x="70" y="50" fill="#b3261e" font-size="8.5" font-weight="700" text-anchor="middle">100% Đọc lịch sử bình thường</text>
          </g>

          <!-- Hàng dưới: 2-step Delete & UUIDv7 -->
          <g transform="translate(10, 120)">
            <rect width="330" height="75" rx="6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
            <text x="165" y="24" fill="#13213f" font-size="10" font-weight="700" text-anchor="middle">TÍNH NĂNG ĐA PHIÊN &amp; AN TOÀN DỮ LIỆU</text>
            <text x="165" y="44" fill="#6b7286" font-size="9" text-anchor="middle">Nút <b>+ Đoạn chat mới</b> · Tiêu đề tự sinh từ 48 ký tự đầu câu hỏi</text>
            <text x="165" y="62" fill="#13213f" font-size="9" font-weight="600" text-anchor="middle">Xóa an toàn 2 bước: Xác nhận inline (Xóa? / Huỷ) chống xóa nhầm</text>
          </g>
        </svg>
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
            <li><b>Cumulative Layout Shift (CLS):</b> <b>0.002</b> (hầu như không xô lệch bố cục).</li>
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

# Normalize unicode to NFC to avoid combining accent rendering bugs on Windows
normalized_html = unicodedata.normalize("NFC", html_template)

print(f"Writing generated slides HTML to {OUTPUT_HTML}...")
with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
    f.write(normalized_html)

print(f"Successfully generated {OUTPUT_HTML}! File size: {os.path.getsize(OUTPUT_HTML) / (1024 * 1024):.2f} MB")
