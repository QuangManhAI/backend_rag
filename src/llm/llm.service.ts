import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import type { Llama, LlamaModel, LlamaContext } from 'node-llama-cpp';
import { detectGpu, GpuInfo, updateGpuInfoFromLlama } from '../utils/gpu.util';

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private chatSessionClass: any = null;
  private gpuInfo: GpuInfo | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.gpuInfo = detectGpu();
    this.logger.log(`Initial GPU Detection Status: ${this.gpuInfo.details} (Backend: ${this.gpuInfo.type})`);

    const modelPath =
      this.configService.get<string>('LLM_MODEL_PATH') ||
      this.configService.get<string>('MODEL_PATH') ||
      'models/qwen2.5-0.5b-instruct-q4_k_m/qwen2.5-0.5b-instruct-q4_k_m.gguf';

    const resolvedPath = this.resolveModelPath(modelPath);

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      this.logger.warn(
        `LLM model file not found at: ${modelPath}. LlmService will operate in fallback mode until the model file is available.`,
      );
      return;
    }

    try {
      this.logger.log(`Loading local Qwen2.5 GGUF model from: ${resolvedPath}...`);
      const nodeLlamaCpp = await (Function('return import("node-llama-cpp")')() as Promise<any>);
      this.chatSessionClass = nodeLlamaCpp.LlamaChatSession;

      this.llama = await nodeLlamaCpp.getLlama({
        gpu: this.gpuInfo.nodeLlamaGpuOption,
      });

      const activeGpuBackend = this.llama?.gpu;
      const hasHardwareGpu = Boolean(activeGpuBackend);
      const gpuLayers = hasHardwareGpu
        ? Number(this.configService.get<string>('GPU_LAYERS') || 99)
        : 0;

      this.gpuInfo = updateGpuInfoFromLlama(this.gpuInfo, activeGpuBackend, gpuLayers);

      this.logger.log(
        `Active node-llama-cpp GPU backend: ${String(activeGpuBackend).toUpperCase()}, offloading ${gpuLayers} layers`,
      );

      this.model = await this.llama!.loadModel({
        modelPath: resolvedPath,
        gpuLayers,
      });

      const contextSize = Number(
        this.configService.get<string>('LLM_CONTEXT_SIZE') ||
        this.configService.get<string>('CONTEXT_SIZE') ||
        4096,
      );

      const sequences = Number(this.configService.get<string>('LLM_SEQUENCES') || 2);

      this.context = await this.model.createContext({
        contextSize,
        sequences,
      });

      this.logger.log(
        `Qwen2.5 GGUF Model loaded successfully with ${gpuLayers} GPU layers on ${this.gpuInfo.type.toUpperCase()}.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load node-llama-cpp model: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private resolveModelPath(modelPath: string): string | null {
    const candidates = [
      path.isAbsolute(modelPath) ? modelPath : path.resolve(process.cwd(), modelPath),
      path.resolve(process.cwd(), '..', modelPath),
      path.resolve(process.cwd(), 'models/qwen2.5-0.5b-instruct-q4_k_m/qwen2.5-0.5b-instruct-q4_k_m.gguf'),
      path.resolve(process.cwd(), 'models/qwen2.5-7b-instruct-q4_k_m/qwen2.5-7b-instruct-q4_k_m.gguf'),
      path.resolve(process.cwd(), '../models/qwen2.5-0.5b-instruct-q4_k_m/qwen2.5-0.5b-instruct-q4_k_m.gguf'),
      path.resolve(process.cwd(), '../models/qwen2.5-7b-instruct-q4_k_m/qwen2.5-7b-instruct-q4_k_m.gguf'),
      'C:\\document\\Study documents\\Uth-Data-Mining\\models\\qwen2.5-7b-instruct-q4_k_m\\qwen2.5-7b-instruct-q4_k_m.gguf',
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
    return candidates[0];
  }

  /**
   * Generates grounded academic answer with low temperature (0.2).
   */
  async generateGroundedAnswer(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    if (!this.context || !this.chatSessionClass) {
      this.logger.warn('LLM context not loaded. Returning simulation response.');
      return 'The provided literature does not contain sufficient details regarding this query (Model in fallback mode).';
    }

    const sequence = this.context.getSequence();
    try {
      const session = new this.chatSessionClass({
        contextSequence: sequence,
        systemPrompt,
      });

      const maxTokens = Number(this.configService.get<string>('LLM_MAX_TOKENS') || 2048);

      const response = await session.prompt(userPrompt, {
        temperature: 0.2,
        maxTokens,
      });

      return response;
    } catch (error) {
      this.logger.error(`Error during LLM inference: ${(error as Error).message}`);
      throw error;
    } finally {
      if (sequence && typeof sequence.dispose === 'function') {
        sequence.dispose();
      }
    }
  }

  isReady(): boolean {
    return this.context !== null;
  }

  getGpuStatus(): GpuInfo | null {
    return this.gpuInfo;
  }
}
