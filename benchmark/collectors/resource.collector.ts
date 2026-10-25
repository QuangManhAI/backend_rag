/**
 * Collects process-level resource metrics (CPU and Memory) in Node.js runtime.
 */

export interface ResourceSnapshot {
  label: string;
  timestamp: string;
  memory_mb: {
    rss: number;
    heap_total: number;
    heap_used: number;
    external: number;
  };
  cpu_usage_us: {
    user: number;
    system: number;
  };
}

export interface ResourceSummary {
  start_snapshot: ResourceSnapshot;
  end_snapshot: ResourceSnapshot;
  peak_rss_mb: number;
  peak_heap_used_mb: number;
  delta_rss_mb: number;
  delta_heap_used_mb: number;
  total_cpu_time_ms: number;
}

export class ResourceCollector {
  private snapshots: ResourceSnapshot[] = [];
  private initialCpu = process.cpuUsage();

  snapshot(label: string): ResourceSnapshot {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage(this.initialCpu);

    const snap: ResourceSnapshot = {
      label,
      timestamp: new Date().toISOString(),
      memory_mb: {
        rss: Math.round((mem.rss / (1024 * 1024)) * 100) / 100,
        heap_total: Math.round((mem.heapTotal / (1024 * 1024)) * 100) / 100,
        heap_used: Math.round((mem.heapUsed / (1024 * 1024)) * 100) / 100,
        external: Math.round((mem.external / (1024 * 1024)) * 100) / 100,
      },
      cpu_usage_us: {
        user: cpu.user,
        system: cpu.system,
      },
    };

    this.snapshots.push(snap);
    return snap;
  }

  getSummary(): ResourceSummary | null {
    if (this.snapshots.length < 2) return null;
    const start = this.snapshots[0];
    const end = this.snapshots[this.snapshots.length - 1];

    let peakRss = 0;
    let peakHeap = 0;

    for (const s of this.snapshots) {
      if (s.memory_mb.rss > peakRss) peakRss = s.memory_mb.rss;
      if (s.memory_mb.heap_used > peakHeap) peakHeap = s.memory_mb.heap_used;
    }

    const cpuDeltaUs =
      end.cpu_usage_us.user +
      end.cpu_usage_us.system -
      (start.cpu_usage_us.user + start.cpu_usage_us.system);

    return {
      start_snapshot: start,
      end_snapshot: end,
      peak_rss_mb: peakRss,
      peak_heap_used_mb: peakHeap,
      delta_rss_mb:
        Math.round((end.memory_mb.rss - start.memory_mb.rss) * 100) / 100,
      delta_heap_used_mb:
        Math.round(
          (end.memory_mb.heap_used - start.memory_mb.heap_used) * 100,
        ) / 100,
      total_cpu_time_ms: Math.round((cpuDeltaUs / 1000) * 100) / 100,
    };
  }

  getAllSnapshots(): ResourceSnapshot[] {
    return [...this.snapshots];
  }
}
