import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { RequestMeasurement } from '../metrics/runtime.metrics';
import type { RagStreamEvent } from '../../src/types/scientific-rag';

export interface SseClientRequestOptions {
  url: string;
  query: string;
  top_k?: number;
  category?: string;
  nprobe?: number;
  use_authority_boost?: boolean;
  expand_query?: boolean;
  timeout_ms?: number;
  bearer_token?: string;
  scenario?: string;
  concurrency_level?: number;
  request_id?: string;
  is_streaming?: boolean;
}

/**
 * Parses raw SSE chunk data buffer and yields structured RagStreamEvents.
 */
export function parseSseChunkBuffer(
  buffer: string,
): { events: RagStreamEvent[]; remainingBuffer: string } {
  const parts = buffer.split('\n\n');
  const remaining = parts.pop() ?? '';
  const events: RagStreamEvent[] = [];

  for (const part of parts) {
    const lines = part.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6);
        try {
          const ev = JSON.parse(jsonStr) as RagStreamEvent;
          events.push(ev);
        } catch {
          // Ignore unparseable lines or comments
        }
      }
    }
  }

  return { events, remainingBuffer: remaining };
}

/**
 * Executes a streaming or non-streaming RAG request, precisely measuring:
 * - Total Latency
 * - Time to First Token (TTFT) - triggered ONLY on the first content token event
 * - Completion Time
 * - Internal Server Timings
 */
