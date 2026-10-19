import { Injectable, OnModuleInit, BadRequestException, Logger } from '@nestjs/common';

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private embedder: any = null;
  private readonly expectedDimension = 768;

  private getModelName(): string {
    const envModel = process.env.EMBEDDING_MODEL_PATH;
    if (envModel && !envModel.startsWith('models/')) {
      return envModel;
    }
    return 'nomic-ai/nomic-embed-text-v1.5';
  }

  async onModuleInit(): Promise<void> {
    const modelName = this.getModelName();
    try {
      this.logger.log(`Initializing embedding pipeline with model: ${modelName}...`);
      const { pipeline } = await (Function('return import("@xenova/transformers")')() as Promise<any>);
      this.embedder = await pipeline('feature-extraction', modelName);
      this.logger.log(`Embedding model ${modelName} loaded successfully.`);
    } catch (error) {
      this.logger.error(`Failed to load embedding pipeline: ${(error as Error).message}`, (error as Error).stack);
    }
  }

  /**
   * Generates a 768-D normalized embedding vector for the user query.
   * Enforces Nomic v1.5 asymmetric prefix `search_query: `.
   */
  async generateEmbedding(query: string): Promise<number[]> {
    if (!query || query.trim() === '') {
      throw new BadRequestException('Query cannot be empty');
    }

    if (!this.embedder) {
      this.logger.warn('Embedder was not initialized; initializing on demand...');
      await this.onModuleInit();
    }

    const formattedText = `search_query: ${query.trim()}`;

    try {
      const output = await this.embedder!(formattedText, {
        pooling: 'mean',
        normalize: true,
      });

      const vector = Array.from(output.data as Float32Array | number[]) as number[];

      if (vector.length !== this.expectedDimension) {
        throw new Error(
          `Unexpected embedding dimension: got ${vector.length}, expected ${this.expectedDimension}`,
        );
      }

      return vector;
    } catch (error) {
      this.logger.error(`Error generating embedding for query: "${query}": ${(error as Error).message}`);
      throw error;
    }
  }
}
