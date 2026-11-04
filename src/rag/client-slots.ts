import type { Release } from '../llm/llm-queue';

export const TOO_MANY_INFLIGHT = 'too many concurrent requests';
/** One tab streaming plus one being replaced: the abort of the old stream can lag behind. */
export const MAX_INFLIGHT_PER_USER = 2;
/** Several people can share an IP, but one IP must never fill the LLM queue (1 slot + 8 waiting). */
export const MAX_INFLIGHT_PER_IP = 3;

/**
 * Caps the chat requests one client can have running at once, so no single client can occupy the
 * whole LLM queue and leave every other client with 429 `llm queue is full`. In-process counters:
 * one instance holds the LLM, so the limit is per instance by nature.
 */
export class ClientSlots {
  private readonly counts = new Map<string, number>();

  /** A release function that works once, or null when the client is at its limit. */
  acquire(ip: string | undefined, userId?: string): Release | null {
    const keys: Array<[string, number]> = [
      [`ip:${ip ?? 'unknown'}`, MAX_INFLIGHT_PER_IP],
    ];
    if (userId) keys.push([`user:${userId}`, MAX_INFLIGHT_PER_USER]);
    if (keys.some(([k, max]) => (this.counts.get(k) ?? 0) >= max)) return null;
    for (const [k] of keys) this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const [k] of keys) {
        const left = (this.counts.get(k) ?? 1) - 1;
        if (left > 0) this.counts.set(k, left);
        else this.counts.delete(k);
      }
    };
  }
}
