import {
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { basename } from 'path';
import { AppConfigService } from '../config/app-config.service';
import { LLM_ENGINE, LlmEngine } from './llm-engine';
import { AbortedError, LlmQueue, QueueFullError, Release } from './llm-queue';
import { TokenChannel } from './token-channel';

export const LLM_UNAVAILABLE = 'llm unavailable';
export const LLM_QUEUE_FULL = 'llm queue is full';
export const LLM_TIMEOUT = 'llm timeout';
export const TEMPERATURE = 0.2;
export const MAX_TOKENS = 1024;

export interface LlmStatus {
  ready: boolean;
  model_id: string;
  gpu: string;
  queue_length: number;
  /** Turns currently generating (the queue holds `queue_length` in total). */
  running: number;
}

/** What the RAG pipeline needs from the LLM; mocked in tests. */
export interface LlmPort {
  /** Streams answer tokens. Throws 503 (not loaded), 429 (queue full), 504 (timeout), AbortedError. */
  generate(
    system: string,
    user: string,
    signal: AbortSignal,
  ): AsyncIterable<string>;
  status(): LlmStatus;
}

export const LLM_PORT = Symbol('LLM_PORT');

export { AbortedError };

@Injectable()
export class LlmService implements LlmPort, OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly queue: LlmQueue;
  private readonly timeoutMs: number;
  private readonly modelId: string;
  private ready = false;
  private gpu = 'unknown';

  constructor(
    @Inject(LLM_ENGINE) private readonly engine: LlmEngine,
    config: AppConfigService,
  ) {
    this.queue = new LlmQueue(
      config.get('LLM_CONCURRENCY'),
      config.get('LLM_MAX_QUEUE'),
    );
    this.timeoutMs = config.get('LLM_TIMEOUT_MS');
    this.modelId = basename(config.get('MODEL_PATH')).replace(/\.gguf$/i, '');
  }

  onModuleInit(): void {
    // Loading a 7B model takes a while: do it in the background, health reports `ready`.
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const { gpu } = await this.engine.load();
      this.gpu = gpu;
      this.ready = true;
      this.logger.log({ model_id: this.modelId, gpu }, 'LLM_READY');
    } catch (e) {
      this.logger.error({ err: e, model_id: this.modelId }, 'LLM_LOAD_FAILED');
    }
  }

  status(): LlmStatus {
    return {
      ready: this.ready,
      model_id: this.modelId,
      gpu: this.gpu,
      queue_length: this.queue.length,
      running: this.queue.running,
    };
  }

  async *generate(
    system: string,
    user: string,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    if (!this.ready) throw new ServiceUnavailableException(LLM_UNAVAILABLE);
    let release: Release;
    try {
      release = await this.queue.acquire(signal);
    } catch (e) {
      if (e instanceof QueueFullError) {
        throw new HttpException(LLM_QUEUE_FULL, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw e;
    }

    // The turn stops on client abort, on timeout, or when the consumer stops iterating.
    const stop = new AbortController();
    const onAbort = () => stop.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stop.abort();
    }, this.timeoutMs);

    const channel = new TokenChannel();
    const finished = this.engine
      .generate(system, user, {
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
        signal: stop.signal,
        onToken: (t) => channel.push(t),
      })
      .then(
        () => channel.close(),
        (e: unknown) => channel.fail(e),
      );

    try {
      try {
        for await (const token of channel) {
          if (stop.signal.aborted) break;
          yield token;
        }
      } catch (e) {
        if (timedOut) throw new GatewayTimeoutException(LLM_TIMEOUT);
        if (signal.aborted) throw new AbortedError();
        this.logger.error({ err: e }, 'LLM_GENERATION_FAILED');
        throw new ServiceUnavailableException(LLM_UNAVAILABLE);
      }
      if (timedOut) throw new GatewayTimeoutException(LLM_TIMEOUT);
      if (signal.aborted) throw new AbortedError();
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      stop.abort();
      await finished;
      release();
    }
  }
}
