// Finds the highest load that meets the SLA for each scenario, then holds it 3 x 3 minutes. Each
// step is its own k6 process with resource sampling. Results go to OUT_DIR as one JSON per step.
// Env: BASE_URL, LOADTEST_POOL, EVAL_SET, SERVER_PID, OUT_DIR, SUITE (comma list), STEP_S, HOLD_S.
import { execSync, spawn } from 'child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const E = process.env;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = E.OUT_DIR;
mkdirSync(OUT, { recursive: true });
const STEP = Number(E.STEP_S ?? 60);
const HOLD = Number(E.HOLD_S ?? 180);
const HOLDS = Number(E.HOLDS ?? 3);
const DEADLINE = E.DEADLINE_S ? Date.now() + Number(E.DEADLINE_S) * 1000 : Infinity;
const MAX_FAILS = Number(E.MAX_FAILS ?? 2);
const HOLD_TRIES = Number(E.HOLD_TRIES ?? 3);
const SLA = { p95: 500, p99: 1000, err: 0.01, dropped: 0.01 };
const PLANS = {
  live: { kind: 'RATE', ladder: [1000, 2000, 3000, 4000, 5000, 6000, 8000] },
  health: { kind: 'RATE', ladder: [500, 1000, 2000, 3000, 4000, 5000] },
  papers_hot: { kind: 'RATE', ladder: [50, 100, 200, 400, 800, 1200] },
  papers_cold: { kind: 'RATE', ladder: [5, 10, 20, 40, 80, 120, 160] },
  crud: { kind: 'RATE', ladder: [25, 50, 100, 150, 200, 300, 400, 600, 800] },
  crypto: { kind: 'RATE', ladder: [2, 4, 8, 12, 16, 24, 32] },
  journey: { kind: 'VUS', ladder: [100, 200, 400, 800, 1200, 1600, 2400] },
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

function sampleLoop(k6Pid, out) {
  const samples = [];
  const t0 = Date.now();
  const timer = setInterval(() => {
    try {
      const ps = (pid) => execSync(`ps -o %cpu=,rss= -p ${pid}`, { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
      const [cpu, rss] = ps(E.SERVER_PID);
      const [k6cpu] = ps(k6Pid);
      samples.push({ t: (Date.now() - t0) / 1000, server_cpu: cpu, server_rss_mb: rss / 1024, k6_cpu: k6cpu });
    } catch { /* the process just ended */ }
  }, 2000);
  let docker = '';
  const d = setInterval(() => {
    try { docker = execSync(`docker stats --no-stream --format '{{.Name}}={{.CPUPerc}}' ${E.DB_CONTAINERS ?? ''}`, { encoding: 'utf8' }); samples.push({ t: (Date.now() - t0) / 1000, docker }); } catch { /* optional */ }
  }, 15000);
  return () => { clearInterval(timer); clearInterval(d); writeFileSync(out, JSON.stringify(samples)); return samples; };
}

function verdict(sum) {
  const m = sum.metrics;
  const v = (k, f) => m[k]?.[f] ?? 0;
  const dur = v('http_req_duration', 'p(95)');
  const count = v('http_reqs', 'count');
  const dropped = v('dropped_iterations', 'count');
  // A k6 summary export keeps a rate in `value`.
  const err = 1 - (m.ok?.value ?? 0);
  const res = { reqs: count, rps: v('http_reqs', 'rate'), p50: v('http_req_duration', 'med'), p90: v('http_req_duration', 'p(90)'), p95: dur, p99: v('http_req_duration', 'p(99)'), max: v('http_req_duration', 'max'), err, throttled: v('throttled_429', 'count'), server_5xx: v('server_5xx', 'count'), dropped, vus_max: v('vus_max', 'value') };
  res.dropped_rate = dropped / Math.max(1, count + dropped);
  res.pass = res.p95 < SLA.p95 && res.p99 < SLA.p99 && res.err < SLA.err && res.dropped_rate < SLA.dropped && count > 0;
  return res;
}

function k6Step(scn, kind, value, seconds, tag) {
  return new Promise((resolve) => {
    const base = join(OUT, `${scn}_${tag}_${value}`);
    const args = ['run', '--quiet', '--no-usage-report', `--summary-export=${base}.summary.json`, '--summary-trend-stats=med,p(90),p(95),p(99),max,avg', '--env', `SCN=${scn}`, '--env', `${kind}=${value}`, '--env', `DURATION=${seconds}s`, '--env', `BASE_URL=${E.BASE_URL}`, '--env', `LOADTEST_POOL=${E.LOADTEST_POOL}`, '--env', `EVAL_SET=${E.EVAL_SET}`];
    if (tag.startsWith('hold')) args.push(`--out=csv=${base}.csv.gz`);
    args.push(join(HERE, 'load.ts'));
    const p = spawn('k6', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d; });
    const stop = sampleLoop(p.pid, `${base}.telemetry.json`);
    p.on('close', (code) => {
      const samples = stop();
      let sum = null;
      try { sum = JSON.parse(readFileSync(`${base}.summary.json`, 'utf8')); } catch { /* reported below */ }
      if (!sum) return resolve({ pass: false, failed: `k6 exit ${code}: ${stderr.slice(0, 300)}` });
      const r = { scn, kind, value, seconds, tag, k6_exit: code, ...verdict(sum) };
      const cpu = samples.filter((s) => s.server_cpu !== undefined).slice(2);
      const avg = (k) => cpu.reduce((a, s) => a + s[k], 0) / Math.max(1, cpu.length);
      r.server_cpu_avg = avg('server_cpu'); r.server_rss_mb = Math.max(0, ...cpu.map((s) => s.server_rss_mb)); r.k6_cpu_avg = avg('k6_cpu');
      r.endpoints = Object.fromEntries(Object.entries(sum.metrics).filter(([k]) => k.startsWith('ep_') && sum.metrics[k].max > 0).map(([k, v]) => [k.slice(3), v]));
      r.chat = Object.fromEntries(Object.entries(sum.metrics).filter(([k]) => k.startsWith('chat_')).map(([k, v]) => [k.slice(5), v]));
      writeFileSync(`${base}.json`, JSON.stringify(r, null, 1));
      rmSync(`${base}.summary.json`, { force: true });
      resolve(r);
    });
  });
}
const brief = (r) => (r.failed ? `FAILED ${r.failed}` : `${r.pass ? 'PASS' : 'fail'} rps=${r.rps?.toFixed(1)} p95=${r.p95?.toFixed(0)} p99=${r.p99?.toFixed(0)} err=${(r.err * 100).toFixed(2)}% 429=${r.throttled} 5xx=${r.server_5xx} drop=${r.dropped} cpu=${r.server_cpu_avg?.toFixed(0)}% k6cpu=${r.k6_cpu_avg?.toFixed(0)}%`);

async function capacity(scn) {
  const plan = { ...PLANS[scn], ...(E[`LADDER_${scn}`] ? { ladder: E[`LADDER_${scn}`].split(',').map(Number) } : {}) };
  let best = null;
  let fails = 0;
  for (const value of plan.ladder) {
    const r = await k6Step(scn, plan.kind, value, STEP, 'scan');
    log(scn, plan.kind, value, brief(r));
    if (r.pass) { best = value; fails = 0; } else if (++fails >= MAX_FAILS) break;
    await sleep(15);
  }
  if (!best) { log(scn, 'NO PASSING STEP'); return null; }
  // Hold: the rate only counts if it stays inside the SLA in every hold.
  for (let v = best, tries = 0; tries < HOLD_TRIES; tries++, v = Math.max(1, Math.floor(v * 0.8))) {
    const runs = [];
    for (let h = 1; h <= HOLDS; h++) {
      const r = await k6Step(scn, plan.kind, v, HOLD, `hold${h}`);
      log(scn, 'hold', h, plan.kind, v, brief(r));
      runs.push(r);
      if (!r.pass) break;
      await sleep(30);
    }
    if (runs.length === HOLDS && runs.every((r) => r.pass)) { log(scn, 'CERTIFIED', plan.kind, v); return v; }
    await sleep(30);
  }
  log(scn, 'NOT CERTIFIED');
  return null;
}

async function chat() {
  const secs = Number(E.CHAT_STEP_S ?? 240);
  for (const vus of (E.CHAT_VUS ?? '1,2,4,8,12,16').split(',').map(Number)) {
    const r = await k6Step('chat', 'VUS', vus, secs, E.CHAT_TAG ?? 'laya');
    log('chat', E.CHAT_TAG ?? 'laya', 'VUS', vus, brief(r), 'answered', r.chat?.answered?.count, 'abstained', r.chat?.abstained?.count);
    await sleep(45);
  }
}

const certified = {};
for (const scn of E.SUITE.split(',')) {
  if (Date.now() > DEADLINE) { log(scn, 'SKIPPED_DEADLINE'); continue; }
  if (scn === 'chat') await chat();
  else certified[scn] = await capacity(scn);
  writeFileSync(join(OUT, `certified_${scn}.json`), JSON.stringify(certified[scn] ?? null));
  await sleep(30);
}
log('SUITE_DONE', JSON.stringify(certified));
