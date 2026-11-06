import {
  GatewayTimeoutException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { parseEnv } from '../../config/env.schema';
import { TEST_ENV } from '../../testing/test-app';
import type { GenerateOptions, LlmEngine } from './llm-engine';
import { AbortedError, LlmQueue, QueueFullError } from './llm-queue';
import { LlmService } from './llm.service';

const tick = () => new Promise((r) => setImmediate(r));

describe('LlmQueue', () => {
  it('runs up to concurrency, queues up to maxWaiting, then rejects', async () => {
    const q = new LlmQueue(1, 2);
    const r1 = await q.acquire();
    const p2 = q.acquire();
    const p3 = q.acquire();
    await expect(q.acquire()).rejects.toBeInstanceOf(QueueFullError);
    expect(q.length).toBe(3);
    r1();
    const r2 = await p2;
    expect(q.running).toBe(1);
    r2();
    (await p3)();
    expect(q.length).toBe(0);
  });

  it('an aborted waiter leaves the line at once', async () => {
    const q = new LlmQueue(1, 1);
    const r1 = await q.acquire();
    const ctrl = new AbortController();
    const p = q.acquire(ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(AbortedError);
    expect(q.length).toBe(1);
    const p2 = q.acquire(); // the freed waiting spot is usable
    r1();
    (await p2)();
    expect(q.length).toBe(0);
  });

  it('release is idempotent', async () => {
    const q = new LlmQueue(1, 0);
    const r = await q.acquire();
    r();
    r();
    expect(q.length).toBe(0);
    const r2 = await q.acquire();
    await expect(q.acquire()).rejects.toBeInstanceOf(QueueFullError);
    r2();
  });
});

/** Emits `tokens` one per macrotask; stops early when aborted (like stopOnAbortSignal). */
class FakeEngine implements LlmEngine {
  active = 0;
  maxActive = 0;
  aborted = 0;
  constructor(
    private readonly tokens: string[] = ['Lo', 'RA', ' works'],
    private readonly opts: {
      failAfter?: number;
      hang?: boolean;
      loadError?: boolean;
    } = {},
  ) {}
  load() {
    return this.opts.loadError
      ? Promise.reject(new Error('no gguf'))
      : Promise.resolve({ gpu: 'metal' });
  }
  async generate(_s: string, _u: string, o: GenerateOptions) {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      for (let i = 0; i < this.tokens.length || this.opts.hang; i++) {
        await tick();
        if (o.signal.aborted) {
          this.aborted++;
          return;
        }
        if (this.opts.failAfter === i) throw new Error('CUDA OOM');
        if (i < this.tokens.length) o.onToken(this.tokens[i]);
      }
    } finally {
      this.active--;
    }
  }
}

function service(engine: LlmEngine, env: Record<string, string> = {}) {
  const config = new AppConfigService(
    parseEnv({
      ...TEST_ENV,
      MONGO_URI: 'mongodb://x',
      MODEL_PATH: '/m/qwen2.5-7b-instruct-q4_k_m.gguf',
      ...env,
    }),
  );
  return new LlmService(engine, config);
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const t of it) out += t;
  return out;
}

describe('LlmService', () => {
  it('not loaded ➔ 503 llm unavailable', async () => {
    const s = service(new FakeEngine([], { loadError: true }));
    await s.load();
    expect(s.status().ready).toBe(false);
    await expect(
      collect(s.generate('s', 'u', new AbortController().signal)),
    ).rejects.toThrow(new ServiceUnavailableException('llm unavailable'));
  });

  it('streams tokens and reports status', async () => {
    const s = service(new FakeEngine());
    await s.load();
    expect(s.status()).toEqual({
      ready: true,
      model_id: 'qwen2.5-7b-instruct-q4_k_m',
      gpu: 'metal',
      queue_length: 0,
      running: 0,
    });
    expect(
      await collect(s.generate('s', 'u', new AbortController().signal)),
    ).toBe('LoRA works');
    expect(s.status().queue_length).toBe(0);
  });

  it('two requests do not overlap with concurrency 1', async () => {
    const engine = new FakeEngine();
    const s = service(engine);
    await s.load();
    const sig = new AbortController().signal;
    const [a, b] = await Promise.all([
      collect(s.generate('s', 'u', sig)),
      collect(s.generate('s', 'u', sig)),
    ]);
    expect([a, b]).toEqual(['LoRA works', 'LoRA works']);
    expect(engine.maxActive).toBe(1);
  });

  it('queue full ➔ 429', async () => {
    const s = service(new FakeEngine(['x'], { hang: true }), {
      LLM_MAX_QUEUE: '1',
    });
    await s.load();
    const ctrl = new AbortController();
    const first = collect(s.generate('s', 'u', ctrl.signal)).catch(
      (e: unknown) => e,
    );
    const second = collect(s.generate('s', 'u', ctrl.signal)).catch(
      (e: unknown) => e,
    );
    await tick();
    expect(s.status().queue_length).toBe(2);
    const third = await collect(
      s.generate('s', 'u', new AbortController().signal),
    ).catch((e: unknown) => e);
    expect(third).toBeInstanceOf(HttpException);
    expect((third as HttpException).getStatus()).toBe(429);
    expect((third as HttpException).message).toBe('llm queue is full');
    ctrl.abort();
    expect(await first).toBeInstanceOf(AbortedError);
    expect(await second).toBeInstanceOf(AbortedError);
    expect(s.status().queue_length).toBe(0);
  });

  it('timeout ➔ 504 and the slot is freed', async () => {
    const engine = new FakeEngine(['x'], { hang: true });
    const s = service(engine, { LLM_TIMEOUT_MS: '1000' });
    await s.load();
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const p = collect(s.generate('s', 'u', new AbortController().signal));
      await tick();
      jest.advanceTimersByTime(1001);
      await expect(p).rejects.toThrow(
        new GatewayTimeoutException('llm timeout'),
      );
    } finally {
      jest.useRealTimers();
    }
    expect(engine.aborted).toBe(1);
    expect(s.status().queue_length).toBe(0);
  });

  it('abort mid-stream stops generation and frees the slot', async () => {
    const engine = new FakeEngine(['a', 'b'], { hang: true });
    const s = service(engine);
    await s.load();
    const ctrl = new AbortController();
    const got: string[] = [];
    const p = (async () => {
      for await (const t of s.generate('s', 'u', ctrl.signal)) {
        got.push(t);
        if (got.length === 1) ctrl.abort();
      }
    })();
    await expect(p).rejects.toBeInstanceOf(AbortedError);
    expect(got).toEqual(['a']);
    expect(engine.active).toBe(0);
    expect(s.status().queue_length).toBe(0);
  });

  it('consumer that stops iterating frees the slot', async () => {
    const engine = new FakeEngine(['a', 'b', 'c']);
    const s = service(engine);
    await s.load();
    for await (const t of s.generate('s', 'u', new AbortController().signal)) {
      expect(t).toBe('a');
      break;
    }
    expect(engine.active).toBe(0);
    expect(s.status().queue_length).toBe(0);
  });

  it('engine error ➔ 503 and the slot is freed', async () => {
    const s = service(new FakeEngine(['a', 'b'], { failAfter: 1 }));
    await s.load();
    await expect(
      collect(s.generate('s', 'u', new AbortController().signal)),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(s.status().queue_length).toBe(0);
  });
});
