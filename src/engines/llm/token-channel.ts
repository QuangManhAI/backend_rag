/**
 * Turns a callback producer (`push`, then `close` or `fail`) into an async iterator.
 * Tokens pushed before the consumer asks are buffered in order.
 */
export class TokenChannel implements AsyncIterable<string> {
  private readonly buffer: string[] = [];
  private closed = false;
  private error: Error | null = null;
  private wake: (() => void) | null = null;

  push(token: string): void {
    if (this.closed) return;
    this.buffer.push(token);
    this.notify();
  }

  close(): void {
    this.closed = true;
    this.notify();
  }

  fail(error: unknown): void {
    this.error =
      error instanceof Error ? error : new Error('generation failed');
    this.closed = true;
    this.notify();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    for (;;) {
      if (this.buffer.length) {
        yield this.buffer.shift() as string;
        continue;
      }
      if (this.error) throw this.error;
      if (this.closed) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }

  private notify(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }
}
