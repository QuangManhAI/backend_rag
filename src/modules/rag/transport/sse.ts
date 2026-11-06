import type { Response } from 'express';
import { contextOf } from '../common/request-context';
import type { RagStreamEvent } from '../types/scientific-rag';

export const PING_INTERVAL_MS = 15_000;

/** Server-Sent Events over a raw Express response (POST, so `@Sse()` cannot be used). */
export class SseWriter {
  private ping: NodeJS.Timeout | null = null;

  constructor(private readonly res: Response) {}

  /** Sends the headers right away so proxies and the browser start reading. */
  open(): void {
    this.res.status(200);
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    this.res.setHeader('X-Accel-Buffering', 'no');
    this.res.flushHeaders();
    this.ping = setInterval(() => this.write(': ping\n\n'), PING_INTERVAL_MS);
  }

  send(event: RagStreamEvent): void {
    this.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  get closed(): boolean {
    return this.res.writableEnded || this.res.destroyed;
  }

  close(): void {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    if (!this.closed) this.res.end();
  }

  private write(chunk: string): void {
    if (!this.closed) this.res.write(chunk);
  }
}

/**
 * Aborts when the client goes away before the response is complete. The listener runs before
 * pino-http's own `close` listener, so the request line is logged as `abortedEvent`.
 */
export function abortOnClientClose(
  res: Response,
  abortedEvent: string,
): AbortController {
  const ctrl = new AbortController();
  res.prependListener('close', () => {
    if (res.writableFinished) return;
    const ctx = contextOf(res);
    if (ctx) ctx.event = abortedEvent;
    ctrl.abort();
  });
  return ctrl;
}
