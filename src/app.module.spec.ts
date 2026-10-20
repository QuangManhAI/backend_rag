import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { RagModule } from './rag/rag.module';
import { EmbeddingModule } from './embedding/embedding.module';
import { LlmModule } from './llm/llm.module';
import { MiningModule } from './mining/mining.module';
import { VectorStoreModule } from './vector-store/vector-store.module';
import { WorldModule } from './world/world.module';
import { PapersModule } from './papers/papers.module';

describe('Modules Compilation & Dependency Injection', () => {
  it('should compile AppModule with all submodules', async () => {
    // Compile without starting native listeners
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('ConfigService')
      .useValue({
        get: jest.fn((key: string) => {
          if (key === 'LLM_MODEL_PATH') return 'non_existent_model.gguf';
          if (key === 'LANCEDB_PATH') return '../data/gold/lancedb';
          return null;
        }),
      })
      .compile();

    expect(moduleRef).toBeDefined();
    expect(moduleRef.get(AppModule)).toBeDefined();
  });

  it('should instantiate individual module definitions', () => {
    expect(new AppModule()).toBeDefined();
    expect(new RagModule()).toBeDefined();
    expect(new EmbeddingModule()).toBeDefined();
    expect(new LlmModule()).toBeDefined();
    expect(new MiningModule()).toBeDefined();
    expect(new VectorStoreModule()).toBeDefined();
    expect(new WorldModule()).toBeDefined();
    expect(new PapersModule()).toBeDefined();
  });
});
