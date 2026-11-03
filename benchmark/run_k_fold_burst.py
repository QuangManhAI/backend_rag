import asyncio
import json
import statistics
import time
from pathlib import Path
import aiohttp

BENCHMARK_DIR = Path("C:/document/Study documents/backend_rag/RAG_TS/backend_rag/benchmark")
RESULTS_DIR = BENCHMARK_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

URL = "http://localhost:3000/api/v1/rag/chat"
K_TRIALS = 5
BURST_USERS = 16

async def send_single_query(session, req_id: int):
    payload = {
        "query": f"Explain machine learning concepts and neural networks. Query #{req_id}",
        "top_k": 2
    }
    t0 = time.perf_counter()
    try:
        async with session.post(URL, json=payload, timeout=aiohttp.ClientTimeout(total=85)) as resp:
            data = await resp.text()
            dur = time.perf_counter() - t0
            return {
                "req_id": req_id,
                "status": resp.status,
                "duration_s": dur,
                "success": (resp.status == 200)
            }
    except Exception as e:
        dur = time.perf_counter() - t0
        return {
            "req_id": req_id,
            "status": 504 if "timeout" in str(e).lower() else 500,
            "duration_s": dur,
            "success": False,
            "error": str(e)
        }

async def run_single_burst_trial(trial_idx: int):
    print(f"\n[Trial {trial_idx}/{K_TRIALS}] Firing {BURST_USERS} simultaneous queries at t=0...")
    t_start = time.perf_counter()
    async with aiohttp.ClientSession() as session:
        tasks = [send_single_query(session, i + 1) for i in range(BURST_USERS)]
        results = await asyncio.gather(*tasks)
    
    # Sort by completion order (slot position 1 to 16)
    results.sort(key=lambda r: r["duration_s"])
    total_time = time.perf_counter() - t_start
    print(f" -> Trial {trial_idx} completed in {total_time:.2f}s.")
    return results

async def main():
    print(f"===========================================================")
    print(f" EMPIRICAL K-FOLD BURST EXPERIMENT (K={K_TRIALS}, Users={BURST_USERS})")
    print(f"===========================================================")
    
    trials_data = []
    for k in range(1, K_TRIALS + 1):
        trial_res = await run_single_burst_trial(k)
        trials_data.append(trial_res)
        if k < K_TRIALS:
            print("Cooling down 5s before next trial...")
            await asyncio.sleep(5)

    # Compute statistics per slot position (1 to 16)
    slot_stats = []
    for slot_idx in range(BURST_USERS):
        durations = [trials_data[k][slot_idx]["duration_s"] for k in range(K_TRIALS)]
        statuses = [trials_data[k][slot_idx]["status"] for k in range(K_TRIALS)]
        
        mean_dur = statistics.mean(durations)
        std_dur = statistics.stdev(durations) if K_TRIALS > 1 else 0.0
        min_dur = min(durations)
        max_dur = max(durations)
        
        # Most frequent status
        status_mode = max(set(statuses), key=statuses.count)
        
        slot_stats.append({
            "slot": slot_idx + 1,
            "mean_s": round(mean_dur, 2),
            "std_s": round(std_dur, 2),
            "min_s": round(min_dur, 2),
            "max_s": round(max_dur, 2),
            "raw_durations": [round(d, 2) for d in durations],
            "status": status_mode
        })
        print(f"Slot #{slot_idx + 1:2d}: Mean = {mean_dur:5.2f}s ± {std_dur:4.2f}s (Min: {min_dur:5.2f}s, Max: {max_dur:5.2f}s) | Status: {status_mode}")

    summary = {
        "k_trials": K_TRIALS,
        "burst_users": BURST_USERS,
        "slot_statistics": slot_stats,
        "raw_trials": trials_data
    }
    
    out_file = RESULTS_DIR / "k_fold_burst_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"\nEmpirical K-fold burst benchmark finished! Saved to {out_file}")

if __name__ == "__main__":
    asyncio.run(main())
