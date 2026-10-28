"""
5-minute endurance qualification for Max Concurrent Users (CU).

Protocol (per candidate CU):
    1-minute hold  ->  3-minute hold  ->  5-minute hold
Each hold is preceded by a 30s ramp-up that is NOT judged. A candidate is certified only if it
passes the SLA in all three holds. On any failure, the candidate is stepped down by 20% and the
protocol restarts from the 1-minute stage.

SLA (hold phase only):
    P95 < 500 ms, P99 < 1000 ms  (successful responses)
    error rate < 1%              (non-200 / refused / timeout; 429 counts as intentional shedding)

Raw throughput (req/s) = hold-phase requests / hold seconds.
A per-second time series (RPS + P95) is aggregated from k6's CSV stream for each stage.
"""
import csv
import json
import os
import subprocess
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

BENCHMARK_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark")
RESULTS_DIR = BENCHMARK_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
K6_PATH = r"C:\Program Files\k6\k6.exe"
DURATION_SECONDS = {"10s": 10, "30s": 30, "1m": 60, "3m": 180, "5m": 300}
RAMP = "30s"
STAGES = ["1m", "3m", "5m"]
FLOOR_VUS = 50
STEP_DOWN_PCT = 0.20


def log(msg: str) -> None:
    print(msg, flush=True)


def percentile(sorted_vals, q):
    if not sorted_vals:
        return 0.0
    idx = min(len(sorted_vals) - 1, int(round(q * (len(sorted_vals) - 1))))
    return sorted_vals[idx]


def aggregate_timeseries(csv_path: Path) -> list:
    """Per-second hold-phase RPS and latency percentiles from the k6 CSV stream."""
    reqs = defaultdict(int)
    errs = defaultdict(float)
    lat = defaultdict(list)
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row.get("metric_name")
            if name not in ("hold_requests", "hold_req_duration", "hold_error_rate"):
                continue
            ts = int(float(row["timestamp"]))
            val = float(row["metric_value"])
            if name == "hold_requests":
                reqs[ts] += 1
            elif name == "hold_error_rate":
                errs[ts] += val
            else:
                lat[ts].append(val)
    if not reqs:
        return []
    t0 = min(reqs)
    series = []
    for ts in sorted(reqs):
        l = sorted(lat.get(ts, []))
        series.append({
            "t": ts - t0,
            "rps": reqs[ts],
            "errors": int(errs.get(ts, 0)),
            "p50_ms": round(percentile(l, 0.50), 1),
            "p95_ms": round(percentile(l, 0.95), 1),
            "p99_ms": round(percentile(l, 0.99), 1),
        })
    return series


