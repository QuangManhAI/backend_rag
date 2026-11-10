import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { monitorEventLoopDelay } from 'perf_hooks';
import type { HealthService } from '../../modules/health/health.service';

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];
const ACTIVE_WINDOW_1M_MS = 60_000;
const ACTIVE_WINDOW_5M_MS = 300_000;
const MAX_ACTIVE_ACTORS = 10_000;

interface HistogramEntry {
  method: string;
  route: string;
  status: string;
  buckets: number[];
  sum: number;
  count: number;
}

export class PrometheusMetricsRegistry {
  private readonly histograms = new Map<string, HistogramEntry>();
  private readonly activeActors = new Map<string, number>();
  private inFlightRequests = 0;
  private activeSseStreams = 0;
  private readonly eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });

  constructor(private readonly getHealthService?: () => HealthService | null) {
    this.eventLoopHistogram.enable();
  }

  middleware = (req: Request, res: Response, next: NextFunction): void => {
    const rawPath = req.path || req.url.split('?')[0] || '/';
    if (
      req.method === 'GET' &&
      (rawPath === '/metrics' || rawPath === '/api/v1/metrics')
    ) {
      void this.serveMetrics(res);
      return;
    }

    const startNs = process.hrtime.bigint();
    const isHealthProbe =
      rawPath.startsWith('/api/v1/health') || rawPath === '/health';
    const isSseStream = rawPath === '/api/v1/rag/chat/stream';

    if (!isHealthProbe) {
      this.recordActiveActor(req);
      this.inFlightRequests++;
      if (isSseStream) {
        this.activeSseStreams++;
      }
    }

    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;

      if (!isHealthProbe) {
        this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
        if (isSseStream) {
          this.activeSseStreams = Math.max(0, this.activeSseStreams - 1);
        }
      }

      const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
      const route = this.resolveRouteLabel(req, rawPath);
      const method = req.method.toUpperCase();
      const status = String(res.statusCode || 200);
      this.observeRequest(method, route, status, durationSec);
    };

    res.on('finish', finalize);
    res.on('close', finalize);
    next();
  };

  private recordActiveActor(req: Request): void {
    const now = Date.now();
    const auth = req.headers.authorization;
    let actorKey: string;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      actorKey =
        'u:' + createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 16);
    } else {
      actorKey = 'ip:' + (req.ip || req.socket.remoteAddress || 'unknown');
    }

    if (
      this.activeActors.size >= MAX_ACTIVE_ACTORS &&
      !this.activeActors.has(actorKey)
    ) {
      this.pruneActiveActors(now);
    }
    this.activeActors.set(actorKey, now);
  }

  private pruneActiveActors(now: number): { active1m: number; active5m: number } {
    let active1m = 0;
    let active5m = 0;
    for (const [key, seenAt] of this.activeActors.entries()) {
      const age = now - seenAt;
      if (age > ACTIVE_WINDOW_5M_MS) {
        this.activeActors.delete(key);
      } else {
        active5m++;
        if (age <= ACTIVE_WINDOW_1M_MS) {
          active1m++;
        }
      }
    }
    return { active1m, active5m };
  }

  private resolveRouteLabel(req: Request, rawPath: string): string {
    const routeObj = req.route as { path?: string } | undefined;
    if (routeObj && typeof routeObj.path === 'string') {
      const base = req.baseUrl || '';
      const combined = `${base}${routeObj.path}`;
      return combined.endsWith('/') && combined.length > 1
        ? combined.slice(0, -1)
        : combined;
    }
    if (resStatusIs404(req)) {
      return 'unmatched';
    }
    return rawPath;
  }

  private observeRequest(
    method: string,
    route: string,
    status: string,
    durationSec: number,
  ): void {
    const key = `${method}|${route}|${status}`;
    let entry = this.histograms.get(key);
    if (!entry) {
      entry = {
        method,
        route,
        status,
        buckets: new Array<number>(BUCKETS.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.histograms.set(key, entry);
    }
    entry.count++;
    entry.sum += durationSec;
    for (let i = 0; i < BUCKETS.length; i++) {
      if (durationSec <= BUCKETS[i]) {
        entry.buckets[i]++;
      }
    }
  }

  async renderPrometheusText(): Promise<string> {
    const lines: string[] = [];
    const now = Date.now();
    const { active1m, active5m } = this.pruneActiveActors(now);

    lines.push(
      '# HELP rag_active_users_1m Distinct active users (JWT or IP) in the last 1 minute',
      '# TYPE rag_active_users_1m gauge',
      `rag_active_users_1m ${active1m}`,
      '# HELP rag_active_users_5m Distinct active users (JWT or IP) in the last 5 minutes',
      '# TYPE rag_active_users_5m gauge',
      `rag_active_users_5m ${active5m}`,
      '# HELP rag_http_in_flight_requests Current in-flight HTTP requests (excluding health probes)',
      '# TYPE rag_http_in_flight_requests gauge',
      `rag_http_in_flight_requests ${this.inFlightRequests}`,
      '# HELP rag_sse_active_streams Currently open RAG SSE chat streams',
      '# TYPE rag_sse_active_streams gauge',
      `rag_sse_active_streams ${this.activeSseStreams}`,
    );

    lines.push(
      '# HELP rag_http_requests_total Total number of HTTP requests handled',
      '# TYPE rag_http_requests_total counter',
    );
    for (const e of this.histograms.values()) {
      const labels = `method="${esc(e.method)}",route="${esc(e.route)}",status="${esc(e.status)}"`;
      lines.push(`rag_http_requests_total{${labels}} ${e.count}`);
    }

    lines.push(
      '# HELP rag_http_request_duration_seconds HTTP request latency histogram in seconds',
      '# TYPE rag_http_request_duration_seconds histogram',
    );
    for (const e of this.histograms.values()) {
      const baseLabels = `method="${esc(e.method)}",route="${esc(e.route)}",status="${esc(e.status)}"`;
      for (let i = 0; i < BUCKETS.length; i++) {
        lines.push(
          `rag_http_request_duration_seconds_bucket{${baseLabels},le="${BUCKETS[i]}"} ${e.buckets[i]}`,
        );
      }
      lines.push(
        `rag_http_request_duration_seconds_bucket{${baseLabels},le="+Inf"} ${e.count}`,
        `rag_http_request_duration_seconds_sum{${baseLabels}} ${e.sum.toFixed(6)}`,
        `rag_http_request_duration_seconds_count{${baseLabels}} ${e.count}`,
      );
    }

    // Component health & LLM queue length
    try {
      const healthSvc = this.getHealthService?.();
      if (healthSvc) {
        const h = await healthSvc.health();
        lines.push(
          '# HELP rag_component_up Whether a backend subsystem is healthy (1 = up, 0 = down)',
          '# TYPE rag_component_up gauge',
          `rag_component_up{component="mongo"} ${h.components.mongo ? 1 : 0}`,
          `rag_component_up{component="qdrant"} ${h.components.qdrant ? 1 : 0}`,
          `rag_component_up{component="llm"} ${h.components.llm ? 1 : 0}`,
          `rag_component_up{component="world"} ${h.components.world ? 1 : 0}`,
          '# HELP rag_llm_queue_length Current number of requests queued on the LLM engine',
          '# TYPE rag_llm_queue_length gauge',
          `rag_llm_queue_length ${h.llm.queue_length}`,
        );
      }
    } catch {
      // Never fail metrics scrape if health check is still bootstrapping
    }

    // Node.js runtime telemetry
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const cpuTotalSec = (cpu.user + cpu.system) / 1e6;
    const lagMeanSec = (this.eventLoopHistogram.mean || 0) / 1e9;
    const lagP99Sec = (this.eventLoopHistogram.percentile(99) || 0) / 1e9;

    lines.push(
      '# HELP rag_uptime_seconds Backend process uptime in seconds',
      '# TYPE rag_uptime_seconds gauge',
      `rag_uptime_seconds ${Math.floor(process.uptime())}`,
      '# HELP process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${mem.rss}`,
      '# HELP nodejs_heap_used_bytes Node.js V8 heap used in bytes',
      '# TYPE nodejs_heap_used_bytes gauge',
      `nodejs_heap_used_bytes ${mem.heapUsed}`,
      '# HELP nodejs_heap_total_bytes Node.js V8 heap total in bytes',
      '# TYPE nodejs_heap_total_bytes gauge',
      `nodejs_heap_total_bytes ${mem.heapTotal}`,
      '# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds',
      '# TYPE process_cpu_seconds_total counter',
      `process_cpu_seconds_total ${cpuTotalSec.toFixed(4)}`,
      '# HELP nodejs_eventloop_lag_seconds Node.js event loop mean lag in seconds',
      '# TYPE nodejs_eventloop_lag_seconds gauge',
      `nodejs_eventloop_lag_seconds ${lagMeanSec.toFixed(6)}`,
      '# HELP nodejs_eventloop_lag_p99_seconds Node.js event loop p99 lag in seconds',
      '# TYPE nodejs_eventloop_lag_p99_seconds gauge',
      `nodejs_eventloop_lag_p99_seconds ${lagP99Sec.toFixed(6)}`,
    );

    return lines.join('\n') + '\n';
  }

  private async serveMetrics(res: Response): Promise<void> {
    const body = await this.renderPrometheusText();
    res.status(200);
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  }
}

function resStatusIs404(req: Request): boolean {
  return (req.res?.statusCode ?? 0) === 404;
}

function esc(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