export async function executeRagRequest(
  opts: SseClientRequestOptions,
): Promise<RequestMeasurement> {
  const startTime = performance.now();
  const requestId = opts.request_id || `req_${Math.random().toString(36).slice(2, 9)}`;
  const isStreaming = opts.is_streaming !== false; // default true
  const timeoutMs = opts.timeout_ms || 30000;

  const parsedUrl = new URL(opts.url);
  const isHttps = parsedUrl.protocol === 'https:';
  const transport = isHttps ? https : http;

  const payload = JSON.stringify({
    query: opts.query,
    top_k: opts.top_k ?? 5,
    category: opts.category,
    nprobe: opts.nprobe ?? 2,
    use_authority_boost: opts.use_authority_boost ?? true,
    expand_query: opts.expand_query ?? false,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload).toString(),
    'User-Agent': 'RAG-Benchmark-Runner/1.0',
    'X-Request-Id': requestId,
  };

  if (opts.bearer_token) {
    headers['Authorization'] = `Bearer ${opts.bearer_token}`;
  }

  return new Promise<RequestMeasurement>((resolve) => {
    let firstTokenTime: number | null = null;
    let tokenCount = 0;
    let serverTimings: RequestMeasurement['server_timings'] | undefined;
    let rawBuffer = '';
    let isTimeout = false;
    let isAborted = false;
    let statusCode = 0;
    let errorMessage: string | undefined;

    const req = transport.request(
      opts.url,
      {
        method: 'POST',
        headers,
      },
      (res) => {
        statusCode = res.statusCode || 0;

        if (statusCode >= 400) {
          let errBody = '';
          res.on('data', (d) => (errBody += d.toString()));
          res.on('end', () => {
            const endTime = performance.now();
            resolve({
              request_id: requestId,
              query: opts.query,
              scenario: opts.scenario || 'default',
              concurrency_level: opts.concurrency_level || 1,
              start_time_ms: startTime,
              end_time_ms: endTime,
              total_latency_ms: Math.round((endTime - startTime) * 100) / 100,
              ttft_ms: null,
              completion_time_ms: Math.round((endTime - startTime) * 100) / 100,
              status_code: statusCode,
              success: false,
              is_timeout: false,
              is_aborted: false,
              error_message: `HTTP ${statusCode}: ${errBody.slice(0, 200)}`,
            });
          });
          return;
        }

        if (!isStreaming) {
          // Non-streaming JSON mode (POST /api/v1/rag/chat)
          let jsonBody = '';
          res.on('data', (chunk) => (jsonBody += chunk.toString()));
          res.on('end', () => {
            const endTime = performance.now();
            try {
              const data = JSON.parse(jsonBody);
              if (data.timings) serverTimings = data.timings;
            } catch {
              // Ignore json parse error
            }

            resolve({
              request_id: requestId,
              query: opts.query,
              scenario: opts.scenario || 'default',
              concurrency_level: opts.concurrency_level || 1,
              start_time_ms: startTime,
              end_time_ms: endTime,
              total_latency_ms: Math.round((endTime - startTime) * 100) / 100,
              ttft_ms: null, // Not applicable for non-streaming
              completion_time_ms: Math.round((endTime - startTime) * 100) / 100,
              status_code: statusCode,
              success: true,
              is_timeout: false,
              is_aborted: false,
              server_timings: serverTimings,
            });
          });
          return;
        }

        // Streaming mode (POST /api/v1/rag/chat/stream)
        res.on('data', (chunk: Buffer) => {
          rawBuffer += chunk.toString('utf8');
          const { events, remainingBuffer } = parseSseChunkBuffer(rawBuffer);
          rawBuffer = remainingBuffer;

          for (const ev of events) {
            // CRITICAL: TTFT is triggered ONLY on the FIRST content token event!
            if (ev.type === 'token') {
              if (firstTokenTime === null) {
                firstTokenTime = performance.now();
              }
              tokenCount++;
            } else if (ev.type === 'done') {
              if (ev.timings) {
                serverTimings = ev.timings;
              }
            } else if (ev.type === 'error') {
              errorMessage = ev.message;
              statusCode = ev.status || 500;
            }
          }
        });

        res.on('end', () => {
          const endTime = performance.now();
          const totalLatency = Math.round((endTime - startTime) * 100) / 100;
          const ttft =
            firstTokenTime !== null
              ? Math.round((firstTokenTime - startTime) * 100) / 100
              : null;

          resolve({
            request_id: requestId,
            query: opts.query,
            scenario: opts.scenario || 'default',
            concurrency_level: opts.concurrency_level || 1,
            start_time_ms: startTime,
            end_time_ms: endTime,
            total_latency_ms: totalLatency,
            ttft_ms: ttft,
            completion_time_ms: totalLatency,
            status_code: statusCode,
            success: statusCode >= 200 && statusCode < 300 && !errorMessage,
            is_timeout: false,
            is_aborted: false,
            error_message: errorMessage,
            token_count: tokenCount,
            server_timings: serverTimings,
          });
        });

        res.on('error', (err) => {
          const endTime = performance.now();
          resolve({
            request_id: requestId,
            query: opts.query,
            scenario: opts.scenario || 'default',
            concurrency_level: opts.concurrency_level || 1,
            start_time_ms: startTime,
            end_time_ms: endTime,
            total_latency_ms: Math.round((endTime - startTime) * 100) / 100,
            ttft_ms: null,
            completion_time_ms: Math.round((endTime - startTime) * 100) / 100,
            status_code: 0,
            success: false,
            is_timeout: false,
            is_aborted: false,
            error_message: `Stream connection error: ${err.message}`,
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      isTimeout = true;
      req.destroy();
      const endTime = performance.now();
      resolve({
        request_id: requestId,
        query: opts.query,
        scenario: opts.scenario || 'default',
        concurrency_level: opts.concurrency_level || 1,
        start_time_ms: startTime,
        end_time_ms: endTime,
        total_latency_ms: Math.round((endTime - startTime) * 100) / 100,
        ttft_ms: null,
        completion_time_ms: Math.round((endTime - startTime) * 100) / 100,
        status_code: 504,
        success: false,
        is_timeout: true,
        is_aborted: false,
        error_message: `Client timeout after ${timeoutMs}ms`,
      });
    });

    req.on('error', (err) => {
      const endTime = performance.now();
      resolve({
        request_id: requestId,
        query: opts.query,
        scenario: opts.scenario || 'default',
        concurrency_level: opts.concurrency_level || 1,
        start_time_ms: startTime,
        end_time_ms: endTime,
        total_latency_ms: Math.round((endTime - startTime) * 100) / 100,
        ttft_ms: null,
        completion_time_ms: Math.round((endTime - startTime) * 100) / 100,
        status_code: 0,
        success: false,
        is_timeout: isTimeout,
        is_aborted: isAborted,
        error_message: `Request error: ${err.message}`,
      });
    });

    req.write(payload);
    req.end();
  });
}
