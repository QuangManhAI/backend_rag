import { existsSync } from 'fs';
import type { Llama, LlamaContext, LlamaModel } from 'node-llama-cpp';
import { resolve } from 'path';

export interface GenerateOptions {
  temperature: number;
  maxTokens: number;
  signal: AbortSignal;
  onToken: (text: string) => void;
}

/** The model runtime behind LlmService; a fake one is used in tests. */
export interface LlmEngine {
  /** Loads the model; resolves with the GPU backend actually used ("cuda", "metal", "vulkan", "cpu"). */
  load(): Promise<{ gpu: string }>;
  /** One grounded turn with a fresh chat history. Resolves when generation ends or is aborted. */
  generate(system: string, user: string, opts: GenerateOptions): Promise<void>;
}

export const LLM_ENGINE = Symbol('LLM_ENGINE');

type NodeLlamaCpp = typeof import('node-llama-cpp');

// node-llama-cpp is ESM-only: keep a real dynamic import (TS would turn `import()` into `require`).
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above
const importNodeLlamaCpp = new Function(
  'return import("node-llama-cpp")',
) as () => Promise<NodeLlamaCpp>;

export interface NodeLlamaOptions {
  modelPath: string;
  gpu: 'auto' | 'cuda' | 'metal' | 'vulkan' | 'false';
  sequences: number;
  contextSize?: number;
}

/** node-llama-cpp: one model, one context with a sequence per concurrent turn. */
export class NodeLlamaEngine implements LlmEngine {
  private lib: NodeLlamaCpp | null = null;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;

  constructor(private readonly opts: NodeLlamaOptions) {}

  async load(): Promise<{ gpu: string }> {
    const path = resolve(this.opts.modelPath);
    if (!existsSync(path)) throw new Error(`model file not found: ${path}`);
    this.lib = await importNodeLlamaCpp();
    this.llama = await this.lib.getLlama({
      gpu: this.opts.gpu === 'false' ? false : this.opts.gpu,
    });
    this.model = await this.llama.loadModel({ modelPath: path });
    this.context = await this.model.createContext({
      sequences: this.opts.sequences,
      contextSize: this.opts.contextSize ?? 8192,
    });
    return { gpu: this.llama.gpu === false ? 'cpu' : this.llama.gpu };
  }

  async generate(
    system: string,
    user: string,
    o: GenerateOptions,
  ): Promise<void> {
    if (!this.lib || !this.context) throw new Error('model not loaded');
    const sequence = this.context.getSequence();
    try {
      const session = new this.lib.LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: system,
      });
      await session.prompt(user, {
        temperature: o.temperature,
        maxTokens: o.maxTokens,
        signal: o.signal,
        stopOnAbortSignal: true,
        onTextChunk: o.onToken,
      });
      session.dispose({ disposeSequence: false });
    } finally {
      await sequence.dispose();
    }
  }
}
