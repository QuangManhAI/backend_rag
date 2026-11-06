/** Thrown when every slot is busy and the waiting line is full. */
export class QueueFullError extends Error {
  constructor() {
    super('llm queue is full');
  }
}

export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export type Release = () => void;

interface Waiter {
  resolve: (release: Release) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Concurrency limiter for LLM turns: at most `concurrency` holders, at most `maxWaiting` waiters.
 * A waiter whose signal aborts leaves the line at once. Pure logic, no LLM dependency.
 */
export class LlmQueue {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxWaiting: number,
  ) {}

  /** Requests currently generating plus those waiting. */
  get length(): number {
    return this.active + this.waiting.length;
  }

  get running(): number {
    return this.active;
  }

  acquire(signal?: AbortSignal): Promise<Release> {
    if (signal?.aborted) return Promise.reject(new AbortedError());
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve(this.releaser());
    }
    if (this.waiting.length >= this.maxWaiting)
      return Promise.reject(new QueueFullError());
    return new Promise<Release>((resolve, reject) => {
      const w: Waiter = { resolve, reject, signal };
      if (signal) {
        w.onAbort = () => {
          const i = this.waiting.indexOf(w);
          if (i >= 0) this.waiting.splice(i, 1);
          reject(new AbortedError());
        };
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      this.waiting.push(w);
    });
  }

  /** A release function that works once, even if called twice. */
  private releaser(): Release {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiting.shift();
      if (next) {
        if (next.onAbort)
          next.signal?.removeEventListener('abort', next.onAbort);
        next.resolve(this.releaser()); // the slot passes straight to the next waiter
      } else {
        this.active--;
      }
    };
  }
}
