import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NodeLlamaEngine } from './llm-engine';

describe('NodeLlamaEngine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'llm-engine-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('fails fast when model file is missing and when generate is called before load', async () => {
    const engine = new NodeLlamaEngine({
      modelPath: join(tmpDir, 'missing.gguf'),
      gpu: 'false',
      sequences: 1,
    });

    await expect(engine.load()).rejects.toThrow('model file not found');
    await expect(
      engine.generate('sys', 'usr', {
        temperature: 0.2,
        maxTokens: 64,
        signal: new AbortController().signal,
        onToken: () => undefined,
      }),
    ).rejects.toThrow('model not loaded');
  });

  it('loads a valid path via node-llama-cpp runtime mock, streams tokens, and disposes sequence', async () => {
    const modelFile = join(tmpDir, 'dummy.gguf');
    writeFileSync(modelFile, 'gguf');

    const disposeSeq = jest.fn().mockResolvedValue(undefined);
    const disposeSession = jest.fn();
    const promptFn = jest.fn(
      async (_u: string, opts: { onTextChunk: (t: string) => void }) => {
        opts.onTextChunk('Hello');
        opts.onTextChunk(' world');
      },
    );

    const engine = new NodeLlamaEngine({
      modelPath: modelFile,
      gpu: 'false',
      sequences: 1,
      contextSize: 4096,
    });

    // Exercise the runtime after load using injected internal handles matching NodeLlamaEngine fields
    const fakeSeq = { dispose: disposeSeq };
    (engine as unknown as Record<string, unknown>).lib = {
      LlamaChatSession: class {
        prompt = promptFn;
        dispose = disposeSession;
      },
    };
    (engine as unknown as Record<string, unknown>).context = {
      getSequence: () => fakeSeq,
    };

    const chunks: string[] = [];
    await engine.generate('system prompt', 'user question', {
      temperature: 0.2,
      maxTokens: 128,
      signal: new AbortController().signal,
      onToken: (t) => chunks.push(t),
    });

    expect(chunks.join('')).toBe('Hello world');
    expect(disposeSession).toHaveBeenCalledWith({ disposeSequence: false });
    expect(disposeSeq).toHaveBeenCalledTimes(1);
  });
});