def run_k6_soak(vus: int, duration: str, scenario: str = "fast") -> dict:
    summary_path = RESULTS_DIR / f"temp_soak_{scenario}_{vus}vus_{duration}.json"
    csv_path = Path(tempfile.gettempdir()) / f"k6_soak_{scenario}_{vus}_{duration}.csv"
    for p in (summary_path, csv_path):
        if p.exists():
            p.unlink()
    cmd = [
        K6_PATH, "run", "--quiet",
        "--env", f"SOAK_VUS={vus}",
        "--env", f"SOAK_DURATION={duration}",
        "--env", f"SOAK_RAMP={RAMP}",
        "--env", f"SOAK_SCENARIO={scenario}",
        "--summary-export", str(summary_path),
        "--out", f"csv={csv_path}",
        str(BENCHMARK_DIR / "k6_qualification_soak.ts"),
    ]
    log(f"\n[SOAK RUN] {vus} VUs | ramp {RAMP} + hold {duration} | scenario={scenario}")
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - t0

    if not summary_path.exists():
        log(f"Error: summary not exported. k6 stderr:\n{proc.stderr[-2000:]}")
        return {"vus": vus, "duration": duration, "passed_sla": False, "error": "summary export failed"}

    with open(summary_path, "r", encoding="utf-8") as f:
        metrics = json.load(f).get("metrics", {})
    summary_path.unlink()

    # Hold-phase metrics only. Latency = successful responses; errors judged separately.
    total_reqs = metrics.get("hold_requests", {}).get("count", 0)
    hold_s = DURATION_SECONDS.get(duration, 60)
    rps = total_reqs / hold_s if hold_s else 0.0
    d = metrics.get("hold_req_duration", {})
    p50, p90, p95, p99 = d.get("med", 0.0), d.get("p(90)", 0.0), d.get("p(95)", 0.0), d.get("p(99)", 0.0)
    error_rate = metrics.get("hold_error_rate", {}).get("value", 1.0)

    passed = total_reqs > 0 and 0 < p95 < 500.0 and p99 < 1000.0 and error_rate < 0.01

    series = []
    if csv_path.exists():
        try:
            series = aggregate_timeseries(csv_path)
        finally:
            csv_path.unlink()

    result = {
        "vus": vus,
        "duration": duration,
        "scenario": scenario,
        "elapsed_s": round(elapsed, 1),
        "total_requests": int(total_reqs),
        "raw_rps": round(rps, 2),
        "p50_ms": round(p50, 2),
        "p90_ms": round(p90, 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(p99, 2),
        "avg_ms": round(d.get("avg", 0.0), 2),
        "max_ms": round(d.get("max", 0.0), 2),
        "error_rate": round(error_rate * 100, 3),
        "passed_sla": passed,
        "timeseries": series,
    }
    log(f" -> {'PASSED' if passed else 'FAILED'}: {int(total_reqs):,} reqs | Raw RPS: {result['raw_rps']} req/s"
        f" | P50 {result['p50_ms']}ms | P95 {result['p95_ms']}ms | P99 {result['p99_ms']}ms | Errors {result['error_rate']}%")
    return result


def qualify(candidate_vus: int, scenario: str = "fast") -> dict:
    current = candidate_vus
    history = []
    while current >= FLOOR_VUS:
        log("\n" + "=" * 60)
        log(f" CANDIDATE: {current} concurrent users ({scenario})")
        log("=" * 60)
        stages = {}
        passed_all = True
        for dur in STAGES:
            res = run_k6_soak(current, dur, scenario)
            stages[dur] = res
            if not res["passed_sla"]:
                passed_all = False
                log(f"[FAIL] SLA breached in the {dur} hold at {current} VUs")
                break
            log(f"[PASS] {dur} hold at {current} VUs")
            time.sleep(10)  # let sockets drain between stages
        history.append({"vus": current, "certified": passed_all, "stages": stages})
        if passed_all:
            log(f"\nCERTIFIED MAX SUSTAINED CU: {current} VUs (survived 1m, 3m and 5m holds)")
            return {"scenario": scenario, "certified_max_cu": current, "soak_stages": stages, "history": history}
        current = int(current * (1 - STEP_DOWN_PCT))
        log(f"Stepping down 20% -> next candidate {current} VUs")
        time.sleep(15)
    return {"scenario": scenario, "certified_max_cu": None, "history": history,
            "error": f"no candidate >= {FLOOR_VUS} VUs survived"}


def probe_failure_point(tiers, scenario: str = "fast") -> dict:
    """Step-ladder probe (30s hold per tier). Returns the last tier that passed the SLA
    before the first failing tier, i.e. the CU 'right before the failure point'."""
    log("\n" + "=" * 60)
    log(f" PROBE: locating failure point across tiers {tiers}")
    log("=" * 60)
    probes = []
    last_pass = None
    first_fail = None
    for vus in tiers:
        res = run_k6_soak(vus, "30s", scenario)
        probes.append(res)
        if res["passed_sla"]:
            last_pass = vus
        else:
            first_fail = vus
            break
        time.sleep(10)
    log(f"Probe result: last passing tier = {last_pass}, first failing tier = {first_fail}")
    return {"last_pass": last_pass, "first_fail": first_fail, "probes": probes}


def environment() -> dict:
    plan = subprocess.run(["powercfg", "/getactivescheme"], capture_output=True, text=True).stdout.strip()
    return {
        "power_plan": plan.split("(")[-1].rstrip(")") if "(" in plan else plan,
        "ramp": RAMP,
        "stages": STAGES,
        "step_down_pct": STEP_DOWN_PCT,
        "sla": {"p95_ms": 500, "p99_ms": 1000, "error_rate_pct": 1},
        "testbed": "NVIDIA RTX 4060 Laptop 8GB, Intel i7-13620H, 16GB RAM, Windows 11",
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


if __name__ == "__main__":
    scenario = sys.argv[1] if len(sys.argv) > 1 else "fast"
    arg = sys.argv[2] if len(sys.argv) > 2 else "auto"
    env = environment()
    log(f"Concurrency qualification protocol | scenario={scenario} | candidate={arg}")
    log(f"Environment: {env['power_plan']} power plan")

    probe = None
    if arg == "auto":
        tiers = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000] if scenario == "fast" else [20, 40, 60, 80, 100, 120]
        probe = probe_failure_point(tiers, scenario)
        candidate = probe["last_pass"] or tiers[0]
    else:
        candidate = int(arg)

    results = qualify(candidate, scenario)
    results["environment"] = env
    results["probe"] = probe
    out = RESULTS_DIR / f"qualification_{scenario}_results.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    log(f"\nSaved {out}")
