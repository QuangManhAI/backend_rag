import type { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { PrometheusMetricsRegistry } from './prometheus-metrics';

describe('PrometheusMetricsRegistry', () => {
  it('records HTTP request counts, latency buckets, active users, and serves /metrics', async () => {
    const registry = new PrometheusMetricsRegistry(() => ({
      health: () =>
        Promise.resolve({
          status: 'ok',
          version: '1.0.0',
          uptime_s: 42,
          world_version: 'v1',
          components: { mongo: true, qdrant: true, llm: true, world: true },
          llm: { model_id: 'qwen', gpu: 'metal', queue_length: 2 },
        }),
    }) as never);

    const emitter = new EventEmitter();
    const req = {
      method: 'POST',
      path: '/api/v1/rag/chat',
      url: '/api/v1/rag/chat',
      baseUrl: '',
      route: { path: '/api/v1/rag/chat' },
      headers: { authorization: 'Bearer test-jwt-token' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    const res = Object.assign(emitter, {
      statusCode: 200,
    }) as unknown as Response;

    let nextCalled = false;
    registry.middleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    emitter.emit('finish');

    const text = await registry.renderPrometheusText();
    expect(text).toContain('rag_active_users_1m 1');
    expect(text).toContain('rag_active_users_5m 1');
    expect(text).toContain(
      'rag_http_requests_total{method="POST",route="/api/v1/rag/chat",status="200"} 1',
    );
    expect(text).toContain('rag_component_up{component="mongo"} 1');
    expect(text).toContain('rag_llm_queue_length 2');

    // Verify GET /metrics endpoint response
    const headers: Record<string, string> = {};
    let body = '';
    const metricsReq = {
      method: 'GET',
      path: '/metrics',
      url: '/metrics',
    } as unknown as Request;
    const metricsRes = {
      status: jest.fn().mockReturnThis(),
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      end: (b: string) => {
        body = b;
      },
    } as unknown as Response;

    registry.middleware(metricsReq, metricsRes, () => {});
    // Wait a tick for async serveMetrics
    await new Promise((r) => setImmediate(r));
    expect(headers['Content-Type']).toBe(
      'text/plain; version=0.0.4; charset=utf-8',
    );
    expect(body).toContain('rag_http_requests_total');
  });
});
